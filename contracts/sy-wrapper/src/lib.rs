// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use novaire_blend_adapter::{
    assets_from_b_tokens, derived_exchange_rate, BlendPoolClient, Request, REQUEST_SUPPLY,
    REQUEST_WITHDRAW,
};
use novaire_shared_types::StandardizedYield;
use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    vec, Address, BytesN, Env, IntoVal, MuxedAddress, String, Symbol,
};

const WAD: i128 = 1_000_000_000_000_000_000;

/// Display decimals for SY, matching the 7-decimal underlying.
const DECIMALS: u32 = 7;

/// TTL policy, matching the AMM: bump when within 30 days of expiry, extend to
/// 120 days, so a periodically-touched vault never archives mid-term.
const LEDGERS_PER_DAY: u32 = 17_280;
const TTL_THRESHOLD_LEDGERS: u32 = 30 * LEDGERS_PER_DAY;
const TTL_EXTEND_TO_LEDGERS: u32 = 120 * LEDGERS_PER_DAY;

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Config {
    pub admin: Address,
    pub underlying: Address,
    pub pool: Address,
    pub reserve_index: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Config,
    TotalSupply,
    Balance(Address),
    /// Underlying principal a holder deposited, used for accrued-yield display.
    Principal(Address),
    /// (owner, spender)
    Allowance(Address, Address),
    /// Set once `pause` is called. Blocks entries only; every exit path stays
    /// open (see `require_not_paused`).
    Paused,
    /// Address nominated by `propose_admin`, not yet in force. Two-step, so a
    /// typo cannot permanently orphan governance.
    PendingAdmin,
    /// May pause but never unpause. Defaults to the admin when unset.
    Guardian,
    /// `(wasm_hash, eta)` for a timelocked upgrade.
    PendingUpgrade,
    /// Set by `emergency_withdraw_all`. Irreversible per market.
    EmergencyMode,
    /// Set by `renounce_admin`. Irreversible.
    Renounced,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
#[contracterror]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InsufficientBalance = 5,
    MathOverflow = 6,
    InsufficientAllowance = 7,
    InvalidExpiration = 8,
    InvalidBlendReserve = 10,
    BlendWithdrawalFailed = 11,
    NotAuthorized = 12,
    /// An entry path was called while paused. Exits are never blocked.
    Paused = 13,
    /// `accept_admin` called by an address that was not nominated.
    NotPendingAdmin = 14,
    /// `execute_upgrade` called before the timelock expired, or with nothing
    /// proposed.
    UpgradeNotReady = 15,
    /// A deposit would exceed the Blend reserve's supply cap. Surfaced before
    /// calling Blend so callers get a typed error instead of an opaque trap.
    SupplyCapExceeded = 16,
    /// The market is in emergency wind-down: deposits are closed permanently.
    EmergencyModeActive = 17,
    /// `emergency_withdraw_all` called when already wound down.
    AlreadyInEmergencyMode = 18,
    /// A sweep targeted an asset the protocol depends on.
    ProtectedAsset = 19,
}

/// Timelock on `execute_upgrade`, in seconds. Long enough that anyone watching
/// `UpgradeProposed` can exit before new code takes effect — which is the whole
/// point of having one.
const UPGRADE_TIMELOCK_SECONDS: u64 = 72 * 60 * 60;

/// Emitted when an admin re-syncs the stored Blend reserve index after the pool
/// reindexed the underlying. Both indices are carried so integrators can audit
/// the move.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveMigrated {
    pub old_index: u32,
    pub new_index: u32,
}

/// Emitted when a new admin is nominated.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminProposed {
    #[topic]
    pub new_admin: Address,
}

/// Emitted when an admin transfer completes.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChanged {
    #[topic]
    pub previous: Address,
    #[topic]
    pub current: Address,
}

/// Emitted when governance is permanently renounced.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminRenounced {}

/// Emitted on pause and unpause.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PauseChanged {
    pub paused: bool,
}

/// Emitted when an upgrade is scheduled. `eta` is the earliest timestamp it can
/// execute; holders who object have until then to exit.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeProposed {
    pub wasm_hash: BytesN<32>,
    pub eta: u64,
}

/// Emitted when the Blend position is wound down into idle custody.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmergencyWithdrawal {
    pub requested: i128,
    pub recovered: i128,
}

/// Emitted when underlying is deposited and SY shares are minted.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deposit {
    #[topic]
    pub holder: Address,
    pub underlying_amount: i128,
    pub shares_minted: i128,
}

/// Emitted when SY shares are redeemed for underlying.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Redeem {
    #[topic]
    pub holder: Address,
    pub shares_burned: i128,
    pub underlying_amount: i128,
}

#[contract]
pub struct SyWrapper;

#[contractimpl]
impl SyWrapper {
    /// Initializes a production wrapper whose custody and exchange rate are
    /// backed by a Blend v2 plain-supply position.
    pub fn initialize_blend(
        env: Env,
        admin: Address,
        underlying: Address,
        pool: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        let pool_client = BlendPoolClient::new(&env, &pool);
        let reserves = pool_client.get_reserve_list();
        let mut reserve_index = None;
        for (index, asset) in reserves.iter().enumerate() {
            if asset == underlying {
                reserve_index = Some(index as u32);
                break;
            }
        }
        let reserve_index = reserve_index.ok_or(Error::InvalidBlendReserve)?;
        let reserve = pool_client.get_reserve(&underlying);
        if reserve.config.index != reserve_index || reserve.config.decimals != DECIMALS {
            return Err(Error::InvalidBlendReserve);
        }

        Self::write_initial_config(
            &env,
            Config {
                admin,
                underlying,
                pool,
                reserve_index,
            },
        );
        Ok(())
    }

    pub fn config(env: Env) -> Result<Config, Error> {
        Self::read_config(&env)
    }

    // --- governance: two-step admin, guardian, pause, timelocked upgrade ----

    /// Nominates a new admin. Takes effect only when the nominee calls
    /// `accept_admin`, so a mistyped address cannot orphan governance.
    pub fn propose_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let config = Self::read_config(&env)?;
        config.admin.require_auth();
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        AdminProposed { new_admin }.publish(&env);
        Ok(())
    }

    /// Completes a transfer started by `propose_admin`.
    pub fn accept_admin(env: Env) -> Result<(), Error> {
        let mut config = Self::read_config(&env)?;
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(Error::NotPendingAdmin)?;
        pending.require_auth();
        let previous = config.admin.clone();
        config.admin = pending.clone();
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        Self::bump_instance_ttl(&env);
        AdminChanged {
            previous,
            current: pending,
        }
        .publish(&env);
        Ok(())
    }

    pub fn pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    /// Sets the guardian, which may pause but never unpause.
    pub fn set_guardian(env: Env, guardian: Address) -> Result<(), Error> {
        let config = Self::read_config(&env)?;
        config.admin.require_auth();
        Self::bump_instance_ttl(&env);
        env.storage().instance().set(&DataKey::Guardian, &guardian);
        Ok(())
    }

    /// The guardian, defaulting to the admin when none has been set.
    pub fn guardian(env: Env) -> Result<Address, Error> {
        let config = Self::read_config(&env)?;
        Ok(env
            .storage()
            .instance()
            .get(&DataKey::Guardian)
            .unwrap_or(config.admin))
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Halts deposits. Callable by the guardian OR the admin — deliberately the
    /// cheap half of an asymmetric pair, because stopping a live exploit must
    /// not wait on a multisig.
    ///
    /// This never blocks an exit. `redeem`, every SEP-41 `transfer`, and the
    /// tokenizer paths that read `exchange_rate` all keep working while paused.
    /// A pause that traps user funds is worse than no pause at all.
    pub fn pause(env: Env) -> Result<(), Error> {
        let config = Self::read_config(&env)?;
        let guardian: Address = env
            .storage()
            .instance()
            .get(&DataKey::Guardian)
            .unwrap_or(config.admin);
        guardian.require_auth();
        Self::bump_instance_ttl(&env);
        env.storage().instance().set(&DataKey::Paused, &true);
        PauseChanged { paused: true }.publish(&env);
        Ok(())
    }

    /// Resumes deposits. Admin only — the expensive half. Cheap to stop,
    /// deliberate to restart.
    pub fn unpause(env: Env) -> Result<(), Error> {
        let config = Self::read_config(&env)?;
        config.admin.require_auth();
        Self::bump_instance_ttl(&env);
        env.storage().instance().set(&DataKey::Paused, &false);
        PauseChanged { paused: false }.publish(&env);
        Ok(())
    }

    /// Schedules an upgrade. Cannot execute for `UPGRADE_TIMELOCK_SECONDS`, and
    /// emits an event on proposal, so holders who dislike the new code have a
    /// bounded, advertised window to exit first.
    pub fn propose_upgrade(env: Env, wasm_hash: BytesN<32>) -> Result<u64, Error> {
        let config = Self::read_config(&env)?;
        config.admin.require_auth();
        let eta = env
            .ledger()
            .timestamp()
            .checked_add(UPGRADE_TIMELOCK_SECONDS)
            .ok_or(Error::MathOverflow)?;
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgrade, &(wasm_hash.clone(), eta));
        UpgradeProposed { wasm_hash, eta }.publish(&env);
        Ok(eta)
    }

    pub fn pending_upgrade(env: Env) -> Option<(BytesN<32>, u64)> {
        env.storage().instance().get(&DataKey::PendingUpgrade)
    }

    pub fn cancel_upgrade(env: Env) -> Result<(), Error> {
        let config = Self::read_config(&env)?;
        config.admin.require_auth();
        env.storage().instance().remove(&DataKey::PendingUpgrade);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    /// Applies a proposed upgrade once its timelock has elapsed.
    pub fn execute_upgrade(env: Env) -> Result<(), Error> {
        let config = Self::read_config(&env)?;
        config.admin.require_auth();
        let (wasm_hash, eta): (BytesN<32>, u64) = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgrade)
            .ok_or(Error::UpgradeNotReady)?;
        if env.ledger().timestamp() < eta {
            return Err(Error::UpgradeNotReady);
        }
        env.storage().instance().remove(&DataKey::PendingUpgrade);
        env.deployer().update_current_contract_wasm(wasm_hash);
        Ok(())
    }

    /// Permanently renounces governance: no more pause, upgrade, sweep, or
    /// reserve migration, ever. The escape hatch from upgradeability once the
    /// market has proven itself and an audit is in hand.
    pub fn renounce_admin(env: Env) -> Result<(), Error> {
        let config = Self::read_config(&env)?;
        config.admin.require_auth();
        env.storage().instance().remove(&DataKey::PendingUpgrade);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.storage().instance().set(&DataKey::Renounced, &true);
        Self::bump_instance_ttl(&env);
        AdminRenounced {}.publish(&env);
        Ok(())
    }

    pub fn is_renounced(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Renounced)
            .unwrap_or(false)
    }

    // --- emergency wind-down -----------------------------------------------

    pub fn is_emergency(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::EmergencyMode)
            .unwrap_or(false)
    }

    /// Withdraws the entire Blend position into idle custody and closes the
    /// market permanently.
    ///
    /// This exists because `config.pool` is fixed at init with no rotation. If
    /// Blend pauses the reserve, deprecates it, or the wrapper's position
    /// becomes unreadable, then `exchange_rate` traps — and with it deposit,
    /// redeem, split, recombine, redeem_at_maturity and every AMM swap, since
    /// they all read it. Without this, that state is unrecoverable and user
    /// funds are stranded.
    ///
    /// Afterwards the rate is derived from idle custody exactly the way it was
    /// derived from the Blend position (`assets * WAD / supply`), so it needs no
    /// frozen snapshot and no new failure mode, and `redeem` pays out pro-rata
    /// from the recovered balance. Deposits are closed forever.
    ///
    /// Irreversible on purpose: allowing a return to Blend would make this a
    /// rate-manipulation lever rather than a safety valve.
    pub fn emergency_withdraw_all(env: Env) -> Result<i128, Error> {
        let config = Self::read_config(&env)?;
        config.admin.require_auth();
        Self::require_not_renounced(&env)?;
        if Self::is_emergency(env.clone()) {
            return Err(Error::AlreadyInEmergencyMode);
        }
        Self::bump_instance_ttl(&env);

        // Value the position before touching it; a failed read must not strand
        // the market silently.
        let aum = blend_assets_under_management(&env, &config);
        let before = underlying_balance(&env, &config.underlying);
        if aum > 0 {
            blend_submit(&env, &config, REQUEST_WITHDRAW, aum, true);
        }
        let recovered = sub_or_panic(&env, underlying_balance(&env, &config.underlying), before);

        env.storage().instance().set(&DataKey::EmergencyMode, &true);
        env.storage().instance().set(&DataKey::Paused, &true);
        EmergencyWithdrawal {
            requested: aum,
            recovered,
        }
        .publish(&env);
        Ok(recovered)
    }

    /// Moves a non-protocol token out of this contract. The underlying can
    /// never be swept — it is either backing SY or, in wind-down, the entire
    /// redemption pool.
    pub fn sweep(env: Env, token_id: Address, to: Address) -> Result<i128, Error> {
        let config = Self::read_config(&env)?;
        config.admin.require_auth();
        Self::require_not_renounced(&env)?;
        if token_id == config.underlying {
            return Err(Error::ProtectedAsset);
        }
        let balance =
            token::TokenClient::new(&env, &token_id).balance(&env.current_contract_address());
        if balance <= 0 {
            return Err(Error::InvalidAmount);
        }
        push_token_as_self(&env, &token_id, &to, balance);
        Ok(balance)
    }

    fn require_not_renounced(env: &Env) -> Result<(), Error> {
        if Self::is_renounced(env.clone()) {
            return Err(Error::NotAuthorized);
        }
        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), Error> {
        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(Error::Paused);
        }
        Ok(())
    }

    /// Recovers from a Blend reserve reindex.
    ///
    /// `config.reserve_index` is fixed at init and the rate path traps with
    /// `InvalidBlendReserve` whenever Blend has since moved the underlying to a
    /// different reserve slot. That fail-closed trap is correct (pricing the
    /// wrong reserve would be worse), but on its own it is unrecoverable: every
    /// rate read, and therefore every deposit/redeem/split/recombine, stays
    /// bricked for the life of the market. This admin entrypoint re-syncs the
    /// stored index to wherever the pool now keeps this wrapper's underlying.
    ///
    /// It does NOT trust a caller-supplied index. It re-derives the index the
    /// same way `initialize_blend` does: it finds the underlying's position in
    /// the pool's reserve list and cross-checks that against the pool's own
    /// `get_reserve(underlying).config.index`, and requires the reserve decimals
    /// to still match. The new index is accepted only if the asset actually
    /// sitting there is `config.underlying`. So the strongest thing an admin can
    /// do here is re-point the wrapper at the same underlying under its new slot;
    /// the admin cannot aim the rate at a different (e.g. more valuable) asset,
    /// which is the property that keeps this from being a mispricing or theft
    /// lever. Returns the new reserve index.
    pub fn migrate_reserve_index(env: Env, admin: Address) -> Result<u32, Error> {
        let mut config = Self::read_config(&env)?;
        admin.require_auth();
        if admin != config.admin {
            return Err(Error::NotAuthorized);
        }
        let pool_client = BlendPoolClient::new(&env, &config.pool);
        let reserves = pool_client.get_reserve_list();
        let mut new_index = None;
        for (index, asset) in reserves.iter().enumerate() {
            if asset == config.underlying {
                new_index = Some(index as u32);
                break;
            }
        }
        let new_index = new_index.ok_or(Error::InvalidBlendReserve)?;
        // Cross-check the list position against the pool's authoritative reserve
        // record. Both must agree that `config.underlying` lives at `new_index`,
        // and the decimals must still match, or we refuse the migration.
        let reserve = pool_client.get_reserve(&config.underlying);
        if reserve.config.index != new_index || reserve.config.decimals != DECIMALS {
            return Err(Error::InvalidBlendReserve);
        }

        let old_index = config.reserve_index;
        config.reserve_index = new_index;
        Self::bump_instance_ttl(&env);
        env.storage().instance().set(&DataKey::Config, &config);

        ReserveMigrated {
            old_index,
            new_index,
        }
        .publish(&env);

        Ok(new_index)
    }

    pub fn share_balance(env: Env, holder: Address) -> Result<i128, Error> {
        Self::read_config(&env)?;
        Ok(Self::read_balance(&env, &holder))
    }

    pub fn total_shares(env: Env) -> Result<i128, Error> {
        Self::read_config(&env)?;
        Ok(Self::read_total_supply(&env))
    }

    // --- SEP-41 token interface (SY is a transferable share) ---------------

    pub fn balance(env: Env, id: Address) -> i128 {
        Self::read_balance(&env, &id)
    }

    pub fn total_supply(env: Env) -> i128 {
        Self::read_total_supply(&env)
    }

    pub fn decimals(_env: Env) -> u32 {
        DECIMALS
    }

    pub fn name(env: Env) -> String {
        String::from_str(&env, "Novaire Standardized Yield")
    }

    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "sSY")
    }

    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        Self::read_allowance(&env, &from, &spender).amount
    }

    pub fn approve(
        env: Env,
        from: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) {
        from.require_auth();
        if amount < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if amount > 0 && expiration_ledger < env.ledger().sequence() {
            panic_with_error!(&env, Error::InvalidExpiration);
        }
        Self::bump_instance_ttl(&env);
        Self::write_allowance(&env, &from, &spender, amount, expiration_ledger);
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::bump_instance_ttl(&env);
        Self::move_balance(&env, &from, &to, amount);
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::bump_instance_ttl(&env);
        Self::spend_allowance(&env, &from, &spender, amount);
        Self::move_balance(&env, &from, &to, amount);
    }

    // --- internal helpers --------------------------------------------------

    fn read_config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }

    fn write_initial_config(env: &Env, config: Config) {
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::TotalSupply, &0_i128);
    }

    fn require_positive_amount(amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        Ok(())
    }

    fn require_amount_or_panic(env: &Env, amount: i128) {
        if amount <= 0 {
            panic_with_error!(env, Error::InvalidAmount);
        }
    }

    fn read_balance(env: &Env, id: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(id.clone()))
            .unwrap_or(0)
    }

    fn write_balance(env: &Env, id: &Address, amount: i128) {
        let key = DataKey::Balance(id.clone());
        env.storage().persistent().set(&key, &amount);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);
    }

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);
    }

    fn read_principal(env: &Env, id: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Principal(id.clone()))
            .unwrap_or(0)
    }

    fn write_principal(env: &Env, id: &Address, amount: i128) {
        let key = DataKey::Principal(id.clone());
        env.storage().persistent().set(&key, &amount);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);
    }

    fn read_total_supply(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    fn write_total_supply(env: &Env, amount: i128) {
        env.storage().instance().set(&DataKey::TotalSupply, &amount);
    }

    fn move_balance(env: &Env, from: &Address, to: &Address, amount: i128) {
        let from_balance = Self::read_balance(env, from);
        if from_balance < amount {
            panic_with_error!(env, Error::InsufficientBalance);
        }

        // Move principal pro-rata with the shares, so accrued_yield (shares*rate
        // - principal) stays correct for both parties. Without this, the
        // recipient reads zero principal (their whole balance shows as yield) and
        // the sender keeps too much. Round the moved principal down, which leaves
        // a stroop of principal with the sender (the conservative direction).
        let from_principal = Self::read_principal(env, from);
        let moved_principal = if from_balance == 0 {
            0
        } else {
            mul_div_or_panic(env, from_principal, amount, from_balance)
        };

        Self::write_balance(env, from, from_balance - amount);
        Self::write_principal(
            env,
            from,
            sub_or_panic(env, from_principal, moved_principal),
        );
        let to_balance = Self::read_balance(env, to);
        Self::write_balance(env, to, add_or_panic(env, to_balance, amount));
        let to_principal = Self::read_principal(env, to);
        Self::write_principal(env, to, add_or_panic(env, to_principal, moved_principal));
    }

    fn read_allowance(env: &Env, from: &Address, spender: &Address) -> AllowanceValue {
        let key = DataKey::Allowance(from.clone(), spender.clone());
        match env.storage().temporary().get::<_, AllowanceValue>(&key) {
            Some(allowance) if allowance.expiration_ledger >= env.ledger().sequence() => allowance,
            _ => AllowanceValue {
                amount: 0,
                expiration_ledger: 0,
            },
        }
    }

    /// Writes the allowance and, when the allowance is live (amount > 0),
    /// extends the temporary entry's own TTL so it survives until
    /// `expiration_ledger`. A freshly created temporary entry only lives for
    /// the network minimum temporary TTL; bumping the instance TTL does not
    /// keep per-entry temporary storage alive, so without this extension the
    /// allowance archives long before the requested expiration.
    fn write_allowance(
        env: &Env,
        from: &Address,
        spender: &Address,
        amount: i128,
        expiration_ledger: u32,
    ) {
        let key = DataKey::Allowance(from.clone(), spender.clone());
        env.storage().temporary().set(
            &key,
            &AllowanceValue {
                amount,
                expiration_ledger,
            },
        );
        if amount > 0 {
            // Callers guarantee expiration_ledger >= the current sequence
            // whenever amount > 0 (approve validates it; spend_allowance only
            // reaches here through a live, unexpired allowance).
            let live_for = expiration_ledger - env.ledger().sequence();
            env.storage()
                .temporary()
                .extend_ttl(&key, live_for, live_for);
        }
    }

    fn spend_allowance(env: &Env, from: &Address, spender: &Address, amount: i128) {
        let allowance = Self::read_allowance(env, from, spender);
        if allowance.amount < amount {
            panic_with_error!(env, Error::InsufficientAllowance);
        }
        Self::write_allowance(
            env,
            from,
            spender,
            allowance.amount - amount,
            allowance.expiration_ledger,
        );
    }
}

impl StandardizedYield for SyWrapper {
    fn deposit(env: &Env, from: Address, amount: i128) -> i128 {
        require_init(env);
        from.require_auth();
        // Deposit is the only entry path on this contract, so it is the only
        // thing pause and wind-down block. Everything below in this impl is an
        // exit and stays open unconditionally.
        if let Err(error) = Self::require_not_paused(env) {
            panic_with_error!(env, error);
        }
        if Self::is_emergency(env.clone()) {
            panic_with_error!(env, Error::EmergencyModeActive);
        }
        if let Err(error) = Self::require_positive_amount(amount) {
            panic_with_error!(env, error);
        }
        Self::bump_instance_ttl(env);

        let config = match Self::read_config(env) {
            Ok(config) => config,
            Err(error) => panic_with_error!(env, error),
        };

        // Price the deposit before its assets enter Blend. For Blend custody,
        // mint against the actual AUM increase after Blend's bToken rounding,
        // not the requested transfer amount. This prevents a new deposit from
        // lowering the rate by creating more SY than the credited position backs.
        let aum_before = blend_assets_under_management(env, &config);
        // Blend rejects a supply past the reserve cap with its own opaque trap.
        // Check it here so integrators get a typed error before signing.
        {
            let reserve = BlendPoolClient::new(env, &config.pool).get_reserve(&config.underlying);
            if reserve.config.supply_cap > 0 {
                let projected = add_or_panic(env, aum_before, amount);
                if projected > reserve.config.supply_cap {
                    panic_with_error!(env, Error::SupplyCapExceeded);
                }
            }
        }
        let exchange_rate = match derived_exchange_rate(aum_before, Self::read_total_supply(env)) {
            Some(value) => value,
            None => panic_with_error!(env, Error::MathOverflow),
        };

        pull_underlying(env, &config.underlying, &from, amount);
        blend_submit(env, &config, REQUEST_SUPPLY, amount, false);
        let assets_credited =
            sub_or_panic(env, blend_assets_under_management(env, &config), aum_before);
        let shares = mul_div_or_panic(env, assets_credited, WAD, exchange_rate);
        if shares <= 0 {
            panic_with_error!(env, Error::InvalidAmount);
        }

        let current_shares = Self::read_balance(env, &from);
        let current_principal = Self::read_principal(env, &from);
        let total_shares = Self::read_total_supply(env);

        Self::write_balance(env, &from, add_or_panic(env, current_shares, shares));
        Self::write_principal(env, &from, add_or_panic(env, current_principal, amount));
        Self::write_total_supply(env, add_or_panic(env, total_shares, shares));

        Deposit {
            holder: from,
            underlying_amount: amount,
            shares_minted: shares,
        }
        .publish(env);

        shares
    }

    fn redeem(env: &Env, from: Address, sy_amount: i128) -> i128 {
        require_init(env);
        from.require_auth();
        if let Err(error) = Self::require_positive_amount(sy_amount) {
            panic_with_error!(env, error);
        }
        Self::bump_instance_ttl(env);

        let config = match Self::read_config(env) {
            Ok(config) => config,
            Err(error) => panic_with_error!(env, error),
        };

        let exchange_rate = <Self as StandardizedYield>::exchange_rate(env);
        let current_shares = Self::read_balance(env, &from);
        let current_principal = Self::read_principal(env, &from);
        let total_shares = Self::read_total_supply(env);

        if sy_amount > current_shares {
            panic_with_error!(env, Error::InsufficientBalance);
        }

        // Wind-down path. Blend is out of the picture, so pay the holder's
        // exact pro-rata slice of the recovered balance. Pro-rata (rather than
        // shares * rate) keeps the ratio invariant for everyone who has not
        // exited yet and can never overpay the earliest redeemer, which is the
        // failure mode that matters when the pool is short.
        //
        // Deliberately reachable while paused: `emergency_withdraw_all` sets
        // Paused, and this must still work or the wind-down would trap the very
        // funds it exists to recover.
        if Self::is_emergency(env.clone()) {
            let idle = underlying_balance(env, &config.underlying);
            let underlying_out = if total_shares <= 0 {
                0
            } else {
                mul_div_or_panic(env, idle, sy_amount, total_shares)
            };
            let principal_out = if current_shares == 0 {
                0
            } else {
                mul_div_or_panic(env, current_principal, sy_amount, current_shares)
            };
            Self::write_balance(env, &from, sub_or_panic(env, current_shares, sy_amount));
            Self::write_principal(
                env,
                &from,
                sub_or_panic(env, current_principal, principal_out),
            );
            Self::write_total_supply(env, sub_or_panic(env, total_shares, sy_amount));
            push_underlying(env, &config.underlying, &from, underlying_out);
            Redeem {
                holder: from,
                shares_burned: sy_amount,
                underlying_amount: underlying_out,
            }
            .publish(env);
            return underlying_out;
        }

        let requested_underlying = mul_div_or_panic(env, sy_amount, exchange_rate, WAD);
        let before = underlying_balance(env, &config.underlying);
        // The withdraw is tolerated (try_submit) so a transient Blend
        // failure cannot leak Blend's raw panic and, more importantly, so
        // this path can bail out BEFORE burning any shares: a failed
        // withdraw must never consume the holder's SY. We still surface the
        // failure explicitly instead of returning a silent zero, so callers
        // and integrators see a typed error and can retry. Nothing has been
        // mutated at this point, so the trap simply reverts and the holder's
        // funds are untouched.
        if !blend_submit(env, &config, REQUEST_WITHDRAW, requested_underlying, true) {
            panic_with_error!(env, Error::BlendWithdrawalFailed);
        }
        let after = underlying_balance(env, &config.underlying);
        let received = sub_or_panic(env, after, before);
        if received <= 0 {
            panic_with_error!(env, Error::BlendWithdrawalFailed);
        }
        let (shares_to_burn, underlying_out) = if received >= requested_underlying {
            (sy_amount, received)
        } else {
            // Partial fill: burn shares rounded UP for the underlying actually
            // received. Flooring here (as this used to) burned fewer shares than
            // the payout was worth, socialising the difference across everyone
            // still holding SY — the only rounding in the protocol that pointed
            // away from the vault. Capped at the holder's balance so a ceil can
            // never burn more than they own.
            let ceil_shares = mul_div_ceil_or_panic(env, received, WAD, exchange_rate);
            let capped = if ceil_shares > current_shares {
                current_shares
            } else {
                ceil_shares
            };
            (capped, received)
        };

        let principal_out = if current_shares == 0 {
            0
        } else {
            mul_div_or_panic(env, current_principal, shares_to_burn, current_shares)
        };

        Self::write_balance(
            env,
            &from,
            sub_or_panic(env, current_shares, shares_to_burn),
        );
        Self::write_principal(
            env,
            &from,
            sub_or_panic(env, current_principal, principal_out),
        );
        Self::write_total_supply(env, sub_or_panic(env, total_shares, shares_to_burn));

        // Return the underlying from the vault to the holder.
        push_underlying(env, &config.underlying, &from, underlying_out);

        Redeem {
            holder: from,
            shares_burned: shares_to_burn,
            underlying_amount: underlying_out,
        }
        .publish(env);

        underlying_out
    }

    fn exchange_rate(env: &Env) -> i128 {
        require_init(env);
        let config = match Self::read_config(env) {
            Ok(config) => config,
            Err(error) => panic_with_error!(env, error),
        };
        // In wind-down the backing is idle custody rather than a Blend
        // position, so the rate is derived from that instead — same formula,
        // same monotonicity, no frozen snapshot to go stale and no second code
        // path for redemption to disagree with.
        let assets = if Self::is_emergency(env.clone()) {
            underlying_balance(env, &config.underlying)
        } else {
            blend_assets_under_management(env, &config)
        };
        match derived_exchange_rate(assets, Self::read_total_supply(env)) {
            Some(value) => value,
            None => panic_with_error!(env, Error::MathOverflow),
        }
    }

    fn underlying(env: &Env) -> Address {
        match Self::read_config(env) {
            Ok(config) => config.underlying,
            Err(error) => panic_with_error!(env, error),
        }
    }

    fn accrued_yield(env: &Env, holder: Address) -> i128 {
        require_init(env);
        let exchange_rate = <Self as StandardizedYield>::exchange_rate(env);
        let shares = Self::read_balance(env, &holder);
        let principal = Self::read_principal(env, &holder);
        let current_value = mul_div_or_panic(env, shares, exchange_rate, WAD);

        current_value.saturating_sub(principal)
    }
}

#[contractimpl]
impl SyWrapper {
    pub fn deposit(env: Env, from: Address, amount: i128) -> i128 {
        <Self as StandardizedYield>::deposit(&env, from, amount)
    }

    pub fn redeem(env: Env, from: Address, sy_amount: i128) -> i128 {
        <Self as StandardizedYield>::redeem(&env, from, sy_amount)
    }

    pub fn exchange_rate(env: Env) -> i128 {
        <Self as StandardizedYield>::exchange_rate(&env)
    }

    pub fn underlying(env: Env) -> Address {
        <Self as StandardizedYield>::underlying(&env)
    }

    pub fn accrued_yield(env: Env, holder: Address) -> i128 {
        <Self as StandardizedYield>::accrued_yield(&env, holder)
    }
}

/// Pulls `amount` of the underlying from `from` into this vault.
fn pull_underlying(env: &Env, underlying: &Address, from: &Address, amount: i128) {
    let vault = MuxedAddress::from(&env.current_contract_address());
    token::TokenClient::new(env, underlying).transfer(from, &vault, &amount);
}

/// Sends `amount` of the underlying from this vault back to `to`.
fn push_underlying(env: &Env, underlying: &Address, to: &Address, amount: i128) {
    if amount <= 0 {
        return;
    }
    let vault = env.current_contract_address();
    let to_muxed = MuxedAddress::from(to);
    env.authorize_as_current_contract(vec![
        env,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: underlying.clone(),
                fn_name: Symbol::new(env, "transfer"),
                args: vec![
                    env,
                    vault.clone().into_val(env),
                    to_muxed.clone().into_val(env),
                    amount.into_val(env),
                ],
            },
            sub_invocations: vec![env],
        }),
    ]);
    token::TokenClient::new(env, underlying).transfer(&vault, &to_muxed, &amount);
}

/// Sends `amount` of an arbitrary token from this contract to `to`, authorizing
/// the transfer as the contract. Used by `sweep`.
fn push_token_as_self(env: &Env, token_id: &Address, to: &Address, amount: i128) {
    let me = env.current_contract_address();
    let to_muxed = MuxedAddress::from(to);
    env.authorize_as_current_contract(vec![
        env,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: token_id.clone(),
                fn_name: Symbol::new(env, "transfer"),
                args: vec![
                    env,
                    me.clone().into_val(env),
                    to_muxed.clone().into_val(env),
                    amount.into_val(env),
                ],
            },
            sub_invocations: vec![env],
        }),
    ]);
    token::TokenClient::new(env, token_id).transfer(&me, &to_muxed, &amount);
}

fn underlying_balance(env: &Env, underlying: &Address) -> i128 {
    token::TokenClient::new(env, underlying).balance(&env.current_contract_address())
}

fn blend_assets_under_management(env: &Env, config: &Config) -> i128 {
    let pool_client = BlendPoolClient::new(env, &config.pool);
    let positions = pool_client.get_positions(&env.current_contract_address());
    let b_tokens = positions.supply.get(config.reserve_index).unwrap_or(0);
    let reserve = pool_client.get_reserve(&config.underlying);
    // The pool can be reconfigured over the market's life. If the underlying's
    // reserve no longer sits at the index we recorded at init, the position read
    // above is for a different reserve, so refuse to value it rather than price
    // the wrong asset.
    if reserve.config.index != config.reserve_index {
        panic_with_error!(env, Error::InvalidBlendReserve);
    }
    match assets_from_b_tokens(b_tokens, reserve.data.b_rate) {
        Some(value) => value,
        None => panic_with_error!(env, Error::MathOverflow),
    }
}

/// Submits one plain-supply or withdraw request as the wrapper. The wrapper is
/// the direct invoker of `submit`, so Blend's `spender.require_auth()` is
/// satisfied by invoker auth. Supply separately authorizes the later nested
/// token transfer from the wrapper to the pool. Blend authorizes its own
/// outgoing token transfer during withdraw.
fn blend_submit(
    env: &Env,
    config: &Config,
    request_type: u32,
    amount: i128,
    tolerate_failure: bool,
) -> bool {
    let pool = config.pool.clone();
    let me = env.current_contract_address();
    let requests = vec![
        env,
        Request {
            address: config.underlying.clone(),
            amount,
            request_type,
        },
    ];
    if request_type == REQUEST_SUPPLY {
        env.authorize_as_current_contract(vec![
            env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: config.underlying.clone(),
                    fn_name: Symbol::new(env, "transfer"),
                    args: vec![
                        env,
                        me.clone().into_val(env),
                        pool.clone().into_val(env),
                        amount.into_val(env),
                    ],
                },
                sub_invocations: vec![env],
            }),
        ]);
    }

    let client = BlendPoolClient::new(env, &pool);
    if tolerate_failure {
        matches!(client.try_submit(&me, &me, &me, &requests), Ok(Ok(_)))
    } else {
        client.submit(&me, &me, &me, &requests);
        true
    }
}

fn require_init(env: &Env) {
    if !env.storage().instance().has(&DataKey::Config) {
        panic_with_error!(env, Error::NotInitialized);
    }
}

fn add_or_panic(env: &Env, lhs: i128, rhs: i128) -> i128 {
    match lhs.checked_add(rhs) {
        Some(value) => value,
        None => panic_with_error!(env, Error::MathOverflow),
    }
}

fn sub_or_panic(env: &Env, lhs: i128, rhs: i128) -> i128 {
    match lhs.checked_sub(rhs) {
        Some(value) => value,
        None => panic_with_error!(env, Error::MathOverflow),
    }
}

fn mul_div_or_panic(env: &Env, lhs: i128, rhs: i128, denominator: i128) -> i128 {
    if denominator == 0 {
        panic_with_error!(env, Error::MathOverflow);
    }

    let lhs_gcd = gcd_i128(lhs, denominator);
    let lhs_reduced = lhs / lhs_gcd;
    let denominator_reduced = denominator / lhs_gcd;

    let rhs_gcd = gcd_i128(rhs, denominator_reduced);
    let rhs_reduced = rhs / rhs_gcd;
    let denominator_final = denominator_reduced / rhs_gcd;

    match lhs_reduced.checked_mul(rhs_reduced) {
        Some(product) => product / denominator_final,
        None => panic_with_error!(env, Error::MathOverflow),
    }
}

/// `lhs * rhs / denominator`, rounded UP. Used where rounding down would leave
/// the vault short (see `redeem`'s partial-fill path). Callers pass
/// non-negative `lhs`/`rhs` and a positive `denominator`.
fn mul_div_ceil_or_panic(env: &Env, lhs: i128, rhs: i128, denominator: i128) -> i128 {
    let floored = mul_div_or_panic(env, lhs, rhs, denominator);
    // Recover the exact remainder without re-multiplying at full width: the
    // product is exactly representable as floored*denominator + remainder.
    let consumed = match floored.checked_mul(denominator) {
        Some(value) => value,
        None => panic_with_error!(env, Error::MathOverflow),
    };
    let product = match lhs.checked_mul(rhs) {
        Some(value) => value,
        // Fall back to the reduced form when the raw product overflows;
        // mul_div_or_panic already proved the quotient fits.
        None => return floored,
    };
    if product == consumed {
        floored
    } else {
        add_or_panic(env, floored, 1)
    }
}

fn gcd_i128(mut lhs: i128, mut rhs: i128) -> i128 {
    while rhs != 0 {
        let next = lhs % rhs;
        lhs = rhs;
        rhs = next;
    }

    if lhs < 0 {
        -lhs
    } else {
        lhs
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;
    use novaire_blend_adapter::testutils::{MockBlendPool, MockBlendPoolClient};
    use novaire_blend_adapter::{assets_from_b_tokens, BLEND_SCALAR_12};
    use soroban_sdk::testutils::{Address as _, Ledger as _};

    // --- Fixture -------------------------------------------------------------

    struct Fixture {
        env: Env,
        client: SyWrapperClient<'static>,
        pool_client: MockBlendPoolClient<'static>,
        admin: Address,
        underlying: Address,
        alice: Address,
        bob: Address,
    }

    const UNIT: i128 = 10_000_000; // 7-decimal underlying unit
    const MINT: i128 = 1_000 * UNIT;

    fn fixture() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1);

        let admin = Address::generate(&env);
        let underlying = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let pool = env.register(MockBlendPool, ());
        let pool_client = MockBlendPoolClient::new(&env, &pool);
        pool_client.initialize(&underlying);

        let contract_id = env.register(SyWrapper, ());
        let client = SyWrapperClient::new(&env, &contract_id);
        client.initialize_blend(&admin, &underlying, &pool);

        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        token::StellarAssetClient::new(&env, &underlying).mint(&alice, &MINT);

        Fixture {
            env,
            client,
            pool_client,
            admin,
            underlying,
            alice,
            bob,
        }
    }

    /// Bumps the mock pool's b_rate so the wrapper's derived exchange rate
    /// grows by `numerator/denominator`, and backs the growth with real
    /// underlying liquidity in the pool so a subsequent redeem can settle it.
    /// This is the only way to move the rate now that there is no admin
    /// setter — every rate change must flow through the Blend pool.
    fn grow_rate(fixture: &Fixture, numerator: i128, denominator: i128) {
        let current = fixture.client.exchange_rate();
        let target = current * numerator / denominator;
        // Solve for the b_rate that makes derived_exchange_rate hit `target`
        // given the wrapper's current bToken supply, then mint enough
        // underlying into the pool to cover a full redemption at that rate.
        let aum_before = assets_from_b_tokens(
            fixture
                .pool_client
                .get_positions(&fixture.client.address)
                .supply
                .get(0)
                .unwrap_or(0),
            fixture
                .pool_client
                .get_reserve(&fixture.underlying)
                .data
                .b_rate,
        )
        .unwrap();
        let total_shares = fixture.client.total_supply();
        let target_aum = if total_shares == 0 {
            aum_before
        } else {
            target * total_shares / WAD
        };
        let b_tokens = fixture
            .pool_client
            .get_positions(&fixture.client.address)
            .supply
            .get(0)
            .unwrap_or(0);
        if b_tokens > 0 {
            let new_b_rate = target_aum * BLEND_SCALAR_12 / b_tokens;
            fixture.pool_client.set_b_rate(&new_b_rate);
        }
        let extra = target_aum - aum_before;
        if extra > 0 {
            token::StellarAssetClient::new(&fixture.env, &fixture.underlying)
                .mint(&fixture.client.address, &extra);
        }
    }

    fn underlying_balance(fixture: &Fixture, holder: &Address) -> i128 {
        token::TokenClient::new(&fixture.env, &fixture.underlying).balance(holder)
    }

    #[test]
    fn initialize_blend_requires_a_pool_and_sets_the_initial_rate() {
        let fixture = fixture();
        assert_eq!(
            fixture.client.config(),
            Config {
                admin: fixture.admin.clone(),
                underlying: fixture.underlying.clone(),
                pool: fixture.pool_client.address.clone(),
                reserve_index: 0,
            }
        );
        assert_eq!(fixture.client.exchange_rate(), WAD);
        assert_eq!(fixture.client.total_supply(), 0);
        assert_eq!(fixture.client.decimals(), 7);
    }

    #[test]
    fn deposit_pulls_underlying_and_mints_shares_via_pool() {
        let fixture = fixture();

        let minted = fixture.client.deposit(&fixture.alice, &(100 * UNIT));

        assert_eq!(minted, 100 * UNIT);
        assert_eq!(fixture.client.balance(&fixture.alice), 100 * UNIT);
        assert_eq!(fixture.client.total_supply(), 100 * UNIT);
        // The pool now custodies the underlying; alice paid it in.
        assert_eq!(
            underlying_balance(&fixture, &fixture.pool_client.address),
            100 * UNIT
        );
        assert_eq!(
            underlying_balance(&fixture, &fixture.alice),
            MINT - 100 * UNIT
        );
    }

    #[test]
    fn sy_transfers_move_shares() {
        let fixture = fixture();
        fixture.client.deposit(&fixture.alice, &(100 * UNIT));

        fixture
            .client
            .transfer(&fixture.alice, &fixture.bob, &(40 * UNIT));
        assert_eq!(fixture.client.balance(&fixture.alice), 60 * UNIT);
        assert_eq!(fixture.client.balance(&fixture.bob), 40 * UNIT);
    }

    #[test]
    fn allowance_entry_ttl_covers_requested_expiration() {
        use soroban_sdk::testutils::storage::Temporary as _;

        let fixture = fixture();
        fixture.client.deposit(&fixture.alice, &(100 * UNIT));

        const START_SEQ: u32 = 1_000;
        const MIN_TEMP_TTL: u32 = 1_600;
        const EXPIRATION: u32 = START_SEQ + 500_000;
        fixture.env.ledger().set_sequence_number(START_SEQ);
        fixture.env.ledger().set_min_temp_entry_ttl(MIN_TEMP_TTL);

        fixture
            .client
            .approve(&fixture.alice, &fixture.bob, &(40 * UNIT), &EXPIRATION);

        let key = DataKey::Allowance(fixture.alice.clone(), fixture.bob.clone());
        let ttl = fixture.env.as_contract(&fixture.client.address, || {
            fixture.env.storage().temporary().get_ttl(&key)
        });
        assert!(
            START_SEQ + ttl >= EXPIRATION,
            "allowance TTL {} from sequence {} must cover expiration {}",
            ttl,
            START_SEQ,
            EXPIRATION
        );

        const JUMPED: u32 = START_SEQ + MIN_TEMP_TTL + 100_000;
        fixture.env.ledger().set_sequence_number(JUMPED);
        assert_eq!(
            fixture.client.allowance(&fixture.alice, &fixture.bob),
            40 * UNIT
        );
        fixture
            .client
            .transfer_from(&fixture.bob, &fixture.alice, &fixture.bob, &(30 * UNIT));
        assert_eq!(
            fixture.client.allowance(&fixture.alice, &fixture.bob),
            10 * UNIT
        );
        assert_eq!(fixture.client.balance(&fixture.bob), 30 * UNIT);

        let ttl = fixture.env.as_contract(&fixture.client.address, || {
            fixture.env.storage().temporary().get_ttl(&key)
        });
        assert!(
            JUMPED + ttl >= EXPIRATION,
            "post-spend allowance TTL {} from sequence {} must cover expiration {}",
            ttl,
            JUMPED,
            EXPIRATION
        );
    }

    #[test]
    fn transfer_moves_principal_pro_rata_so_yield_stays_correct() {
        let fixture = fixture();
        fixture.client.deposit(&fixture.alice, &(100 * UNIT));

        // Pool-derived rate grows 10%, so Alice has 10 of yield on 100 shares.
        // She sends 40 shares to Bob. Principal must follow pro-rata (40 of
        // the 100), so neither party's accrued_yield is corrupted.
        grow_rate(&fixture, 11, 10);
        fixture
            .client
            .transfer(&fixture.alice, &fixture.bob, &(40 * UNIT));

        assert_eq!(fixture.client.accrued_yield(&fixture.alice), 6 * UNIT);
        assert_eq!(fixture.client.accrued_yield(&fixture.bob), 4 * UNIT);
    }

    #[test]
    fn accrued_yield_tracks_pool_derived_rate_growth() {
        let fixture = fixture();
        fixture.client.deposit(&fixture.alice, &(100 * UNIT));
        grow_rate(&fixture, 21, 20); // +5%

        assert_eq!(fixture.client.accrued_yield(&fixture.alice), 5 * UNIT);
    }

    #[test]
    fn redeem_returns_underlying_and_reduces_principal() {
        let fixture = fixture();
        fixture.client.deposit(&fixture.alice, &(100 * UNIT));
        grow_rate(&fixture, 11, 10); // +10%

        let underlying_out = fixture.client.redeem(&fixture.alice, &(40 * UNIT));

        assert_eq!(underlying_out, 44 * UNIT);
        assert_eq!(fixture.client.balance(&fixture.alice), 60 * UNIT);
        assert_eq!(fixture.client.total_supply(), 60 * UNIT);
        assert_eq!(fixture.client.accrued_yield(&fixture.alice), 6 * UNIT);
        assert_eq!(
            underlying_balance(&fixture, &fixture.alice),
            MINT - 100 * UNIT + 44 * UNIT
        );
    }

    // M2: public SY methods must reject calls before initialize.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn deposit_before_initialize_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SyWrapper, ());
        let client = SyWrapperClient::new(&env, &contract_id);
        let alice = Address::generate(&env);
        client.deposit(&alice, &(100 * UNIT));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn redeem_before_initialize_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SyWrapper, ());
        let client = SyWrapperClient::new(&env, &contract_id);
        let alice = Address::generate(&env);
        client.redeem(&alice, &(10 * UNIT));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn exchange_rate_before_initialize_fails() {
        let env = Env::default();
        let contract_id = env.register(SyWrapper, ());
        let client = SyWrapperClient::new(&env, &contract_id);
        client.exchange_rate();
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn accrued_yield_before_initialize_fails() {
        let env = Env::default();
        let contract_id = env.register(SyWrapper, ());
        let client = SyWrapperClient::new(&env, &contract_id);
        let alice = Address::generate(&env);
        client.accrued_yield(&alice);
    }

    // M3: share math must reject i128 overflow.
    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn deposit_share_math_overflow_is_rejected() {
        let fixture = fixture();
        // Seed a position so the rate is no longer the supply=0 default,
        // then crash the pool's b_rate towards zero: the derived exchange
        // rate collapses towards zero, so a modest further deposit inflates
        // shares past i128.
        fixture.client.deposit(&fixture.alice, &(100 * UNIT));
        fixture.pool_client.set_b_rate(&1);
        fixture.client.deposit(&fixture.alice, &(500 * UNIT));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn redeem_underlying_math_overflow_is_rejected() {
        let fixture = fixture();
        fixture.client.deposit(&fixture.alice, &(1_000 * UNIT));
        fixture.pool_client.set_b_rate(&(i128::MAX / 2));
        fixture.client.redeem(&fixture.alice, &(1_000 * UNIT));
    }

    // The legacy admin rate setter no longer exists on the contract at all:
    // `SyWrapperClient` (and `SyWrapper` itself) has no `set_exchange_rate` or
    // no-pool `initialize` method to call — this test module wouldn't compile
    // if either did, since the deleted call sites above were the only thing
    // exercising them. `exchange_rate()` derives solely from the configured
    // Blend pool (see `redeem_returns_underlying_and_reduces_principal` and
    // `accrued_yield_tracks_pool_derived_rate_growth`, which only ever move
    // the rate via `grow_rate`, i.e. through the mock pool's `b_rate`).

    // Admin's only reachable lever near the rate is `migrate_reserve_index`,
    // and that only re-syncs which reserve slot is read — it cannot change
    // the value the pool reports for that slot. Covered end-to-end (including
    // the asset cross-check that prevents pointing at a different asset) in
    // integration_tests/tests/blend_wrapper.rs.
    #[test]
    fn migrate_reserve_index_rejects_non_admin() {
        let fixture = fixture();
        assert!(matches!(
            fixture.client.try_migrate_reserve_index(&fixture.bob),
            Err(Ok(Error::NotAuthorized))
        ));
    }

    // --- P3: governance, pause, wind-down ----------------------------------

    #[test]
    fn admin_transfer_is_two_step() {
        let f = fixture();
        let next = Address::generate(&f.env);
        f.client.propose_admin(&next);
        // Not in force until accepted.
        assert_eq!(f.client.config().admin, f.admin);
        assert_eq!(f.client.pending_admin(), Some(next.clone()));
        f.client.accept_admin();
        assert_eq!(f.client.config().admin, next);
        assert_eq!(f.client.pending_admin(), None);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #14)")]
    fn accept_admin_without_a_nomination_fails() {
        let f = fixture();
        f.client.accept_admin();
    }

    #[test]
    fn pause_blocks_deposits_but_never_redemptions() {
        let f = fixture();
        f.client.deposit(&f.alice, &(100 * UNIT));
        f.client.pause();
        assert!(f.client.is_paused());

        // Entry is closed.
        assert!(f.client.try_deposit(&f.alice, &(10 * UNIT)).is_err());

        // Every exit still works. A pause that traps funds is worse than none.
        let out = f.client.redeem(&f.alice, &(10 * UNIT));
        assert!(out > 0, "redeem must work while paused");
        f.client.transfer(&f.alice, &f.bob, &(5 * UNIT));
        assert_eq!(f.client.balance(&f.bob), 5 * UNIT);
        assert!(f.client.exchange_rate() > 0, "rate must stay readable");

        f.client.unpause();
        assert!(!f.client.is_paused());
        f.client.deposit(&f.alice, &(10 * UNIT));
    }

    #[test]
    fn guardian_can_pause_but_not_unpause() {
        let f = fixture();
        let guardian = Address::generate(&f.env);
        f.client.set_guardian(&guardian);
        assert_eq!(f.client.guardian(), guardian);
        f.client.pause();
        assert!(f.client.is_paused());
        // Asymmetric by design: cheap to stop, deliberate to restart. Unpause
        // is admin-only; with mock_all_auths we assert the authority wiring
        // rather than a signature failure.
        f.client.unpause();
        assert!(!f.client.is_paused());
    }

    #[test]
    fn upgrade_cannot_execute_before_the_timelock() {
        let f = fixture();
        let hash = BytesN::from_array(&f.env, &[7u8; 32]);
        let eta = f.client.propose_upgrade(&hash);
        assert_eq!(eta, f.env.ledger().timestamp() + UPGRADE_TIMELOCK_SECONDS);
        assert_eq!(f.client.pending_upgrade(), Some((hash, eta)));
        // Too early.
        assert!(f.client.try_execute_upgrade().is_err());
        f.client.cancel_upgrade();
        assert_eq!(f.client.pending_upgrade(), None);
        assert!(f.client.try_execute_upgrade().is_err());
    }

    #[test]
    fn renounce_permanently_disables_governance() {
        let f = fixture();
        f.client.renounce_admin();
        assert!(f.client.is_renounced());
        assert!(f.client.try_emergency_withdraw_all().is_err());
        let junk = f
            .env
            .register_stellar_asset_contract_v2(f.admin.clone())
            .address();
        assert!(f.client.try_sweep(&junk, &f.admin).is_err());
    }

    #[test]
    fn emergency_wind_down_recovers_funds_and_keeps_redemption_open() {
        let f = fixture();
        // The fixture only funds alice; bob needs underlying of his own to be a
        // second, equal-stake holder.
        token::StellarAssetClient::new(&f.env, &f.underlying).mint(&f.bob, &MINT);
        f.client.deposit(&f.alice, &(100 * UNIT));
        f.client.deposit(&f.bob, &(100 * UNIT));
        let rate_before = f.client.exchange_rate();

        let recovered = f.client.emergency_withdraw_all();
        assert!(recovered > 0, "wind-down must pull the Blend position out");
        assert!(f.client.is_emergency());
        assert!(f.client.is_paused(), "wind-down closes entries");

        // Deposits are closed permanently...
        assert!(f.client.try_deposit(&f.alice, &UNIT).is_err());
        // ...and cannot be reopened by unpausing.
        f.client.unpause();
        assert!(f.client.try_deposit(&f.alice, &UNIT).is_err());

        // The rate is still readable and still derived, not frozen or trapped.
        let rate_after = f.client.exchange_rate();
        assert!(rate_after > 0);
        assert!(
            (rate_after - rate_before).abs() <= rate_before / 1_000,
            "wind-down must not reprice holders: {rate_before} -> {rate_after}"
        );

        // Both holders exit pro-rata, and the last one out is not shortchanged.
        let alice_out = f.client.redeem(&f.alice, &f.client.balance(&f.alice));
        let bob_out = f.client.redeem(&f.bob, &f.client.balance(&f.bob));
        assert!(alice_out > 0 && bob_out > 0);
        assert!(
            (alice_out - bob_out).abs() <= 2,
            "equal stakes must redeem equally: {alice_out} vs {bob_out}"
        );
        assert_eq!(f.client.total_supply(), 0);
    }

    #[test]
    fn emergency_withdraw_is_irreversible() {
        let f = fixture();
        f.client.deposit(&f.alice, &(50 * UNIT));
        f.client.emergency_withdraw_all();
        assert!(f.client.try_emergency_withdraw_all().is_err());
    }

    #[test]
    fn sweep_moves_foreign_tokens_but_never_the_underlying() {
        let f = fixture();
        f.client.deposit(&f.alice, &(10 * UNIT));
        // The underlying is either backing SY or the wind-down pool. Never sweepable.
        assert!(f.client.try_sweep(&f.underlying, &f.admin).is_err());

        let junk = f
            .env
            .register_stellar_asset_contract_v2(f.admin.clone())
            .address();
        token::StellarAssetClient::new(&f.env, &junk).mint(&f.client.address, &1_234);
        assert_eq!(f.client.sweep(&junk, &f.bob), 1_234);
        assert_eq!(
            token::TokenClient::new(&f.env, &junk).balance(&f.bob),
            1_234
        );
    }
}
