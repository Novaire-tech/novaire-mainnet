// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use core::cmp::min;

use novaire_shared_types::Market;
use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    vec, Address, BytesN, Env, IntoVal, MuxedAddress, Symbol, Val, Vec,
};

const WAD: i128 = 1_000_000_000_000_000_000;
const BPS_DENOMINATOR: i128 = 10_000;
const DAY: u64 = 86_400;
const IMPLIED_RATE_TIME: u64 = 365 * DAY;
const MINIMUM_LIQUIDITY: i128 = 1_000;
const MAX_MARKET_PROPORTION: i128 = (WAD * 96) / 100;
// Conservative testnet caps on reserves and curve parameters. These were
// originally sized to keep values in the float-safe range of the old f64 curve
// helpers. The curve is integer fixed-point now, so the names no longer refer
// to floats; the caps are kept as a conservative product limit that also keeps
// the i128 intermediate products well clear of overflow. Re-deriving the exact
// i128 overflow bound is future work; these values are unchanged.
const MAX_RESERVE_UNITS: i128 = WAD;
const MAX_SCALAR_ROOT: i128 = 10 * WAD;
const MAX_ANCHOR: i128 = 2 * WAD;
const LEDGERS_PER_DAY: u32 = 17_280;
const AMM_INSTANCE_TTL_THRESHOLD_LEDGERS: u32 = 30 * LEDGERS_PER_DAY;
const AMM_INSTANCE_TTL_EXTEND_TO_LEDGERS: u32 = 120 * LEDGERS_PER_DAY;

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Config {
    pub admin: Address,
    pub pt_token: Address,
    pub sy_token: Address,
    pub yt_token: Address,
    pub tokenizer: Address,
    pub maturity: u64,
    pub scalar_root: i128,
    pub initial_anchor: i128,
    pub fee_bps: i128,
    pub twap_window: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct State {
    pub total_pt: i128,
    pub total_sy: i128,
    pub total_lp: i128,
    pub last_ln_implied_rate: i128,
    pub twap_ln_implied_rate: i128,
    pub last_observation: u64,
    pub warmup_until: u64,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Config,
    State,
    LpBalance(Address),
    /// Blocks swaps and add_liquidity. remove_liquidity is never blocked.
    Paused,
    PendingAdmin,
    /// May pause but never unpause. Defaults to the admin when unset.
    Guardian,
    /// `(wasm_hash, eta)` for a timelocked upgrade.
    PendingUpgrade,
    /// Set by `renounce_admin`. Irreversible.
    Renounced,
    /// Share of the swap fee routed to the treasury, in bps of the fee (not of
    /// the trade). Ships at 0.
    ProtocolFeeShareBps,
    /// Where the protocol's fee share accrues. Unset until configured.
    Treasury,
    /// SY accrued to the treasury and not yet withdrawn.
    ProtocolFeesAccrued,
}

/// Timelock on `execute_upgrade`, in seconds.
const UPGRADE_TIMELOCK_SECONDS: u64 = 72 * 60 * 60;

/// Ceiling on the protocol's share of the swap fee: 50%. LPs always keep at
/// least half of what they earn, whatever governance decides.
const MAX_PROTOCOL_FEE_SHARE_BPS: i128 = 5_000;

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
#[contracterror]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidMaturity = 3,
    InvalidAmount = 4,
    InvalidScalarRoot = 5,
    InvalidAnchor = 6,
    InvalidFee = 7,
    InvalidTwapWindow = 8,
    MarketNotSeeded = 9,
    MarketMatured = 10,
    SlippageExceeded = 11,
    InsufficientLiquidity = 12,
    MathOverflow = 13,
    MarketProportionTooHigh = 14,
    ExchangeRateBelowOne = 15,
    UnsupportedRoute = 16,
    TradeNotFound = 17,
    InputOutOfBounds = 18,
    InvalidSyRate = 19,
    /// An entry path was called while paused. remove_liquidity is never blocked.
    Paused = 20,
    NotAuthorized = 21,
    NotPendingAdmin = 22,
    UpgradeNotReady = 23,
    ProtectedAsset = 24,
    /// Protocol fee share above MAX_PROTOCOL_FEE_SHARE_BPS, or no treasury set.
    InvalidProtocolFee = 25,
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

/// Emitted on pause and unpause.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PauseChanged {
    pub paused: bool,
}

/// Emitted when an upgrade is scheduled; `eta` is the earliest it can execute.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeProposed {
    pub wasm_hash: BytesN<32>,
    pub eta: u64,
}

/// Emitted when the protocol fee split changes.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolFeeChanged {
    pub share_bps: i128,
    pub treasury: Address,
}

/// Emitted on any AMM swap (PT<->SY direct, SY<->YT via flash route).
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Swap {
    #[topic]
    pub trader: Address,
    #[topic]
    pub route: Symbol,
    pub amount_in: i128,
    pub amount_out: i128,
}

/// Emitted when liquidity is added to the pool.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AddLiquidity {
    #[topic]
    pub provider: Address,
    pub pt_in: i128,
    pub sy_in: i128,
    pub lp_out: i128,
}

/// Emitted when liquidity is removed from the pool.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RemoveLiquidity {
    #[topic]
    pub provider: Address,
    pub lp_in: i128,
    pub pt_out: i128,
    pub sy_out: i128,
}

struct Precompute {
    rate_scalar: i128,
    total_asset: i128,
    rate_anchor: i128,
    time_to_expiry: u64,
    /// The SY exchange rate (asset per share, WAD scaled) used to derive
    /// `total_asset` from `state.total_sy`. Carried alongside so swap math can
    /// convert its asset-denominated results back to SY units without a
    /// second cross-contract read.
    rate: i128,
}

#[inline(never)]
fn load_live_market(env: &Env, amount: i128) -> Result<(Config, State, Precompute), Error> {
    require_bounded_amount_result(amount)?;
    let config = read_config(env)?;
    require_live_result(env, &config)?;
    let state = read_state(env)?;
    require_seeded_result(&state)?;
    let comp = precompute_or_panic(env, &config, &state);
    Ok((config, state, comp))
}

/// Loads the market for a state-changing trade. Every swap goes through here,
/// so the pause gate lives here too. Read-only `quote_*` deliberately use
/// `load_live_market` directly and stay callable while paused, so a paused
/// market is still legible rather than opaque.
fn load_live_market_or_panic(env: &Env, amount: i128) -> (Config, State, Precompute) {
    require_not_paused(env);
    match load_live_market(env, amount) {
        Ok(loaded) => loaded,
        Err(error) => panic_with_error!(env, error),
    }
}

#[inline(never)]
fn settle_and_record(
    env: &Env,
    config: &Config,
    state: &mut State,
    observed_ln_rate: i128,
    pt_dust: i128,
    sy_dust: i128,
) {
    credit_flash_dust(env, state, pt_dust, sy_dust);
    sync_twap(env, config, state, observed_ln_rate);
    write_state(env, state);
}

/// Plain PT<->SY trades move exactly the amounts `state` already recorded, so
/// they carry no dust. Kept as a named alias of `settle_and_record(.., 0, 0)`
/// to make that property explicit at the call site.
#[inline(never)]
fn settle_and_record_without_dust(
    env: &Env,
    config: &Config,
    state: &mut State,
    observed_ln_rate: i128,
) {
    settle_and_record(env, config, state, observed_ln_rate, 0, 0);
}

#[contract]
pub struct AmmMarket;

#[contractimpl]
impl AmmMarket {
    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        env: Env,
        admin: Address,
        pt_token: Address,
        sy_token: Address,
        yt_token: Address,
        tokenizer: Address,
        maturity: u64,
        scalar_root: i128,
        initial_anchor: i128,
        fee_bps: i128,
        twap_window: u64,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        if maturity <= env.ledger().timestamp() {
            return Err(Error::InvalidMaturity);
        }
        if scalar_root <= 0 {
            return Err(Error::InvalidScalarRoot);
        }
        if scalar_root > MAX_SCALAR_ROOT {
            return Err(Error::InputOutOfBounds);
        }
        if initial_anchor < WAD {
            return Err(Error::InvalidAnchor);
        }
        if initial_anchor > MAX_ANCHOR {
            return Err(Error::InputOutOfBounds);
        }
        if !(0..BPS_DENOMINATOR).contains(&fee_bps) {
            return Err(Error::InvalidFee);
        }
        if twap_window == 0 {
            return Err(Error::InvalidTwapWindow);
        }

        let config = Config {
            admin,
            pt_token,
            sy_token,
            yt_token,
            tokenizer,
            maturity,
            scalar_root,
            initial_anchor,
            fee_bps,
            twap_window,
        };
        let state = State {
            total_pt: 0,
            total_sy: 0,
            total_lp: 0,
            last_ln_implied_rate: 0,
            twap_ln_implied_rate: 0,
            last_observation: env.ledger().timestamp(),
            warmup_until: env.ledger().timestamp() + twap_window,
        };

        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::State, &state);
        bump_instance_ttl(&env);

        Ok(())
    }

    pub fn config(env: Env) -> Result<Config, Error> {
        read_config(&env)
    }

    // --- governance --------------------------------------------------------

    pub fn propose_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let config = read_config(&env)?;
        config.admin.require_auth();
        bump_instance_ttl(&env);
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        AdminProposed { new_admin }.publish(&env);
        Ok(())
    }

    pub fn accept_admin(env: Env) -> Result<(), Error> {
        let mut config = read_config(&env)?;
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
        bump_instance_ttl(&env);
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

    pub fn set_guardian(env: Env, guardian: Address) -> Result<(), Error> {
        let config = read_config(&env)?;
        config.admin.require_auth();
        bump_instance_ttl(&env);
        env.storage().instance().set(&DataKey::Guardian, &guardian);
        Ok(())
    }

    pub fn guardian(env: Env) -> Result<Address, Error> {
        let config = read_config(&env)?;
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

    /// Halts all four swaps and `add_liquidity`. Guardian or admin.
    ///
    /// `remove_liquidity` is deliberately never blocked: an LP must always be
    /// able to withdraw. Quotes stay readable too, so a paused market is still
    /// legible rather than opaque.
    pub fn pause(env: Env) -> Result<(), Error> {
        let config = read_config(&env)?;
        let guardian: Address = env
            .storage()
            .instance()
            .get(&DataKey::Guardian)
            .unwrap_or(config.admin);
        guardian.require_auth();
        bump_instance_ttl(&env);
        env.storage().instance().set(&DataKey::Paused, &true);
        PauseChanged { paused: true }.publish(&env);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), Error> {
        let config = read_config(&env)?;
        config.admin.require_auth();
        bump_instance_ttl(&env);
        env.storage().instance().set(&DataKey::Paused, &false);
        PauseChanged { paused: false }.publish(&env);
        Ok(())
    }

    pub fn propose_upgrade(env: Env, wasm_hash: BytesN<32>) -> Result<u64, Error> {
        let config = read_config(&env)?;
        config.admin.require_auth();
        require_not_renounced(&env)?;
        let eta = env
            .ledger()
            .timestamp()
            .checked_add(UPGRADE_TIMELOCK_SECONDS)
            .ok_or(Error::MathOverflow)?;
        bump_instance_ttl(&env);
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
        let config = read_config(&env)?;
        config.admin.require_auth();
        env.storage().instance().remove(&DataKey::PendingUpgrade);
        Ok(())
    }

    pub fn execute_upgrade(env: Env) -> Result<(), Error> {
        let config = read_config(&env)?;
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

    pub fn renounce_admin(env: Env) -> Result<(), Error> {
        let config = read_config(&env)?;
        config.admin.require_auth();
        env.storage().instance().remove(&DataKey::PendingUpgrade);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.storage().instance().set(&DataKey::Renounced, &true);
        Ok(())
    }

    pub fn is_renounced(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Renounced)
            .unwrap_or(false)
    }

    // --- protocol fee switch (ships OFF) -----------------------------------

    /// Routes `share_bps` of the *swap fee* (not of the trade) to `treasury`.
    ///
    /// Ships at 0, so launch economics are byte-identical to having no switch
    /// at all. It exists because the alternative — adding it later — is
    /// impossible once governance is renounced, and a protocol with no revenue
    /// path is not a business. Capped at 50% of the fee so LPs always keep the
    /// majority of what they earn.
    pub fn set_protocol_fee(env: Env, share_bps: i128, treasury: Address) -> Result<(), Error> {
        let config = read_config(&env)?;
        config.admin.require_auth();
        require_not_renounced(&env)?;
        if !(0..=MAX_PROTOCOL_FEE_SHARE_BPS).contains(&share_bps) {
            return Err(Error::InvalidProtocolFee);
        }
        bump_instance_ttl(&env);
        env.storage()
            .instance()
            .set(&DataKey::ProtocolFeeShareBps, &share_bps);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        ProtocolFeeChanged {
            share_bps,
            treasury,
        }
        .publish(&env);
        Ok(())
    }

    pub fn protocol_fee_share_bps(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::ProtocolFeeShareBps)
            .unwrap_or(0)
    }

    pub fn protocol_fees_accrued(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::ProtocolFeesAccrued)
            .unwrap_or(0)
    }

    /// Pays accrued protocol fees out to the treasury. Treasury-authorized, so
    /// a compromised admin cannot redirect an already-accrued balance.
    pub fn withdraw_protocol_fees(env: Env) -> Result<i128, Error> {
        let config = read_config(&env)?;
        let treasury: Address = env
            .storage()
            .instance()
            .get(&DataKey::Treasury)
            .ok_or(Error::InvalidProtocolFee)?;
        treasury.require_auth();
        let accrued: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ProtocolFeesAccrued)
            .unwrap_or(0);
        if accrued <= 0 {
            return Err(Error::InvalidAmount);
        }
        env.storage()
            .instance()
            .set(&DataKey::ProtocolFeesAccrued, &0_i128);
        transfer_out_of_pool(&env, &config.sy_token, &treasury, accrued);
        Ok(accrued)
    }

    /// Moves a non-protocol token out of the pool. PT and SY are refused:
    /// they are the reserves.
    pub fn sweep(env: Env, token_id: Address, to: Address) -> Result<i128, Error> {
        let config = read_config(&env)?;
        config.admin.require_auth();
        require_not_renounced(&env)?;
        if token_id == config.pt_token || token_id == config.sy_token {
            return Err(Error::ProtectedAsset);
        }
        let balance = pool_token_balance(&env, &token_id);
        if balance <= 0 {
            return Err(Error::InvalidAmount);
        }
        transfer_out_of_pool(&env, &token_id, &to, balance);
        Ok(balance)
    }

    pub fn state(env: Env) -> Result<State, Error> {
        read_state(&env)
    }

    /// PT backing the curve. This is accounted state, not `balanceOf(amm)`:
    /// tokens donated straight to this contract are deliberately excluded, so
    /// nobody can move the curve by transferring to it.
    pub fn reserve_pt(env: Env) -> Result<i128, Error> {
        read_config(&env)?;
        Ok(read_state(&env)?.total_pt)
    }

    /// SY backing the curve. Same accounting rule as `reserve_pt`.
    pub fn reserve_sy(env: Env) -> Result<i128, Error> {
        read_config(&env)?;
        Ok(read_state(&env)?.total_sy)
    }

    /// `(pt, sy)` this contract custodies beyond what backs the curve —
    /// donations, and any token sent here by mistake. Always >= 0 in a healthy
    /// market; a negative value would mean custody is short of the reserves the
    /// curve believes it has, so it is surfaced rather than saturated.
    pub fn untracked_balance(env: Env) -> Result<(i128, i128), Error> {
        let config = read_config(&env)?;
        let state = read_state(&env)?;
        Ok((
            pool_token_balance(&env, &config.pt_token) - state.total_pt,
            pool_token_balance(&env, &config.sy_token) - state.total_sy,
        ))
    }

    pub fn total_lp(env: Env) -> Result<i128, Error> {
        Ok(read_state(&env)?.total_lp)
    }

    pub fn bump_ttl(env: Env) -> Result<(), Error> {
        read_config(&env)?;
        bump_instance_ttl(&env);
        Ok(())
    }

    pub fn bump_lp_ttl(env: Env, holder: Address) -> Result<(), Error> {
        read_config(&env)?;
        bump_lp_balance_ttl(&env, holder);
        Ok(())
    }

    pub fn lp_balance(env: Env, holder: Address) -> Result<i128, Error> {
        read_config(&env)?;
        Ok(read_lp_balance(&env, holder))
    }

    pub fn quote_pt_for_sy(env: Env, pt_in: i128) -> Result<i128, Error> {
        let (config, state, comp) = load_live_market(&env, pt_in)?;
        Ok(exact_pt_in_sy_out_or_panic(
            &env, &config, &state, &comp, pt_in,
        ))
    }

    pub fn quote_sy_for_pt(env: Env, sy_in: i128) -> Result<i128, Error> {
        let (config, state, comp) = load_live_market(&env, sy_in)?;
        Ok(exact_sy_in_pt_out_or_panic(
            &env, &config, &state, &comp, sy_in,
        ))
    }

    pub fn quote_sy_for_yt(env: Env, sy_in: i128) -> Result<i128, Error> {
        let (config, state, comp) = load_live_market(&env, sy_in)?;
        let rate = sy_rate_or_panic(&env, &config);
        Ok(solve_yt_out_for_sy_in(
            &env, &config, &state, &comp, sy_in, rate,
        ))
    }

    /// `(pt_out, sy_used)` for an exact-SY-in PT buy. `sy_used <= sy_in`, and
    /// `sy_used` is what the swap will actually debit — the solver is bounded by
    /// the curve, so past the saturation point extra input buys nothing and is
    /// simply not charged. Callers should surface `sy_used` and warn when it is
    /// materially below `sy_in`, because that means the market cannot absorb the
    /// requested size.
    pub fn quote_sy_for_pt_cost(env: Env, sy_in: i128) -> Result<(i128, i128), Error> {
        let (config, state, comp) = load_live_market(&env, sy_in)?;
        Ok(exact_sy_in_pt_out_with_cost_or_panic(
            &env, &config, &state, &comp, sy_in,
        ))
    }

    /// `(yt_out, sy_used)` for an exact-SY-in YT buy. Same contract as
    /// `quote_sy_for_pt_cost`: `sy_used` is the shortfall the pool cannot fund
    /// from selling the PT leg into its own curve, and is exactly what the swap
    /// will debit.
    pub fn quote_sy_for_yt_cost(env: Env, sy_in: i128) -> Result<(i128, i128), Error> {
        let (config, state, comp) = load_live_market(&env, sy_in)?;
        let rate = sy_rate_or_panic(&env, &config);
        let (yt_out, sy_paid) =
            solve_yt_out_for_sy_in_with_cost(&env, &config, &state, &comp, sy_in, rate);
        let shares_to_split = shares_in_for_face_up(&env, yt_out, rate);
        Ok((yt_out, checked_sub(&env, shares_to_split, sy_paid)))
    }

    pub fn quote_yt_for_sy(env: Env, yt_in: i128) -> Result<i128, Error> {
        let (config, state, comp) = load_live_market(&env, yt_in)?;
        let rate = sy_rate_or_panic(&env, &config);
        let sy_cost = exact_pt_out_sy_in_or_panic(&env, &config, &state, &comp, yt_in);
        // Recombining `yt_in` face of PT + YT returns floor(yt_in * WAD / rate)
        // SY shares (the tokenizer's own floor); the seller nets that minus the
        // curve-side cost of buying back the PT leg.
        let sy_value = shares_out_for_face_down(&env, yt_in, rate);
        if sy_cost >= sy_value {
            return Err(Error::InsufficientLiquidity);
        }
        Ok(sy_value - sy_cost)
    }

    pub fn spot_apy(env: Env) -> Result<i128, Error> {
        let config = read_config(&env)?;
        if env.ledger().timestamp() >= config.maturity {
            return Ok(0);
        }

        let state = read_state(&env)?;
        if state.total_lp == 0 {
            return Ok(0);
        }

        Ok(ln_rate_to_bps(&env, state.last_ln_implied_rate))
    }

    pub fn twap_apy(env: Env) -> Result<i128, Error> {
        let config = read_config(&env)?;
        let state = read_state(&env)?;

        if env.ledger().timestamp() >= config.maturity {
            return Ok(0);
        }

        Ok(ln_rate_to_bps(&env, state.twap_ln_implied_rate))
    }

    pub fn twap_warming_up(env: Env) -> Result<bool, Error> {
        let state = read_state(&env)?;
        Ok(env.ledger().timestamp() < state.warmup_until)
    }

    pub fn swap_pt_for_sy(env: Env, from: Address, pt_in: i128, min_sy_out: i128) -> i128 {
        let sy_out = <Self as Market>::swap_pt_for_sy(&env, from.clone(), pt_in, min_sy_out);
        Swap {
            trader: from,
            route: Symbol::new(&env, "pt_for_sy"),
            amount_in: pt_in,
            amount_out: sy_out,
        }
        .publish(&env);
        sy_out
    }

    pub fn swap_sy_for_pt(env: Env, from: Address, sy_in: i128, min_pt_out: i128) -> i128 {
        let pt_out = <Self as Market>::swap_sy_for_pt(&env, from.clone(), sy_in, min_pt_out);
        Swap {
            trader: from,
            route: Symbol::new(&env, "sy_for_pt"),
            amount_in: sy_in,
            amount_out: pt_out,
        }
        .publish(&env);
        pt_out
    }

    pub fn swap_sy_for_yt(env: Env, from: Address, sy_in: i128, min_yt_out: i128) -> i128 {
        let yt_out = <Self as Market>::swap_sy_for_yt(&env, from.clone(), sy_in, min_yt_out);
        Swap {
            trader: from,
            route: Symbol::new(&env, "sy_for_yt"),
            amount_in: sy_in,
            amount_out: yt_out,
        }
        .publish(&env);
        yt_out
    }

    pub fn swap_yt_for_sy(env: Env, from: Address, yt_in: i128, min_sy_out: i128) -> i128 {
        let sy_out = <Self as Market>::swap_yt_for_sy(&env, from.clone(), yt_in, min_sy_out);
        Swap {
            trader: from,
            route: Symbol::new(&env, "yt_for_sy"),
            amount_in: yt_in,
            amount_out: sy_out,
        }
        .publish(&env);
        sy_out
    }

    pub fn add_liquidity(
        env: Env,
        from: Address,
        pt_in: i128,
        sy_in: i128,
        min_lp_out: i128,
    ) -> i128 {
        let lp_out = <Self as Market>::add_liquidity(&env, from.clone(), pt_in, sy_in);
        // Slippage bound enforced here, after the shared-trait implementation,
        // because the Market trait signature is frozen (contracts/shared/types).
        // A panic reverts the entire invocation, transfers included, so this is
        // equivalent to checking before any token moves.
        if lp_out < min_lp_out {
            panic_with_error!(&env, Error::SlippageExceeded);
        }
        AddLiquidity {
            provider: from,
            pt_in,
            sy_in,
            lp_out,
        }
        .publish(&env);
        lp_out
    }

    pub fn remove_liquidity(
        env: Env,
        from: Address,
        lp_in: i128,
        min_pt_out: i128,
        min_sy_out: i128,
    ) -> (i128, i128) {
        let (pt_out, sy_out) = <Self as Market>::remove_liquidity(&env, from.clone(), lp_in);
        // Same pattern as add_liquidity: bound checked after the frozen-trait
        // call; the panic reverts everything.
        if pt_out < min_pt_out || sy_out < min_sy_out {
            panic_with_error!(&env, Error::SlippageExceeded);
        }
        RemoveLiquidity {
            provider: from,
            lp_in,
            pt_out,
            sy_out,
        }
        .publish(&env);
        (pt_out, sy_out)
    }

    pub fn implied_apy(env: Env) -> i128 {
        <Self as Market>::implied_apy(&env)
    }

    pub fn maturity(env: Env) -> u64 {
        <Self as Market>::maturity(&env)
    }
}

impl Market for AmmMarket {
    fn swap_pt_for_sy(env: &Env, from: Address, pt_in: i128, min_sy_out: i128) -> i128 {
        from.require_auth();
        let (config, mut state, comp) = load_live_market_or_panic(env, pt_in);

        let (sy_out, observed_ln_rate) =
            apply_exact_pt_in_trade_or_panic(env, &config, &mut state, &comp, pt_in, min_sy_out);
        accrue_protocol_fee(
            env,
            &mut state,
            fee_from_payout(env, sy_out, config.fee_bps),
        );
        transfer_into_pool(env, &config.pt_token, &from, pt_in);
        transfer_out_of_pool(env, &config.sy_token, &from, sy_out);
        // Plain PT->SY trade: the transfers above move exactly pt_in and
        // sy_out (both tokens' `transfer` moves the exact amount, no
        // fee/rebase), matching the state deltas already applied. No flash
        // split/recombine dust is possible on this path.
        settle_and_record_without_dust(env, &config, &mut state, observed_ln_rate);

        sy_out
    }

    fn swap_sy_for_pt(env: &Env, from: Address, sy_in: i128, min_pt_out: i128) -> i128 {
        from.require_auth();
        let (config, mut state, comp) = load_live_market_or_panic(env, sy_in);

        let (pt_out, required_sy) =
            exact_sy_in_pt_out_with_cost_or_panic(env, &config, &state, &comp, sy_in);
        if pt_out < min_pt_out {
            panic_with_error!(env, Error::SlippageExceeded);
        }

        let observed_ln_rate = apply_exact_sy_in_trade_with_required_sy_or_panic(
            env,
            &mut state,
            &comp,
            sy_in,
            pt_out,
            required_sy,
        );
        // Charge the curve-derived cost, never the caller's whole budget. The
        // solver returns the largest pt_out it can *afford*, but it is bounded
        // above by `total_pt - 1` and by the ExchangeRateBelowOne /
        // MarketProportionTooHigh limits, so on a saturated market it returns a
        // pt_out far cheaper than `sy_in`. Transferring `sy_in` here confiscated
        // the difference: at 40 SY into the live testnet pool the trader received
        // the same 3.9586 PT as a 4 SY trade and lost ~90% of the input to LPs.
        accrue_protocol_fee(
            env,
            &mut state,
            fee_from_charge(env, required_sy, config.fee_bps),
        );
        transfer_into_pool(env, &config.sy_token, &from, required_sy);
        transfer_out_of_pool(env, &config.pt_token, &from, pt_out);
        // Plain SY->PT trade: same reasoning as swap_pt_for_sy above.
        settle_and_record_without_dust(env, &config, &mut state, observed_ln_rate);

        pt_out
    }

    fn swap_sy_for_yt(env: &Env, from: Address, sy_in: i128, min_yt_out: i128) -> i128 {
        from.require_auth();
        let (config, mut state, comp) = load_live_market_or_panic(env, sy_in);

        // The curve prices PT face units; the tokenizer escrows SY shares and
        // mints face = shares * rate / WAD. Every conversion between the two
        // unit systems happens here at the flash boundary, using the same rate
        // source the tokenizer reads (the SY contract's exchange_rate).
        // `comp.rate` was already read from the same source while precomputing
        // the market state above, so reuse it instead of a second cross-contract call.
        let rate = comp.rate;
        let (yt_out, sy_paid) =
            solve_yt_out_for_sy_in_with_cost(env, &config, &state, &comp, sy_in, rate);
        if yt_out < min_yt_out {
            panic_with_error!(env, Error::SlippageExceeded);
        }

        // The pool keeps the PT the split mints, so the curve moves as if it
        // bought `yt_out` PT; `sy_funded` is the SY the curve pays for that PT.
        // `sy_paid` was already computed for this exact (state, comp, yt_out)
        // by the solver above, so reuse it instead of recomputing.
        let (sy_funded, observed_ln_rate) = apply_exact_pt_in_trade_with_sy_out_or_panic(
            env, &mut state, &comp, yt_out, sy_paid, 0,
        );

        // Shares to split, rounded UP so the tokenizer's floored face mint is
        // at least `yt_out`, the amount the curve accounted for and the buyer
        // was quoted. Rounding up costs the pool at most one extra face unit of
        // shares, and that cost is backed one-for-one by the dust pair it keeps
        // (see below).
        let shares_to_split = shares_in_for_face_up(env, yt_out, rate);
        // The split is funded by the buyer's sy_in plus at most the curve-side
        // proceeds of the PT leg. The solver guarantees this bound; fail closed
        // if a future change breaks it, because exceeding it would tap LP
        // reserves the curve never accounted for.
        if shares_to_split > checked_add(env, sy_in, sy_funded) {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }

        // The buyer's actual cost is the shortfall the curve could not fund:
        // the pool splits `shares_to_split` SY and recovers `sy_funded` by
        // selling the PT leg into its own curve, so the buyer covers the
        // difference and nothing more. Charging `sy_in` instead confiscated the
        // rest whenever the solver saturated (live testnet: any input >= 6 SY
        // bought the same 18.4472 YT, so a 40 SY order lost ~35 SY to LPs).
        let buyer_cost = checked_sub(env, shares_to_split, sy_funded);

        // Take the buyer's SY, split pool-funded SY into PT + YT, keep the PT,
        // and send exactly the quoted YT to the buyer.
        transfer_into_pool(env, &config.sy_token, &from, buyer_cost);
        let (pt_minted, yt_minted) = flash_split(env, &config, shares_to_split);
        if yt_minted < yt_out {
            // Cannot happen while the tokenizer floors against the same rate we
            // ceiled with; a drifted rate read would under-mint, so fail closed.
            panic_with_error!(env, Error::InsufficientLiquidity);
        }
        transfer_out_of_pool(env, &config.yt_token, &from, yt_out);
        // Rounding dust: the ceil above can over-mint up to one face unit of
        // PT and YT beyond `yt_out`. Both stay in the pool. The PT dust is
        // measured here and credited to curve reserves explicitly; the YT dust
        // sits in pool custody as an equal, recombinable pair with it. The
        // trader never receives the dust, so rounding cannot be farmed against
        // LPs. Measured from the split's own return value rather than from a
        // balance read, so a donation cannot masquerade as dust.
        let pt_dust = checked_sub(env, pt_minted, yt_out);
        settle_and_record(env, &config, &mut state, observed_ln_rate, pt_dust, 0);

        yt_out
    }

    fn swap_yt_for_sy(env: &Env, from: Address, yt_in: i128, min_sy_out: i128) -> i128 {
        from.require_auth();
        let (config, mut state, comp) = load_live_market_or_panic(env, yt_in);

        // Curve amounts are PT face; the recombine returns SY shares. Convert
        // at the flash boundary with the tokenizer's own rate source.
        // `comp.rate` was already read from the same source while precomputing
        // the market state above, so reuse it instead of a second cross-contract call.
        let rate = comp.rate;
        let sy_cost = exact_pt_out_sy_in_or_panic(env, &config, &state, &comp, yt_in);
        // SY shares the recombine of `yt_in` face returns, floored exactly like
        // the tokenizer floors, so the payout budget never exceeds what will
        // actually arrive.
        let sy_value = shares_out_for_face_down(env, yt_in, rate);
        if sy_value <= sy_cost {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }
        let sy_out = sy_value - sy_cost;
        if sy_out < min_sy_out {
            panic_with_error!(env, Error::SlippageExceeded);
        }

        // The pool sold `yt_in` PT for `sy_cost` SY into the recombine.
        // `sy_cost` is already the required-SY value for this exact
        // (state, comp, yt_in), so reuse it instead of recomputing.
        let observed_ln_rate = apply_exact_sy_in_trade_with_required_sy_or_panic(
            env, &mut state, &comp, sy_cost, yt_in, sy_cost,
        );

        // Take the seller's YT, recombine pool PT + seller YT into SY, pay the
        // seller, and keep the spread.
        transfer_into_pool(env, &config.yt_token, &from, yt_in);
        let sy_from_recombine = flash_recombine(env, &config, yt_in);
        // The tokenizer pays floor(yt_in * WAD / rate) shares, pro-rata capped
        // under an escrow shortfall. At a constant rate the cap never binds
        // (split floors face against the same rate, so escrow always covers).
        // If less than the budget arrives, the escrow is genuinely short: fail
        // closed and revert the swap rather than pay the seller from LP funds.
        if sy_from_recombine < sy_value {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }
        transfer_out_of_pool(env, &config.sy_token, &from, sy_out);
        // The recombine is checked above to deliver at least `sy_value`; any
        // excess over that budget is dust the pool earned on this trade, so
        // credit it explicitly rather than discovering it in a balance read.
        let sy_dust = checked_sub(env, sy_from_recombine, sy_value);
        settle_and_record(env, &config, &mut state, observed_ln_rate, 0, sy_dust);

        sy_out
    }

    fn add_liquidity(env: &Env, from: Address, pt_in: i128, sy_in: i128) -> i128 {
        from.require_auth();
        require_not_paused(env);
        require_bounded_amount(env, pt_in);
        require_bounded_amount(env, sy_in);

        let config = read_config_or_panic(env);
        require_live(env, &config);

        let mut state = read_state_or_panic(env);
        let now = env.ledger().timestamp();
        let (pt_used, sy_used, lp_out) = if state.total_lp == 0 {
            let gross_lp = integer_sqrt_or_panic(env, checked_mul(env, pt_in, sy_in));
            if gross_lp <= MINIMUM_LIQUIDITY {
                panic_with_error!(env, Error::InsufficientLiquidity);
            }

            state.total_pt = pt_in;
            state.total_sy = sy_in;
            state.total_lp = gross_lp;
            let time_to_expiry = time_to_expiry_or_panic(env, &config);
            let rate_scalar = get_rate_scalar_or_panic(env, config.scalar_root, time_to_expiry);
            state.last_ln_implied_rate = get_ln_implied_rate_or_panic(
                env,
                state.total_pt,
                state.total_sy,
                rate_scalar,
                config.initial_anchor,
                time_to_expiry,
            );
            state.twap_ln_implied_rate = state.last_ln_implied_rate;
            state.last_observation = now;

            (pt_in, sy_in, gross_lp - MINIMUM_LIQUIDITY)
        } else {
            let lp_by_pt = mul_div_down_or_panic(env, pt_in, state.total_lp, state.total_pt);
            let lp_by_sy = mul_div_down_or_panic(env, sy_in, state.total_lp, state.total_sy);
            let lp_out = min(lp_by_pt, lp_by_sy);
            if lp_out <= 0 {
                panic_with_error!(env, Error::InsufficientLiquidity);
            }

            let pt_used = mul_div_up_or_panic(env, state.total_pt, lp_out, state.total_lp);
            let sy_used = mul_div_up_or_panic(env, state.total_sy, lp_out, state.total_lp);

            state.total_pt = checked_bounded_reserve_add(env, state.total_pt, pt_used);
            state.total_sy = checked_bounded_reserve_add(env, state.total_sy, sy_used);
            state.total_lp = checked_add(env, state.total_lp, lp_out);

            (pt_used, sy_used, lp_out)
        };

        let current_lp = read_lp_balance(env, from.clone());
        write_lp_balance(env, from.clone(), checked_add(env, current_lp, lp_out));
        transfer_into_pool(env, &config.pt_token, &from, pt_used);
        transfer_into_pool(env, &config.sy_token, &from, sy_used);
        // state already reflects pt_used/sy_used exactly; no balance read.
        write_state(env, &state);
        lp_out
    }

    fn remove_liquidity(env: &Env, from: Address, lp_in: i128) -> (i128, i128) {
        from.require_auth();
        require_bounded_amount(env, lp_in);

        let config = read_config_or_panic(env);
        let mut state = read_state_or_panic(env);
        require_seeded(env, &state);

        let holder_lp = read_lp_balance(env, from.clone());
        if lp_in > holder_lp {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }

        if lp_in >= state.total_lp {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }

        let sy_out = mul_div_down_or_panic(env, lp_in, state.total_sy, state.total_lp);
        let pt_out = mul_div_down_or_panic(env, lp_in, state.total_pt, state.total_lp);
        if sy_out == 0 && pt_out == 0 {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }

        write_lp_balance(env, from.clone(), checked_sub(env, holder_lp, lp_in));
        state.total_lp = checked_sub(env, state.total_lp, lp_in);
        state.total_sy = checked_sub(env, state.total_sy, sy_out);
        state.total_pt = checked_sub(env, state.total_pt, pt_out);
        transfer_out_of_pool(env, &config.pt_token, &from, pt_out);
        transfer_out_of_pool(env, &config.sy_token, &from, sy_out);
        // state already reflects pt_out/sy_out exactly; no balance read.
        write_state(env, &state);

        (pt_out, sy_out)
    }

    fn implied_apy(env: &Env) -> i128 {
        let config = read_config_or_panic(env);
        if env.ledger().timestamp() >= config.maturity {
            return 0;
        }

        let state = read_state_or_panic(env);
        if state.total_lp == 0 {
            return 0;
        }

        ln_rate_to_bps(env, state.last_ln_implied_rate)
    }

    fn maturity(env: &Env) -> u64 {
        read_config_or_panic(env).maturity
    }
}

/// Takes the protocol's configured share of a swap fee out of reserves and
/// books it to the treasury ledger.
///
/// `fee_sy` is the fee this trade charged, in SY. The protocol's cut is
/// `fee_sy * share_bps / 10_000` — a share of the FEE, never of the trade, and
/// capped at MAX_PROTOCOL_FEE_SHARE_BPS so LPs always keep the majority.
///
/// The cut leaves `state.total_sy` so it is not counted as LP-owned backing;
/// the SY itself stays in the contract until the treasury withdraws it. At the
/// shipped default of 0 this is a no-op and reserves are byte-identical to
/// having no fee switch at all.
///
/// Applied only to the two plain PT<->SY paths. The YT flash routes are
/// composite trades that mint and burn through the tokenizer, and threading a
/// fee deduction through them would change the dust accounting the escrow
/// invariants depend on. They therefore contribute no protocol fee today; see
/// FINDINGS.md.
fn accrue_protocol_fee(env: &Env, state: &mut State, fee_sy: i128) {
    if fee_sy <= 0 {
        return;
    }
    let share_bps: i128 = env
        .storage()
        .instance()
        .get(&DataKey::ProtocolFeeShareBps)
        .unwrap_or(0);
    if share_bps <= 0 {
        return;
    }
    let cut = mul_div_down_or_panic(env, fee_sy, share_bps, BPS_DENOMINATOR);
    if cut <= 0 || cut >= state.total_sy {
        return;
    }
    state.total_sy = checked_sub(env, state.total_sy, cut);
    let accrued: i128 = env
        .storage()
        .instance()
        .get(&DataKey::ProtocolFeesAccrued)
        .unwrap_or(0);
    env.storage().instance().set(
        &DataKey::ProtocolFeesAccrued,
        &checked_add(env, accrued, cut),
    );
}

/// The SY fee embedded in a post-fee payout of `sy_out`.
/// `sy_out = pre_fee * (1 - f)`, so `fee = sy_out * f / (1 - f)`.
fn fee_from_payout(env: &Env, sy_out: i128, fee_bps: i128) -> i128 {
    if fee_bps <= 0 {
        return 0;
    }
    mul_div_down_or_panic(env, sy_out, fee_bps, BPS_DENOMINATOR - fee_bps)
}

/// The SY fee embedded in a fee-inclusive charge of `sy_in`.
/// `sy_in = pre_fee * (1 + f)`, so `fee = sy_in * f / (1 + f)`.
fn fee_from_charge(env: &Env, sy_in: i128, fee_bps: i128) -> i128 {
    if fee_bps <= 0 {
        return 0;
    }
    mul_div_down_or_panic(env, sy_in, fee_bps, BPS_DENOMINATOR + fee_bps)
}

fn require_not_renounced(env: &Env) -> Result<(), Error> {
    if env
        .storage()
        .instance()
        .get(&DataKey::Renounced)
        .unwrap_or(false)
    {
        return Err(Error::NotAuthorized);
    }
    Ok(())
}

/// Panics if the market is paused. Applied to every entry path (all four swaps
/// and add_liquidity) and deliberately NOT to remove_liquidity.
fn require_not_paused(env: &Env) {
    if env
        .storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
    {
        panic_with_error!(env, Error::Paused);
    }
}

fn read_config(env: &Env) -> Result<Config, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::NotInitialized)
}

fn read_state(env: &Env) -> Result<State, Error> {
    env.storage()
        .instance()
        .get(&DataKey::State)
        .ok_or(Error::NotInitialized)
}

fn read_config_or_panic(env: &Env) -> Config {
    match read_config(env) {
        Ok(config) => config,
        Err(error) => panic_with_error!(env, error),
    }
}

fn read_state_or_panic(env: &Env) -> State {
    match read_state(env) {
        Ok(state) => state,
        Err(error) => panic_with_error!(env, error),
    }
}

fn write_state(env: &Env, state: &State) {
    env.storage().instance().set(&DataKey::State, state);
    bump_instance_ttl(env);
}

fn bump_instance_ttl(env: &Env) {
    env.storage().instance().extend_ttl(
        AMM_INSTANCE_TTL_THRESHOLD_LEDGERS,
        AMM_INSTANCE_TTL_EXTEND_TO_LEDGERS,
    );
}

// LP balances live in persistent storage, one entry per holder, matching the
// token contracts' balance pattern. Keeping them in the instance entry would
// make every invocation's IO scale with the number of LP holders and cap how
// many holders can exist at the instance entry size limit.
fn read_lp_balance(env: &Env, holder: Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::LpBalance(holder))
        .unwrap_or(0)
}

fn write_lp_balance(env: &Env, holder: Address, balance: i128) {
    let key = DataKey::LpBalance(holder);
    env.storage().persistent().set(&key, &balance);
    extend_lp_balance_ttl(env, &key);
}

fn bump_lp_balance_ttl(env: &Env, holder: Address) {
    let key = DataKey::LpBalance(holder);
    if env.storage().persistent().has(&key) {
        extend_lp_balance_ttl(env, &key);
    }
}

fn extend_lp_balance_ttl(env: &Env, key: &DataKey) {
    env.storage().persistent().extend_ttl(
        key,
        AMM_INSTANCE_TTL_THRESHOLD_LEDGERS,
        AMM_INSTANCE_TTL_EXTEND_TO_LEDGERS,
    );
}

fn pool_token_balance(env: &Env, token_id: &Address) -> i128 {
    token::TokenClient::new(env, token_id).balance(&env.current_contract_address())
}

/// Folds flash-route rounding dust the pool genuinely earned into curve state.
///
/// This replaces the old `reconcile_reserves`, which assigned `state.total_pt`
/// and `state.total_sy` straight from `balanceOf(amm)`. Any address can
/// `transfer` PT or SY to this contract, so that made curve state — and through
/// it the anchor, the implied rate, and every subsequent quote — writable by an
/// unrelated third party for the price of a donation. It also meant reserves
/// jumped discontinuously at reconcile time, which is a timing game around
/// add/remove liquidity.
///
/// Reserves are now authoritative in `state` and only ever move by amounts this
/// contract accounted for. Donated tokens sit in the contract untouched: they
/// never enter the curve and no one can farm them. `deltas` carries the dust a
/// flash split/recombine actually minted beyond what the curve budgeted.
fn credit_flash_dust(env: &Env, state: &mut State, pt_dust: i128, sy_dust: i128) {
    if pt_dust > 0 {
        state.total_pt = checked_bounded_reserve_add(env, state.total_pt, pt_dust);
    }
    if sy_dust > 0 {
        state.total_sy = checked_bounded_reserve_add(env, state.total_sy, sy_dust);
    }
}

fn transfer_into_pool(env: &Env, token_id: &Address, from: &Address, amount: i128) {
    let pool = env.current_contract_address();
    let to = MuxedAddress::from(&pool);
    token::TokenClient::new(env, token_id).transfer(from, &to, &amount);
}

#[inline(never)]
fn auth_entry(
    env: &Env,
    contract: &Address,
    fn_name: &str,
    args: Vec<Val>,
) -> InvokerContractAuthEntry {
    InvokerContractAuthEntry::Contract(SubContractInvocation {
        context: ContractContext {
            contract: contract.clone(),
            fn_name: Symbol::new(env, fn_name),
            args,
        },
        sub_invocations: vec![env],
    })
}

fn transfer_out_of_pool(env: &Env, token_id: &Address, to: &Address, amount: i128) {
    let pool = env.current_contract_address();
    let to_muxed = MuxedAddress::from(to);
    let transfer_args: Vec<Val> = vec![
        env,
        pool.clone().into_val(env),
        to_muxed.clone().into_val(env),
        amount.into_val(env),
    ];
    env.authorize_as_current_contract(vec![
        env,
        auth_entry(env, token_id, "transfer", transfer_args),
    ]);
    token::TokenClient::new(env, token_id).transfer(&pool, &to_muxed, &amount);
}

fn require_live(env: &Env, config: &Config) {
    if env.ledger().timestamp() >= config.maturity {
        panic_with_error!(env, Error::MarketMatured);
    }
}

fn require_seeded(env: &Env, state: &State) {
    if state.total_lp <= 0 || state.total_pt <= 0 || state.total_sy <= 0 {
        panic_with_error!(env, Error::MarketNotSeeded);
    }
}

fn require_seeded_result(state: &State) -> Result<(), Error> {
    if state.total_lp <= 0 || state.total_pt <= 0 || state.total_sy <= 0 {
        return Err(Error::MarketNotSeeded);
    }

    Ok(())
}

fn require_positive_amount(env: &Env, amount: i128) {
    if amount <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }
}

fn require_positive_amount_result(amount: i128) -> Result<(), Error> {
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    Ok(())
}

fn require_bounded_amount(env: &Env, amount: i128) {
    require_positive_amount(env, amount);
    require_within_reserve_bounds(env, amount);
}

fn require_bounded_amount_result(amount: i128) -> Result<(), Error> {
    require_positive_amount_result(amount)?;
    if amount > MAX_RESERVE_UNITS {
        return Err(Error::InputOutOfBounds);
    }

    Ok(())
}

fn require_within_reserve_bounds(env: &Env, amount: i128) {
    if amount > MAX_RESERVE_UNITS {
        panic_with_error!(env, Error::InputOutOfBounds);
    }
}

fn require_live_result(env: &Env, config: &Config) -> Result<(), Error> {
    if env.ledger().timestamp() >= config.maturity {
        return Err(Error::MarketMatured);
    }

    Ok(())
}

fn time_to_expiry_or_panic(env: &Env, config: &Config) -> u64 {
    let now = env.ledger().timestamp();
    match config.maturity.checked_sub(now) {
        Some(remaining) if remaining > 0 => remaining,
        _ => panic_with_error!(env, Error::MarketMatured),
    }
}

fn precompute_or_panic(env: &Env, config: &Config, state: &State) -> Precompute {
    let time_to_expiry = time_to_expiry_or_panic(env, config);
    let rate_scalar = get_rate_scalar_or_panic(env, config.scalar_root, time_to_expiry);
    let rate = sy_rate_or_panic(env, config);
    // The curve prices PT face against underlying-asset value, not raw SY
    // shares; state.total_sy must be converted through the live SY exchange
    // rate before it can stand in for "total_asset" below. Floor-rounded so
    // the curve's view of backing never overstates what the pool actually
    // holds.
    let total_asset = sy_to_asset(env, state.total_sy, rate);
    if state.total_pt <= 0 || total_asset <= 0 {
        panic_with_error!(env, Error::MarketNotSeeded);
    }

    let rate_anchor = get_rate_anchor_or_panic(
        env,
        state.total_pt,
        state.last_ln_implied_rate,
        total_asset,
        rate_scalar,
        time_to_expiry,
    );

    Precompute {
        rate_scalar,
        total_asset,
        rate_anchor,
        time_to_expiry,
        rate,
    }
}

fn exact_pt_in_sy_out_or_panic(
    env: &Env,
    config: &Config,
    state: &State,
    comp: &Precompute,
    pt_in: i128,
) -> i128 {
    let exchange_rate = get_exchange_rate_or_panic(
        env,
        state.total_pt,
        comp.total_asset,
        comp.rate_scalar,
        comp.rate_anchor,
        -pt_in,
    );
    // exchange_rate is asset-per-PT-face (WAD), so this quotient is
    // asset-denominated, not SY-denominated despite the variable name below.
    let pre_fee_asset_out = mul_div_down_or_panic(env, pt_in, WAD, exchange_rate);
    let fee = mul_div_down_or_panic(env, pre_fee_asset_out, config.fee_bps, BPS_DENOMINATOR);
    let asset_out = checked_sub(env, pre_fee_asset_out, fee);
    // Convert back to SY units (floor) at the boundary: state.total_sy and
    // the SY token transfer downstream are share-denominated.
    let sy_out = asset_to_sy_down(env, asset_out, comp.rate);

    if sy_out <= 0 || sy_out >= state.total_sy {
        panic_with_error!(env, Error::InsufficientLiquidity);
    }

    sy_out
}

fn apply_exact_pt_in_trade_or_panic(
    env: &Env,
    config: &Config,
    state: &mut State,
    comp: &Precompute,
    pt_in: i128,
    min_sy_out: i128,
) -> (i128, i128) {
    let sy_out = exact_pt_in_sy_out_or_panic(env, config, state, comp, pt_in);
    apply_exact_pt_in_trade_with_sy_out_or_panic(env, state, comp, pt_in, sy_out, min_sy_out)
}

/// Core of `apply_exact_pt_in_trade_or_panic`, taking an already-computed
/// `sy_out` instead of recomputing it. `sy_out` must have been derived from
/// the same (state, comp, pt_in) the caller is about to apply; state must not
/// have changed in between.
fn apply_exact_pt_in_trade_with_sy_out_or_panic(
    env: &Env,
    state: &mut State,
    comp: &Precompute,
    pt_in: i128,
    sy_out: i128,
    min_sy_out: i128,
) -> (i128, i128) {
    if sy_out < min_sy_out {
        panic_with_error!(env, Error::SlippageExceeded);
    }

    state.total_pt = checked_bounded_reserve_add(env, state.total_pt, pt_in);
    state.total_sy = checked_sub(env, state.total_sy, sy_out);
    let observed_ln_rate = get_ln_implied_rate_or_panic(
        env,
        state.total_pt,
        sy_to_asset(env, state.total_sy, comp.rate),
        comp.rate_scalar,
        comp.rate_anchor,
        comp.time_to_expiry,
    );
    state.last_ln_implied_rate = observed_ln_rate;

    (sy_out, observed_ln_rate)
}

fn exact_sy_in_pt_out_or_panic(
    env: &Env,
    config: &Config,
    state: &State,
    comp: &Precompute,
    sy_in: i128,
) -> i128 {
    exact_sy_in_pt_out_with_cost_or_panic(env, config, state, comp, sy_in).0
}

/// Same solve as `exact_sy_in_pt_out_or_panic`, but also returns the winning
/// candidate's `required_sy` so callers that already need it (trade
/// application) can reuse it instead of recomputing via
/// `exact_pt_out_sy_in_or_panic` on the same (state, comp, pt_out) inputs.
fn exact_sy_in_pt_out_with_cost_or_panic(
    env: &Env,
    config: &Config,
    state: &State,
    comp: &Precompute,
    sy_in: i128,
) -> (i128, i128) {
    let mut low = 1;
    let mut high = checked_sub(env, state.total_pt, 1);
    let mut best = 0;
    let mut best_required_sy = 0;

    while low <= high {
        let mid = low + ((high - low) / 2);
        match try_exact_pt_out_sy_in(env, config, state, comp, mid) {
            Some(required_sy) if required_sy <= sy_in => {
                best = mid;
                best_required_sy = required_sy;
                low = mid + 1;
            }
            Some(_) | None => {
                high = mid - 1;
            }
        }
    }

    if best <= 0 {
        panic_with_error!(env, Error::TradeNotFound);
    }

    (best, best_required_sy)
}

/// Core of the exact-SY-in trade application, taking an already-computed
/// `required_sy` instead of recomputing it. `required_sy` must have been
/// derived from the same (state, comp, pt_out) the caller is about to apply;
/// state must not have changed in between.
///
/// `sy_in` is the caller's ceiling, NOT the amount charged. Reserves grow by
/// `required_sy`, the curve-derived cost of `pt_out`, and the caller is only
/// ever debited that much (see `swap_sy_for_pt`). Crediting `sy_in` here — as
/// this function used to — silently donated `sy_in - required_sy` to LPs
/// whenever the solver was capped by the curve bound rather than by the
/// caller's budget, which on a saturated market is most of the input.
fn apply_exact_sy_in_trade_with_required_sy_or_panic(
    env: &Env,
    state: &mut State,
    comp: &Precompute,
    sy_in: i128,
    pt_out: i128,
    required_sy: i128,
) -> i128 {
    if required_sy > sy_in {
        panic_with_error!(env, Error::SlippageExceeded);
    }

    state.total_pt = checked_sub(env, state.total_pt, pt_out);
    state.total_sy = checked_bounded_reserve_add(env, state.total_sy, required_sy);
    let observed_ln_rate = get_ln_implied_rate_or_panic(
        env,
        state.total_pt,
        sy_to_asset(env, state.total_sy, comp.rate),
        comp.rate_scalar,
        comp.rate_anchor,
        comp.time_to_expiry,
    );
    state.last_ln_implied_rate = observed_ln_rate;

    observed_ln_rate
}

fn exact_pt_out_sy_in_or_panic(
    env: &Env,
    config: &Config,
    state: &State,
    comp: &Precompute,
    pt_out: i128,
) -> i128 {
    match try_exact_pt_out_sy_in(env, config, state, comp, pt_out) {
        Some(value) => value,
        None => panic_with_error!(env, Error::TradeNotFound),
    }
}

fn try_exact_pt_out_sy_in(
    env: &Env,
    config: &Config,
    state: &State,
    comp: &Precompute,
    pt_out: i128,
) -> Option<i128> {
    if pt_out <= 0 || pt_out >= state.total_pt {
        return None;
    }

    let exchange_rate = try_get_exchange_rate(
        env,
        state.total_pt,
        comp.total_asset,
        comp.rate_scalar,
        comp.rate_anchor,
        pt_out,
    )?;
    // exchange_rate is asset-per-PT-face (WAD); this quotient is
    // asset-denominated until converted back to SY units below.
    let pre_fee_asset_in = mul_div_up_or_panic(env, pt_out, WAD, exchange_rate);
    let fee = mul_div_up_or_panic(env, pre_fee_asset_in, config.fee_bps, BPS_DENOMINATOR);
    let asset_in = checked_add(env, pre_fee_asset_in, fee);
    // Ceil-rounded at the SY boundary so the pool never undercharges.
    let sy_required = asset_to_sy_up(env, asset_in, comp.rate);

    // Post-trade feasibility. A candidate is only affordable if the state it
    // LEAVES BEHIND is still a valid point on the curve: `apply_*` recomputes
    // the implied rate from the post-trade reserves and traps with
    // ExchangeRateBelowOne if that point is off-curve. Checking only the
    // pre-trade rate (as this used to) let the solver pick a `pt_out` that
    // priced fine going in and then trapped on the way out.
    //
    // This was masked before P1-01: crediting the caller's whole `sy_in` to
    // reserves inflated total_asset enough to keep the post-trade point valid,
    // so the confiscated funds were quietly holding the invariant up. Charging
    // only the true cost exposes it, which is the correct place to enforce it.
    require_post_trade_feasible(
        env,
        comp,
        state.total_pt.checked_sub(pt_out)?,
        state.total_sy.checked_add(sy_required)?,
    )?;

    Some(sy_required)
}

/// Returns `Some(())` when `(new_total_pt, new_total_sy)` is a state the curve
/// can still price — i.e. it is within reserve bounds and `get_ln_implied_rate`
/// would succeed on it. Used to reject trade candidates that would leave the
/// market in a state its own `apply_*` bookkeeping cannot evaluate.
fn require_post_trade_feasible(
    env: &Env,
    comp: &Precompute,
    new_total_pt: i128,
    new_total_sy: i128,
) -> Option<()> {
    if new_total_pt <= 0
        || new_total_sy <= 0
        || new_total_pt > MAX_RESERVE_UNITS
        || new_total_sy > MAX_RESERVE_UNITS
    {
        return None;
    }
    // Mirrors sy_to_asset's floor, without its panic on overflow.
    let new_total_asset = new_total_sy.checked_mul(comp.rate)? / WAD;
    if new_total_asset <= 0 {
        return None;
    }
    try_get_exchange_rate(
        env,
        new_total_pt,
        new_total_asset,
        comp.rate_scalar,
        comp.rate_anchor,
        0,
    )?;
    Some(())
}

/// Non-panicking SY out for selling `pt_in` PT to the pool, used by the YT-buy
/// solver. Mirrors exact_pt_in_sy_out_or_panic but returns None instead of
/// panicking at the liquidity bound.
fn try_exact_pt_in_sy_out(
    env: &Env,
    config: &Config,
    state: &State,
    comp: &Precompute,
    pt_in: i128,
) -> Option<i128> {
    if pt_in <= 0 {
        return None;
    }
    let exchange_rate = try_get_exchange_rate(
        env,
        state.total_pt,
        comp.total_asset,
        comp.rate_scalar,
        comp.rate_anchor,
        -pt_in,
    )?;
    // exchange_rate is asset-per-PT-face (WAD); this quotient is
    // asset-denominated until converted back to SY units below.
    let pre_fee_asset_out = mul_div_down_or_panic(env, pt_in, WAD, exchange_rate);
    let fee = mul_div_down_or_panic(env, pre_fee_asset_out, config.fee_bps, BPS_DENOMINATOR);
    let asset_out = pre_fee_asset_out - fee;
    let sy_out = asset_to_sy_down(env, asset_out, comp.rate);
    if sy_out <= 0 || sy_out >= state.total_sy {
        return None;
    }
    // Same post-trade feasibility gate as try_exact_pt_out_sy_in, mirrored for
    // the pool-buys-PT direction the YT solver drives.
    require_post_trade_feasible(
        env,
        comp,
        state.total_pt.checked_add(pt_in)?,
        state.total_sy.checked_sub(sy_out)?,
    )?;
    Some(sy_out)
}

/// Solves for the YT face a buyer receives for `sy_in` SY shares. The pool
/// splits ceil(yt_out * WAD / rate) shares to mint `yt_out` face of PT + YT
/// and sells the PT to itself for `sy_paid` shares; the buyer covers the
/// difference. We binary search for the largest affordable `yt_out`; `best` is
/// only ever set on a candidate whose cost fits inside `sy_in`, so even if the
/// cost curve is locally non-monotone the result can only be suboptimal for
/// the buyer, never harmful to the pool.
fn solve_yt_out_for_sy_in(
    env: &Env,
    config: &Config,
    state: &State,
    comp: &Precompute,
    sy_in: i128,
    rate: i128,
) -> i128 {
    solve_yt_out_for_sy_in_with_cost(env, config, state, comp, sy_in, rate).0
}

/// Same solve as `solve_yt_out_for_sy_in`, but also returns the winning
/// candidate's `sy_paid` (the curve-side proceeds of selling the PT leg) so
/// callers that go on to apply the PT-in trade can reuse it instead of
/// recomputing via `exact_pt_in_sy_out_or_panic` on the same (state, comp,
/// yt_out) inputs.
fn solve_yt_out_for_sy_in_with_cost(
    env: &Env,
    config: &Config,
    state: &State,
    comp: &Precompute,
    sy_in: i128,
    rate: i128,
) -> (i128, i128) {
    let mut low = 1;
    // The largest face any split could mint from the buyer's SY plus the whole
    // SY reserve, converted from shares to face at the rate.
    let max_shares = checked_add(env, sy_in, state.total_sy);
    let mut high = mul_div_down_or_panic(env, max_shares, rate, WAD);
    let mut best = 0;
    let mut best_sy_paid = 0;
    while low <= high {
        let mid = low + ((high - low) / 2);
        let shares_needed = shares_in_for_face_up(env, mid, rate);
        match try_exact_pt_in_sy_out(env, config, state, comp, mid) {
            Some(sy_paid) if shares_needed > sy_paid && (shares_needed - sy_paid) <= sy_in => {
                best = mid;
                best_sy_paid = sy_paid;
                low = mid + 1;
            }
            _ => {
                high = mid - 1;
            }
        }
    }
    if best <= 0 {
        panic_with_error!(env, Error::TradeNotFound);
    }
    (best, best_sy_paid)
}

/// Reads the SY exchange rate (asset per share, WAD scaled) from the SY token,
/// the same `exchange_rate` entrypoint the tokenizer prices split and recombine
/// with, so the AMM's unit conversions cannot drift from what the tokenizer
/// actually mints and burns.
fn sy_rate_or_panic(env: &Env, config: &Config) -> i128 {
    let args: Vec<Val> = vec![env];
    let rate: i128 =
        env.invoke_contract(&config.sy_token, &Symbol::new(env, "exchange_rate"), args);
    if rate <= 0 {
        panic_with_error!(env, Error::InvalidSyRate);
    }
    rate
}

/// Converts raw SY shares to underlying-asset units at the given WAD-scaled
/// rate, floor-rounded so the curve's asset-denominated reserve view never
/// overstates the pool's real backing.
fn sy_to_asset(env: &Env, sy_amount: i128, rate: i128) -> i128 {
    mul_div_down_or_panic(env, sy_amount, rate, WAD)
}

/// Converts an asset-denominated amount the curve computed back to SY
/// shares, floor-rounded — the safe direction when the pool is about to pay
/// this many shares out (never overpay).
fn asset_to_sy_down(env: &Env, asset_amount: i128, rate: i128) -> i128 {
    mul_div_down_or_panic(env, asset_amount, WAD, rate)
}

/// Same conversion, ceil-rounded — the safe direction when the pool is about
/// to require this many shares in (never undercharge).
fn asset_to_sy_up(env: &Env, asset_amount: i128, rate: i128) -> i128 {
    mul_div_up_or_panic(env, asset_amount, WAD, rate)
}

/// SY shares that must be split so the tokenizer's floored face mint covers
/// `face`: ceil(face * WAD / rate). Rounding up is the safe direction for the
/// pool: the split can over-mint face dust (which the pool keeps) but can
/// never mint less than the curve accounted for.
fn shares_in_for_face_up(env: &Env, face: i128, rate: i128) -> i128 {
    mul_div_up_or_panic(env, face, WAD, rate)
}

/// SY shares a recombine of `face` PT + YT returns: floor(face * WAD / rate),
/// mirroring the tokenizer's own floor, so the pool never budgets more SY out
/// than the recombine actually delivers.
fn shares_out_for_face_down(env: &Env, face: i128, rate: i128) -> i128 {
    mul_div_down_or_panic(env, face, WAD, rate)
}

/// Calls `tokenizer.split(amm, amount)`, authorizing the exact tokenizer call
/// and the exact SY pull it performs from the pool. `amount` is denominated in
/// SY shares (what split escrows), not PT face (what split mints); callers
/// convert curve face amounts with shares_in_for_face_up first.
fn flash_split(env: &Env, config: &Config, amount: i128) -> (i128, i128) {
    let amm = env.current_contract_address();
    let split_args: Vec<Val> =
        soroban_sdk::vec![env, amm.clone().into_val(env), amount.into_val(env)];
    let pull_args: Vec<Val> = soroban_sdk::vec![
        env,
        amm.clone().into_val(env),
        config.tokenizer.clone().into_val(env),
        amount.into_val(env),
    ];
    env.authorize_as_current_contract(vec![
        env,
        auth_entry(env, &config.tokenizer, "split", split_args.clone()),
        auth_entry(env, &config.sy_token, "transfer", pull_args),
    ]);
    env.invoke_contract::<(i128, i128)>(&config.tokenizer, &Symbol::new(env, "split"), split_args)
}

/// Calls `tokenizer.recombine(amm, amount, amount)`, authorizing the call and
/// the PT and YT burns it performs on the pool's balances, and returns SY out.
/// `amount` is PT face (what recombine burns); the return value is SY shares,
/// floor(amount * WAD / rate) when the escrow is solvent.
fn flash_recombine(env: &Env, config: &Config, amount: i128) -> i128 {
    let amm = env.current_contract_address();
    let recombine_args: Vec<Val> = soroban_sdk::vec![
        env,
        amm.clone().into_val(env),
        amount.into_val(env),
        amount.into_val(env),
    ];
    let burn_args: Vec<Val> =
        soroban_sdk::vec![env, amm.clone().into_val(env), amount.into_val(env)];
    env.authorize_as_current_contract(vec![
        env,
        auth_entry(env, &config.tokenizer, "recombine", recombine_args.clone()),
        auth_entry(env, &config.pt_token, "burn", burn_args.clone()),
        auth_entry(env, &config.yt_token, "burn", burn_args),
    ]);
    env.invoke_contract::<i128>(
        &config.tokenizer,
        &Symbol::new(env, "recombine"),
        recombine_args,
    )
}

fn sync_twap(env: &Env, config: &Config, state: &mut State, observed_ln_rate: i128) {
    let now = env.ledger().timestamp();
    let elapsed = now.saturating_sub(state.last_observation);

    if elapsed == 0 {
        return;
    }

    if elapsed >= config.twap_window {
        // After an idle gap of a full window there is no history worth
        // blending, so the TWAP snaps to this single observation. One trade
        // deciding the TWAP is exactly the manipulation window the TWAP
        // exists to prevent, so re-enter warm-up: consumers that gate on
        // twap_warming_up (the SDK and app already do) will not trust the
        // value again until a full window of fresh observations has passed.
        state.twap_ln_implied_rate = observed_ln_rate;
        state.warmup_until = now + config.twap_window;
    } else {
        let weight = mul_div_down_or_panic(env, elapsed as i128, WAD, config.twap_window as i128);
        let retained = checked_sub(env, WAD, weight);
        let carried = mul_div_down_or_panic(env, state.twap_ln_implied_rate, retained, WAD);
        let fresh = mul_div_down_or_panic(env, observed_ln_rate, weight, WAD);
        state.twap_ln_implied_rate = checked_add(env, carried, fresh);
    }

    state.last_observation = now;
}

fn get_rate_scalar_or_panic(env: &Env, scalar_root: i128, time_to_expiry: u64) -> i128 {
    let numerator = checked_mul(env, scalar_root, IMPLIED_RATE_TIME as i128);
    let rate_scalar = numerator / time_to_expiry as i128;
    if rate_scalar <= 0 {
        panic_with_error!(env, Error::InvalidScalarRoot);
    }

    rate_scalar
}

fn get_rate_anchor_or_panic(
    env: &Env,
    total_pt: i128,
    last_ln_implied_rate: i128,
    total_asset: i128,
    rate_scalar: i128,
    time_to_expiry: u64,
) -> i128 {
    let exchange_rate =
        get_exchange_rate_from_implied_rate_or_panic(env, last_ln_implied_rate, time_to_expiry);
    if exchange_rate < WAD {
        panic_with_error!(env, Error::ExchangeRateBelowOne);
    }

    let proportion =
        mul_div_down_or_panic(env, total_pt, WAD, checked_add(env, total_pt, total_asset));
    let ln_proportion = log_proportion_or_panic(env, proportion);
    checked_sub(
        env,
        exchange_rate,
        mul_div_down_or_panic(env, ln_proportion, WAD, rate_scalar),
    )
}

fn get_ln_implied_rate_or_panic(
    env: &Env,
    total_pt: i128,
    total_asset: i128,
    rate_scalar: i128,
    rate_anchor: i128,
    time_to_expiry: u64,
) -> i128 {
    let exchange_rate =
        get_exchange_rate_or_panic(env, total_pt, total_asset, rate_scalar, rate_anchor, 0);
    let ln_rate = ln_wad_or_panic(env, exchange_rate);
    mul_div_down_or_panic(
        env,
        ln_rate,
        IMPLIED_RATE_TIME as i128,
        time_to_expiry as i128,
    )
}

fn get_exchange_rate_from_implied_rate_or_panic(
    env: &Env,
    ln_implied_rate: i128,
    time_to_expiry: u64,
) -> i128 {
    let rt = mul_div_down_or_panic(
        env,
        ln_implied_rate,
        time_to_expiry as i128,
        IMPLIED_RATE_TIME as i128,
    );
    exp_wad_or_panic(env, rt)
}

fn get_exchange_rate_or_panic(
    env: &Env,
    total_pt: i128,
    total_asset: i128,
    rate_scalar: i128,
    rate_anchor: i128,
    net_pt_to_account: i128,
) -> i128 {
    let numerator = checked_sub(env, total_pt, net_pt_to_account);
    let denominator = checked_add(env, total_pt, total_asset);
    let proportion = mul_div_down_or_panic(env, numerator, WAD, denominator);
    if proportion > MAX_MARKET_PROPORTION {
        panic_with_error!(env, Error::MarketProportionTooHigh);
    }

    let ln_proportion = log_proportion_or_panic(env, proportion);
    let exchange_rate = checked_add(
        env,
        mul_div_down_or_panic(env, ln_proportion, WAD, rate_scalar),
        rate_anchor,
    );
    if exchange_rate < WAD {
        panic_with_error!(env, Error::ExchangeRateBelowOne);
    }

    exchange_rate
}

fn try_get_exchange_rate(
    env: &Env,
    total_pt: i128,
    total_asset: i128,
    rate_scalar: i128,
    rate_anchor: i128,
    net_pt_to_account: i128,
) -> Option<i128> {
    let numerator = total_pt.checked_sub(net_pt_to_account)?;
    let denominator = total_pt.checked_add(total_asset)?;
    if numerator <= 0 || denominator <= 0 {
        return None;
    }

    let proportion = numerator.checked_mul(WAD)?.checked_div(denominator)?;
    if proportion <= 0 || proportion > MAX_MARKET_PROPORTION {
        return None;
    }

    let complement = WAD.checked_sub(proportion)?;
    if complement <= 0 {
        return None;
    }

    let ratio = proportion.checked_mul(WAD)?.checked_div(complement)?;
    let ln_proportion = try_ln_wad(env, ratio)?;
    let scaled = ln_proportion.checked_mul(WAD)?.checked_div(rate_scalar)?;
    let exchange_rate = scaled.checked_add(rate_anchor)?;
    if exchange_rate < WAD {
        return None;
    }

    Some(exchange_rate)
}

fn log_proportion_or_panic(env: &Env, proportion: i128) -> i128 {
    let complement = checked_sub(env, WAD, proportion);
    if complement <= 0 {
        panic_with_error!(env, Error::MarketProportionTooHigh);
    }

    let ratio = mul_div_down_or_panic(env, proportion, WAD, complement);
    ln_wad_or_panic(env, ratio)
}

/// Converts the stored continuously-compounded log rate into an annualized
/// yield in basis points: `(e^ln_rate - 1) * 10_000`.
///
/// This used to return `ln_rate * 10_000 / WAD`, i.e. the continuously
/// compounded rate reported as if it were APY. That understates the real
/// number, and the gap widens with the rate: at the live testnet market's
/// stored `ln_rate = 0.195909` it reported 1959 bps where the true annualized
/// yield is 2164 bps — 2.05 percentage points low.
///
/// Negative `ln_rate` (PT trading above par, i.e. negative implied yield) maps
/// to a negative bps value rather than being clamped, so callers can tell an
/// inverted market from a flat one.
fn ln_rate_to_bps(env: &Env, ln_rate: i128) -> i128 {
    if ln_rate == 0 {
        return 0;
    }
    let growth = checked_sub_signed(env, exp_wad_or_panic(env, ln_rate), WAD);
    mul_div_signed_down_or_panic(env, growth, BPS_DENOMINATOR, WAD)
}

/// `lhs - rhs` without the non-negative constraint `checked_sub` imposes.
fn checked_sub_signed(env: &Env, lhs: i128, rhs: i128) -> i128 {
    match lhs.checked_sub(rhs) {
        Some(value) => value,
        None => panic_with_error!(env, Error::MathOverflow),
    }
}

/// `lhs * rhs / denominator` for a possibly-negative `lhs`.
fn mul_div_signed_down_or_panic(env: &Env, lhs: i128, rhs: i128, denominator: i128) -> i128 {
    if denominator == 0 {
        panic_with_error!(env, Error::MathOverflow);
    }
    checked_mul(env, lhs, rhs) / denominator
}

// ln(2) scaled by WAD. Used to range-reduce ln and exp into a small interval
// where the series below converge quickly. Soroban's wasm VM rejects
// floating-point instructions, so all transcendental math here is integer
// fixed-point (i128, WAD = 1e18); these replace the previous libm f64 helpers.
const LN2_WAD: i128 = 693_147_180_559_945_309;

fn integer_sqrt_or_panic(env: &Env, value: i128) -> i128 {
    if value <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }

    // Floor integer square root via Newton's method. Exact for every i128 >= 1
    // and, unlike the previous f64 sqrt, it does not lose precision for products
    // approaching WAD^2 (~1e36), which f64's 53-bit mantissa cannot represent.
    let mut x = value;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + value / x) / 2;
    }
    x
}

// Natural log of a WAD-fixed positive value, returned WAD-fixed (signed).
// Range-reduce value = m * 2^k with m in [1, 2), so ln(value) = k*ln2 + ln(m),
// and evaluate ln(m) with the fast atanh series
// ln(m) = 2*(z + z^3/3 + z^5/5 + ...), z = (m-1)/(m+1) in [0, 1/3].
fn ln_wad_checked(value: i128) -> Option<i128> {
    if value <= 0 {
        return None;
    }

    let mut k: i128 = 0;
    let mut m = value;
    while m >= 2 * WAD {
        m /= 2;
        k += 1;
    }
    while m < WAD {
        m = m.checked_mul(2)?;
        k -= 1;
    }

    // z = (m - WAD) / (m + WAD), WAD-fixed, in [0, 1/3].
    let z = (m - WAD).checked_mul(WAD)? / (m + WAD);
    let z2 = z.checked_mul(z)? / WAD; // z^2, WAD-fixed (<= ~1/9)

    let mut term = z; // z^(2n+1), starting at z^1
    let mut sum = z;
    let mut n: i128 = 3;
    // z^2 <= 1/9 so terms decay ~9x each step; 24 terms is far past 1e-18.
    while n <= 49 {
        term = term.checked_mul(z2)? / WAD;
        sum = sum.checked_add(term / n)?;
        n += 2;
    }

    let ln_mant = sum.checked_mul(2)?;
    k.checked_mul(LN2_WAD)?.checked_add(ln_mant)
}

fn ln_wad_or_panic(env: &Env, value: i128) -> i128 {
    match ln_wad_checked(value) {
        Some(v) => v,
        None => panic_with_error!(env, Error::MathOverflow),
    }
}

fn try_ln_wad(_env: &Env, value: i128) -> Option<i128> {
    ln_wad_checked(value)
}

// e^x for WAD-fixed signed x, returned WAD-fixed. Range-reduce x = k*ln2 + r
// with |r| <= ln2/2, so e^x = 2^k * e^r, and evaluate e^r with its Taylor
// series (|r| <= 0.347 converges in a handful of terms).
fn exp_wad_checked(value: i128) -> Option<i128> {
    let k = if value >= 0 {
        (value + LN2_WAD / 2) / LN2_WAD
    } else {
        (value - LN2_WAD / 2) / LN2_WAD
    };
    let r = value.checked_sub(k.checked_mul(LN2_WAD)?)?; // |r| <= ln2/2

    let mut term = WAD; // r^0 / 0! = 1
    let mut sum = WAD;
    let mut i: i128 = 1;
    while i <= 20 {
        term = term.checked_mul(r)? / WAD / i; // term *= r/i
        if term == 0 {
            break;
        }
        sum = sum.checked_add(term)?;
        i += 1;
    }

    // Apply the 2^k factor.
    if k >= 0 {
        if k > 90 {
            return None; // e^x too large to represent in i128 WAD-fixed
        }
        sum.checked_mul(1i128 << k)
    } else {
        let shift = (-k) as u32;
        if shift >= 127 {
            return Some(0);
        }
        Some(sum >> shift)
    }
}

fn exp_wad_or_panic(env: &Env, value: i128) -> i128 {
    match exp_wad_checked(value) {
        Some(v) => v,
        None => panic_with_error!(env, Error::MathOverflow),
    }
}

fn mul_div_down_or_panic(env: &Env, lhs: i128, rhs: i128, denominator: i128) -> i128 {
    if denominator == 0 {
        panic_with_error!(env, Error::MathOverflow);
    }

    checked_mul(env, lhs, rhs) / denominator
}

fn mul_div_up_or_panic(env: &Env, lhs: i128, rhs: i128, denominator: i128) -> i128 {
    if denominator == 0 {
        panic_with_error!(env, Error::MathOverflow);
    }

    let product = checked_mul(env, lhs, rhs);
    let quotient = product / denominator;
    if product % denominator == 0 {
        quotient
    } else {
        checked_add(env, quotient, 1)
    }
}

fn checked_add(env: &Env, lhs: i128, rhs: i128) -> i128 {
    match lhs.checked_add(rhs) {
        Some(value) => value,
        None => panic_with_error!(env, Error::MathOverflow),
    }
}

fn checked_bounded_reserve_add(env: &Env, lhs: i128, rhs: i128) -> i128 {
    let value = checked_add(env, lhs, rhs);
    require_within_reserve_bounds(env, value);
    value
}

fn checked_sub(env: &Env, lhs: i128, rhs: i128) -> i128 {
    match lhs.checked_sub(rhs) {
        Some(value) if value >= 0 => value,
        _ => panic_with_error!(env, Error::MathOverflow),
    }
}

fn checked_mul(env: &Env, lhs: i128, rhs: i128) -> i128 {
    match lhs.checked_mul(rhs) {
        Some(value) => value,
        None => panic_with_error!(env, Error::MathOverflow),
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;
    use novaire_sy_wrapper::{SyWrapper, SyWrapperClient};
    use proptest::prelude::*;
    use soroban_sdk::testutils::{
        storage::Persistent, Address as _, Deployer, EnvTestConfig, Ledger,
    };
    use std::panic::{catch_unwind, AssertUnwindSafe};

    const NOW: u64 = 1_770_000_000;
    const MATURITY: u64 = NOW + 90 * DAY;
    const SCALAR_ROOT: i128 = 2 * WAD;
    const INITIAL_ANCHOR: i128 = 1_050_000_000_000_000_000;
    const FEE_BPS: i128 = 10;
    const TWAP_WINDOW: u64 = 30 * 60;
    const INITIAL_TOKEN_BALANCE: i128 = 10_000_000;

    struct Fixture {
        env: Env,
        client: AmmMarketClient<'static>,
        contract_id: Address,
        admin: Address,
        underlying: Address,
        pt_token: Address,
        sy_token: Address,
        yt_token: Address,
        tokenizer: Address,
        bob: Address,
        pool: Address,
    }

    fn fixture(now: u64) -> Fixture {
        let env = Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.ledger().set_timestamp(now);
        env.mock_all_auths();

        let contract_id = env.register(AmmMarket, ());
        let client = AmmMarketClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let pt_token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        // A real SY wrapper backed by a mock Blend pool, so the YT quote
        // paths can read exchange_rate the same way the tokenizer does. Most
        // unit tests run at the default pool rate of 1.0; tests that
        // specifically target SY/asset unit handling move the rate with
        // set_rate below.
        let underlying = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let pool = env.register(novaire_blend_adapter::testutils::MockBlendPool, ());
        novaire_blend_adapter::testutils::MockBlendPoolClient::new(&env, &pool)
            .initialize(&underlying);
        let sy_token = env.register(SyWrapper, ());
        SyWrapperClient::new(&env, &sy_token).initialize_blend(&admin, &underlying, &pool);
        // A placeholder YT token; the unit fixture uses a stub tokenizer, so the
        // YT flash routes are exercised in tests/integration instead.
        let yt_token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let tokenizer = Address::generate(&env);
        let bob = Address::generate(&env);

        token::StellarAssetClient::new(&env, &pt_token).mint(&admin, &INITIAL_TOKEN_BALANCE);
        token::StellarAssetClient::new(&env, &underlying).mint(&admin, &INITIAL_TOKEN_BALANCE);
        SyWrapperClient::new(&env, &sy_token).deposit(&admin, &INITIAL_TOKEN_BALANCE);

        Fixture {
            env,
            client,
            contract_id,
            admin,
            underlying,
            pt_token,
            sy_token,
            yt_token,
            tokenizer,
            bob,
            pool,
        }
    }

    /// Moves the SY wrapper's pool-derived exchange rate as close to
    /// `target_rate` (WAD-scale) as the mock pool's integer math allows, and
    /// returns the rate actually landed on. Mirrors
    /// tests/integration/journey.rs's set_rate: both the pool's b_rate
    /// (12-decimal) and the wrapper's aum * WAD / sy_supply derivation
    /// floor-divide, so callers must read back the returned rate.
    fn set_rate(fixture: &Fixture, sy_supply: i128, target_rate: i128) -> i128 {
        let aum_target = target_rate * sy_supply / WAD;
        let new_b_rate = aum_target * novaire_blend_adapter::BLEND_SCALAR_12 / sy_supply;
        novaire_blend_adapter::testutils::MockBlendPoolClient::new(&fixture.env, &fixture.pool)
            .set_b_rate(&new_b_rate);
        SyWrapperClient::new(&fixture.env, &fixture.sy_token).exchange_rate()
    }

    fn pt_balance(fixture: &Fixture, holder: &Address) -> i128 {
        token::TokenClient::new(&fixture.env, &fixture.pt_token).balance(holder)
    }

    fn sy_balance(fixture: &Fixture, holder: &Address) -> i128 {
        token::TokenClient::new(&fixture.env, &fixture.sy_token).balance(holder)
    }

    fn pool_pt_balance(fixture: &Fixture) -> i128 {
        pt_balance(fixture, &fixture.contract_id)
    }

    fn pool_sy_balance(fixture: &Fixture) -> i128 {
        sy_balance(fixture, &fixture.contract_id)
    }

    fn mint_pt(fixture: &Fixture, holder: &Address, amount: i128) {
        token::StellarAssetClient::new(&fixture.env, &fixture.pt_token).mint(holder, &amount);
    }

    /// Mints `amount` SY shares to `holder` by depositing underlying at the
    /// wrapper's default 1.0 rate (1 underlying deposits to 1 share).
    fn mint_sy(fixture: &Fixture, holder: &Address, amount: i128) {
        token::StellarAssetClient::new(&fixture.env, &fixture.underlying).mint(holder, &amount);
        SyWrapperClient::new(&fixture.env, &fixture.sy_token).deposit(holder, &amount);
    }

    fn burn_pt(fixture: &Fixture, holder: &Address, amount: i128) {
        token::TokenClient::new(&fixture.env, &fixture.pt_token).burn(holder, &amount);
    }

    /// Burns `amount` SY shares from `holder` by redeeming them for underlying
    /// at the wrapper's default 1.0 rate.
    fn burn_sy(fixture: &Fixture, holder: &Address, amount: i128) {
        SyWrapperClient::new(&fixture.env, &fixture.sy_token).redeem(holder, &amount);
    }

    fn initialize(fixture: &Fixture) {
        fixture.client.initialize(
            &fixture.admin,
            &fixture.pt_token,
            &fixture.sy_token,
            &fixture.yt_token,
            &fixture.tokenizer,
            &MATURITY,
            &SCALAR_ROOT,
            &INITIAL_ANCHOR,
            &FEE_BPS,
            &TWAP_WINDOW,
        );
    }

    #[test]
    fn initialize_stores_config_and_empty_state() {
        let fixture = fixture(NOW);

        initialize(&fixture);

        assert_eq!(
            fixture.client.config(),
            Config {
                admin: fixture.admin,
                pt_token: fixture.pt_token,
                sy_token: fixture.sy_token,
                yt_token: fixture.yt_token,
                tokenizer: fixture.tokenizer,
                maturity: MATURITY,
                scalar_root: SCALAR_ROOT,
                initial_anchor: INITIAL_ANCHOR,
                fee_bps: FEE_BPS,
                twap_window: TWAP_WINDOW,
            }
        );
        assert_eq!(
            fixture.client.state(),
            State {
                total_pt: 0,
                total_sy: 0,
                total_lp: 0,
                last_ln_implied_rate: 0,
                twap_ln_implied_rate: 0,
                last_observation: NOW,
                warmup_until: NOW + TWAP_WINDOW,
            }
        );
        assert_eq!(fixture.client.implied_apy(), 0);
        assert_eq!(fixture.client.spot_apy(), 0);
        assert_eq!(fixture.client.reserve_pt(), 0);
        assert_eq!(fixture.client.reserve_sy(), 0);
        assert_eq!(fixture.client.total_lp(), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #18)")]
    fn initialize_rejects_curve_inputs_above_testnet_bounds() {
        let fixture = fixture(NOW);
        fixture.client.initialize(
            &fixture.admin,
            &fixture.pt_token,
            &fixture.sy_token,
            &fixture.yt_token,
            &fixture.tokenizer,
            &MATURITY,
            &(MAX_SCALAR_ROOT + 1),
            &INITIAL_ANCHOR,
            &FEE_BPS,
            &TWAP_WINDOW,
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #18)")]
    fn liquidity_rejects_amounts_above_testnet_bounds() {
        let fixture = fixture(NOW);
        initialize(&fixture);

        fixture
            .client
            .add_liquidity(&fixture.admin, &(MAX_RESERVE_UNITS + 1), &10_000, &0);
    }

    #[test]
    fn bump_ttl_extends_idle_market_instance_ttl() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        lower_instance_ttl_below_threshold(&fixture);

        fixture.client.bump_ttl();

        assert!(
            fixture
                .env
                .deployer()
                .get_contract_instance_ttl(&fixture.contract_id)
                >= AMM_INSTANCE_TTL_EXTEND_TO_LEDGERS
        );
    }

    #[test]
    fn bump_lp_ttl_extends_idle_lp_balance_ttl() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &0);

        let key = DataKey::LpBalance(fixture.admin.clone());
        let ttl = fixture.env.as_contract(&fixture.contract_id, || {
            fixture.env.storage().persistent().get_ttl(&key)
        });
        assert!(ttl > AMM_INSTANCE_TTL_THRESHOLD_LEDGERS);

        let target_ttl = AMM_INSTANCE_TTL_THRESHOLD_LEDGERS - 1;
        fixture
            .env
            .ledger()
            .set_sequence_number(fixture.env.ledger().sequence() + ttl - target_ttl);
        fixture.env.as_contract(&fixture.contract_id, || {
            assert!(
                fixture.env.storage().persistent().get_ttl(&key)
                    < AMM_INSTANCE_TTL_THRESHOLD_LEDGERS
            );
        });

        fixture.client.bump_lp_ttl(&fixture.admin);

        fixture.env.as_contract(&fixture.contract_id, || {
            assert!(
                fixture.env.storage().persistent().get_ttl(&key)
                    >= AMM_INSTANCE_TTL_EXTEND_TO_LEDGERS
            );
        });
    }

    #[test]
    fn mutating_entrypoints_extend_instance_ttl() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        lower_instance_ttl_below_threshold(&fixture);

        fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &0);

        assert!(
            fixture
                .env
                .deployer()
                .get_contract_instance_ttl(&fixture.contract_id)
                >= AMM_INSTANCE_TTL_EXTEND_TO_LEDGERS
        );
    }

    #[test]
    fn first_liquidity_seeds_market_state() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        let admin_pt_before = pt_balance(&fixture, &fixture.admin);
        let admin_sy_before = sy_balance(&fixture, &fixture.admin);

        let lp_out = fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &0);
        let state = fixture.client.state();

        assert_eq!(lp_out, 9_000);
        assert_eq!(state.total_pt, 10_000);
        assert_eq!(state.total_sy, 10_000);
        assert_eq!(state.total_lp, 10_000);
        assert_eq!(fixture.client.lp_balance(&fixture.admin), 9_000);
        assert!(state.last_ln_implied_rate > 0);
        assert_eq!(state.last_ln_implied_rate, state.twap_ln_implied_rate);
        assert!(fixture.client.implied_apy() > 0);
        assert_eq!(pool_pt_balance(&fixture), state.total_pt);
        assert_eq!(pool_sy_balance(&fixture), state.total_sy);
        assert_eq!(
            pt_balance(&fixture, &fixture.admin),
            admin_pt_before - 10_000
        );
        assert_eq!(
            sy_balance(&fixture, &fixture.admin),
            admin_sy_before - 10_000
        );
    }

    #[test]
    fn remove_liquidity_returns_pro_rata_assets() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        let admin_pt_before = pt_balance(&fixture, &fixture.admin);
        let admin_sy_before = sy_balance(&fixture, &fixture.admin);
        fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &0);

        let (pt_out, sy_out) = fixture
            .client
            .remove_liquidity(&fixture.admin, &9_000, &0, &0);
        let state = fixture.client.state();

        assert_eq!((pt_out, sy_out), (9_000, 9_000));
        assert_eq!(state.total_pt, 1_000);
        assert_eq!(state.total_sy, 1_000);
        assert_eq!(state.total_lp, 1_000);
        assert_eq!(fixture.client.lp_balance(&fixture.admin), 0);
        assert_eq!(pool_pt_balance(&fixture), 1_000);
        assert_eq!(pool_sy_balance(&fixture), 1_000);
        assert_eq!(
            pt_balance(&fixture, &fixture.admin),
            admin_pt_before - 1_000
        );
        assert_eq!(
            sy_balance(&fixture, &fixture.admin),
            admin_sy_before - 1_000
        );
    }

    #[test]
    fn remove_liquidity_after_maturity_returns_pro_rata_assets() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        let admin_pt_before = pt_balance(&fixture, &fixture.admin);
        let admin_sy_before = sy_balance(&fixture, &fixture.admin);
        fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &0);

        fixture.env.ledger().set_timestamp(MATURITY);
        let (pt_out, sy_out) = fixture
            .client
            .remove_liquidity(&fixture.admin, &9_000, &0, &0);
        let state = fixture.client.state();

        assert_eq!((pt_out, sy_out), (9_000, 9_000));
        assert_eq!(state.total_pt, 1_000);
        assert_eq!(state.total_sy, 1_000);
        assert_eq!(state.total_lp, 1_000);
        assert_eq!(fixture.client.lp_balance(&fixture.admin), 0);
        assert_eq!(pool_pt_balance(&fixture), 1_000);
        assert_eq!(pool_sy_balance(&fixture), 1_000);
        assert_eq!(
            pt_balance(&fixture, &fixture.admin),
            admin_pt_before - 1_000
        );
        assert_eq!(
            sy_balance(&fixture, &fixture.admin),
            admin_sy_before - 1_000
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #11)")]
    fn add_liquidity_reverts_when_min_lp_out_not_met() {
        let fixture = fixture(NOW);
        initialize(&fixture);

        // The initial seed mints sqrt(10_000 * 10_000) - MINIMUM_LIQUIDITY
        // = 9_000 LP; asking for one more must revert with SlippageExceeded.
        fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &9_001);
    }

    #[test]
    fn add_liquidity_passes_exact_min_lp_out() {
        let fixture = fixture(NOW);
        initialize(&fixture);

        let lp_out = fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &9_000);
        assert_eq!(lp_out, 9_000);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #11)")]
    fn add_liquidity_min_lp_out_catches_ratio_move_between_quote_and_execution() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        mint_pt(&fixture, &fixture.bob, 1_000);
        mint_sy(&fixture, &fixture.bob, 1_000);

        // Quoted off the seeded 20_000/20_000 pool: 1_000 PT + 1_000 SY mints
        // 1_000 LP. Someone else moves the ratio before bob executes.
        let stale_quote = 1_000;
        mint_sy(&fixture, &fixture.admin, 2_000);
        fixture.client.swap_sy_for_pt(&fixture.admin, &2_000, &1);

        // With total_sy grown past 20_000, lp_by_sy = 1_000 * total_lp /
        // total_sy < 1_000, so the stale min must revert.
        fixture
            .client
            .add_liquidity(&fixture.bob, &1_000, &1_000, &stale_quote);
    }

    // --- P1-01: exact-in swaps must never confiscate unspent input ---------
    //
    // The solver returns the largest pt_out it can AFFORD, but it is bounded
    // above by `total_pt - 1` and by the ExchangeRateBelowOne /
    // MarketProportionTooHigh limits. Past that bound, extra sy_in buys nothing.
    // The swap used to transfer the caller's whole `sy_in` regardless, donating
    // the difference to LPs. On the live testnet pool a 40 SY order received the
    // same 3.9586 PT as a 4 SY order and lost ~90% of its input.

    /// The saturation point: the smallest sy_in whose pt_out stops growing.
    /// Returned as (sy_in_at_saturation, pt_out_at_saturation).
    fn pt_saturation_point(fixture: &Fixture) -> (i128, i128) {
        let mut last = fixture.client.quote_sy_for_pt(&1_000);
        let mut probe = 1_000_i128;
        for _ in 0..64 {
            let next = probe * 2;
            let out = match catch_unwind(AssertUnwindSafe(|| fixture.client.quote_sy_for_pt(&next)))
            {
                Ok(out) => out,
                Err(_) => return (probe, last),
            };
            if out == last {
                return (probe, last);
            }
            last = out;
            probe = next;
        }
        panic!("pool never saturated; widen the probe");
    }

    #[test]
    fn saturated_pt_buy_charges_only_the_curve_cost() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        let (sat_sy_in, sat_pt_out) = pt_saturation_point(&fixture);
        // Overshoot the saturation point by 8x. The curve cannot give more PT.
        let overshoot = sat_sy_in * 8;
        let (quoted_pt, quoted_cost) = fixture.client.quote_sy_for_pt_cost(&overshoot);
        assert_eq!(
            quoted_pt, sat_pt_out,
            "8x the input must not buy more PT past saturation"
        );
        assert!(
            quoted_cost < overshoot,
            "saturated quote must cost less than the budget: cost {} vs budget {}",
            quoted_cost,
            overshoot
        );

        mint_sy(&fixture, &fixture.bob, overshoot);
        let sy_before = sy_balance(&fixture, &fixture.bob);
        let pool_sy_before = pool_sy_balance(&fixture);

        let pt_out = fixture.client.swap_sy_for_pt(&fixture.bob, &overshoot, &1);

        let spent = sy_before - sy_balance(&fixture, &fixture.bob);
        assert_eq!(pt_out, quoted_pt, "execution must match the quote");
        assert_eq!(
            spent, quoted_cost,
            "trader must be debited the curve cost, not the whole budget"
        );
        assert_eq!(
            pool_sy_balance(&fixture) - pool_sy_before,
            quoted_cost,
            "pool must receive exactly what the trader paid: no value created"
        );
        // The regression this pins: `spent` used to equal `overshoot`.
        assert!(
            spent < overshoot,
            "unspent input was confiscated: spent {} of {}",
            spent,
            overshoot
        );
    }

    #[test]
    fn pt_buy_charge_equals_quoted_cost_at_every_size() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &200_000, &200_000, &0);

        for sy_in in [500_i128, 1_000, 5_000, 20_000, 60_000] {
            let (quoted_pt, quoted_cost) = fixture.client.quote_sy_for_pt_cost(&sy_in);
            mint_sy(&fixture, &fixture.bob, sy_in);
            let sy_before = sy_balance(&fixture, &fixture.bob);
            let pool_sy_before = pool_sy_balance(&fixture);

            let pt_out = fixture.client.swap_sy_for_pt(&fixture.bob, &sy_in, &1);
            let spent = sy_before - sy_balance(&fixture, &fixture.bob);

            assert_eq!(pt_out, quoted_pt, "size {sy_in}: pt_out mismatch");
            assert_eq!(spent, quoted_cost, "size {sy_in}: charge != quoted cost");
            assert_eq!(
                pool_sy_balance(&fixture) - pool_sy_before,
                spent,
                "size {sy_in}: pool delta != trader delta"
            );
            assert!(spent <= sy_in, "size {sy_in}: overcharged");
        }
    }

    #[test]
    fn pt_buy_effective_price_never_exceeds_par_plus_fee() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        // A PT redeems at 1.0 face at maturity, so no honest execution can pay
        // more than 1.0 + fee per unit of face. Before the fix, an oversized
        // order paid many multiples of par (live testnet: 10.2x).
        let (sat_sy_in, _) = pt_saturation_point(&fixture);
        for mult in [1_i128, 2, 4, 8] {
            let sy_in = sat_sy_in * mult;
            let (pt_out, cost) = fixture.client.quote_sy_for_pt_cost(&sy_in);
            assert!(pt_out > 0, "no PT quoted at {sy_in}");
            // rate is 1.0 in this fixture, so SY shares == asset units.
            let ceiling = pt_out + (pt_out * (FEE_BPS + 1) / BPS_DENOMINATOR) + 1;
            assert!(
                cost <= ceiling,
                "paid {cost} SY for {pt_out} PT face (> par + fee ceiling {ceiling})"
            );
        }
    }

    // --- P2-01: implied rate must be reported as APY, not as the log rate ----

    #[test]
    fn ln_rate_to_bps_annualizes_instead_of_reporting_the_log_rate() {
        let env = Env::default();
        // The live testnet market's stored rate. The old implementation returned
        // 1959 bps (the log rate); the annualized yield is e^0.195909 - 1 =
        // 21.64%.
        let bps = ln_rate_to_bps(&env, 195_909_333_878_730_541);
        assert!(
            (2_160..=2_168).contains(&bps),
            "expected ~2164 bps (21.64% APY), got {bps}"
        );
        assert!(bps > 1_959, "must exceed the raw log rate it replaced");
    }

    #[test]
    fn ln_rate_to_bps_is_zero_at_zero() {
        let env = Env::default();
        assert_eq!(ln_rate_to_bps(&env, 0), 0);
    }

    #[test]
    fn ln_rate_to_bps_matches_log_rate_closely_when_small() {
        let env = Env::default();
        // e^0.01 - 1 = 0.010050..., so 100 bps of log rate is ~100 bps of APY.
        let bps = ln_rate_to_bps(&env, WAD / 100);
        assert!((100..=101).contains(&bps), "got {bps}");
    }

    #[test]
    fn ln_rate_to_bps_reports_negative_yield_as_negative() {
        let env = Env::default();
        // PT above par => negative implied yield. Must not clamp to zero, or an
        // inverted market is indistinguishable from a flat one.
        let bps = ln_rate_to_bps(&env, -(WAD / 10));
        assert!(bps < 0, "expected negative bps, got {bps}");
        assert!(
            (-960..=-950).contains(&bps),
            "e^-0.1 - 1 = -9.52%, got {bps}"
        );
    }

    #[test]
    fn spot_apy_reports_annualized_yield() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        let state = fixture.client.state();
        let expected = ln_rate_to_bps(&fixture.env, state.last_ln_implied_rate);
        assert_eq!(fixture.client.spot_apy(), expected);
        // And it is strictly above the raw log-rate reading it replaced.
        assert!(fixture.client.spot_apy() > (state.last_ln_implied_rate * BPS_DENOMINATOR) / WAD);
    }

    // --- P1-02: donations must not be able to move the curve ---------------

    #[test]
    fn donated_pt_never_enters_curve_reserves() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        let apy_before = fixture.client.spot_apy();
        let state_before = fixture.client.state();

        // Anyone can transfer straight to the AMM address. Under the old
        // balanceOf-derived reconcile this landed in curve state on the next
        // mutating call, letting a third party nudge the anchor and every
        // downstream quote for the price of a donation.
        mint_pt(&fixture, &fixture.bob, 5_000);
        token::TokenClient::new(&fixture.env, &fixture.pt_token).transfer(
            &fixture.bob,
            &fixture.contract_id,
            &5_000,
        );

        assert_eq!(
            fixture.client.state().total_pt,
            state_before.total_pt,
            "donation must not enter reserves"
        );

        // Drive every mutating path; none may absorb it.
        mint_sy(&fixture, &fixture.admin, 1_000);
        fixture.client.swap_sy_for_pt(&fixture.admin, &1_000, &1);
        mint_pt(&fixture, &fixture.admin, 1_000);
        fixture.client.swap_pt_for_sy(&fixture.admin, &1_000, &1);
        mint_pt(&fixture, &fixture.admin, 500);
        mint_sy(&fixture, &fixture.admin, 500);
        fixture.client.add_liquidity(&fixture.admin, &500, &500, &0);
        fixture
            .client
            .remove_liquidity(&fixture.admin, &100, &0, &0);

        let (untracked_pt, _) = fixture.client.untracked_balance();
        assert_eq!(untracked_pt, 5_000, "donation must remain untracked");
        assert_ne!(apy_before, 0, "fixture must have a live rate to compare");
    }

    #[test]
    fn donated_sy_never_enters_curve_reserves() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        let before = fixture.client.state();

        mint_sy(&fixture, &fixture.bob, 7_500);
        token::TokenClient::new(&fixture.env, &fixture.sy_token).transfer(
            &fixture.bob,
            &fixture.contract_id,
            &7_500,
        );

        mint_pt(&fixture, &fixture.admin, 1_000);
        fixture.client.swap_pt_for_sy(&fixture.admin, &1_000, &1);

        let (_, untracked_sy) = fixture.client.untracked_balance();
        assert_eq!(untracked_sy, 7_500, "donated SY must stay out of the curve");
        assert!(
            fixture.client.state().total_sy < before.total_sy,
            "the swap itself must still move reserves normally"
        );
    }

    #[test]
    fn reserve_views_report_curve_state_not_custody() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        mint_pt(&fixture, &fixture.bob, 1_234);
        token::TokenClient::new(&fixture.env, &fixture.pt_token).transfer(
            &fixture.bob,
            &fixture.contract_id,
            &1_234,
        );

        assert_eq!(fixture.client.reserve_pt(), fixture.client.state().total_pt);
        assert_eq!(fixture.client.reserve_sy(), fixture.client.state().total_sy);
        assert_eq!(
            pool_pt_balance(&fixture) - fixture.client.reserve_pt(),
            1_234,
            "custody exceeds curve reserves by exactly the donation"
        );
    }

    // --- P3: pause, governance, fee switch ---------------------------------

    #[test]
    fn pause_blocks_entries_but_never_lets_lps_get_stuck() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        fixture.client.pause();
        assert!(fixture.client.is_paused());

        // Entries are closed.
        mint_sy(&fixture, &fixture.admin, 1_000);
        assert!(fixture
            .client
            .try_swap_sy_for_pt(&fixture.admin, &1_000, &1)
            .is_err());
        mint_pt(&fixture, &fixture.admin, 1_000);
        assert!(fixture
            .client
            .try_swap_pt_for_sy(&fixture.admin, &1_000, &1)
            .is_err());
        assert!(fixture
            .client
            .try_add_liquidity(&fixture.admin, &1_000, &1_000, &0)
            .is_err());

        // Exit is not. An LP must always be able to withdraw.
        let (pt_out, sy_out) = fixture
            .client
            .remove_liquidity(&fixture.admin, &5_000, &0, &0);
        assert!(
            pt_out > 0 && sy_out > 0,
            "remove_liquidity must survive pause"
        );

        // A paused market stays legible, not opaque.
        assert!(fixture.client.quote_pt_for_sy(&1_000) > 0);
        assert!(fixture.client.spot_apy() != 0);

        fixture.client.unpause();
        fixture.client.swap_sy_for_pt(&fixture.admin, &1_000, &1);
    }

    #[test]
    fn admin_transfer_is_two_step() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        let next = Address::generate(&fixture.env);
        fixture.client.propose_admin(&next);
        assert_eq!(fixture.client.config().admin, fixture.admin);
        fixture.client.accept_admin();
        assert_eq!(fixture.client.config().admin, next);
        assert_eq!(fixture.client.pending_admin(), None);
    }

    #[test]
    fn upgrade_respects_the_timelock() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        let hash = BytesN::from_array(&fixture.env, &[3u8; 32]);
        let eta = fixture.client.propose_upgrade(&hash);
        assert_eq!(eta, NOW + UPGRADE_TIMELOCK_SECONDS);
        assert!(fixture.client.try_execute_upgrade().is_err());
        fixture.client.cancel_upgrade();
        assert_eq!(fixture.client.pending_upgrade(), None);
    }

    #[test]
    fn protocol_fee_defaults_to_zero_and_changes_nothing() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        assert_eq!(fixture.client.protocol_fee_share_bps(), 0);

        mint_sy(&fixture, &fixture.admin, 1_000);
        let before = fixture.client.state();
        fixture.client.swap_sy_for_pt(&fixture.admin, &1_000, &1);
        let after = fixture.client.state();

        // At the shipped default, reserves absorb the entire fee exactly as
        // they did before the switch existed.
        assert_eq!(fixture.client.protocol_fees_accrued(), 0);
        assert!(after.total_sy > before.total_sy);
    }

    #[test]
    fn protocol_fee_takes_a_share_of_the_fee_not_the_trade() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &200_000, &200_000, &0);
        let treasury = Address::generate(&fixture.env);
        fixture.client.set_protocol_fee(&3_000, &treasury); // 30% of the fee

        mint_sy(&fixture, &fixture.admin, 50_000);
        fixture.client.swap_sy_for_pt(&fixture.admin, &50_000, &1);
        let accrued = fixture.client.protocol_fees_accrued();

        assert!(accrued > 0, "30% of a real fee must accrue something");
        // The fee is 10bps of the trade; the protocol takes 30% of THAT, so the
        // cut must be a tiny fraction of the trade, never a share of it.
        assert!(
            accrued < 50_000 * FEE_BPS / BPS_DENOMINATOR + 2,
            "cut {accrued} exceeds the whole fee — it is being taken from the trade"
        );
    }

    #[test]
    fn protocol_fee_share_is_capped() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        let treasury = Address::generate(&fixture.env);
        assert!(fixture
            .client
            .try_set_protocol_fee(&(MAX_PROTOCOL_FEE_SHARE_BPS + 1), &treasury)
            .is_err());
        fixture
            .client
            .set_protocol_fee(&MAX_PROTOCOL_FEE_SHARE_BPS, &treasury);
    }

    #[test]
    fn sweep_refuses_the_reserves() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        assert!(fixture
            .client
            .try_sweep(&fixture.pt_token, &fixture.admin)
            .is_err());
        assert!(fixture
            .client
            .try_sweep(&fixture.sy_token, &fixture.admin)
            .is_err());
    }

    #[test]
    fn add_liquidity_generous_min_survives_ratio_move() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        mint_pt(&fixture, &fixture.bob, 1_000);
        mint_sy(&fixture, &fixture.bob, 1_000);
        mint_sy(&fixture, &fixture.admin, 2_000);
        fixture.client.swap_sy_for_pt(&fixture.admin, &2_000, &1);

        let lp_out = fixture
            .client
            .add_liquidity(&fixture.bob, &1_000, &1_000, &900);
        assert!((900..1_000).contains(&lp_out));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #11)")]
    fn remove_liquidity_reverts_when_min_sy_out_not_met() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        // Quoted pro-rata for 1_000 LP: 1_000 PT and 1_000 SY. A PT seller
        // drains SY from the pool before the removal executes, so the stale
        // min_sy_out must revert.
        let stale_sy_quote = 1_000;
        mint_pt(&fixture, &fixture.admin, 2_000);
        fixture.client.swap_pt_for_sy(&fixture.admin, &2_000, &1);

        fixture
            .client
            .remove_liquidity(&fixture.admin, &1_000, &0, &stale_sy_quote);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #11)")]
    fn remove_liquidity_reverts_when_min_pt_out_not_met() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        // A PT buyer drains PT from the pool, so pt_out per LP falls below the
        // stale pro-rata quote of 1_000.
        let stale_pt_quote = 1_000;
        mint_sy(&fixture, &fixture.admin, 2_000);
        fixture.client.swap_sy_for_pt(&fixture.admin, &2_000, &1);

        fixture
            .client
            .remove_liquidity(&fixture.admin, &1_000, &stale_pt_quote, &0);
    }

    #[test]
    fn remove_liquidity_generous_bounds_pass_after_ratio_move() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        mint_pt(&fixture, &fixture.admin, 2_000);
        fixture.client.swap_pt_for_sy(&fixture.admin, &2_000, &1);

        let (pt_out, sy_out) =
            fixture
                .client
                .remove_liquidity(&fixture.admin, &1_000, &1_000, &900);
        assert!(pt_out >= 1_000, "PT per LP grew after the PT sell");
        assert!((900..1_000).contains(&sy_out), "SY per LP shrank");
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn add_liquidity_rejects_after_maturity() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &0);

        fixture.env.ledger().set_timestamp(MATURITY);
        fixture
            .client
            .add_liquidity(&fixture.admin, &1_000, &1_000, &0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn swap_pt_for_sy_rejects_after_maturity() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        mint_pt(&fixture, &fixture.admin, 1_000);

        fixture.env.ledger().set_timestamp(MATURITY);
        fixture.client.swap_pt_for_sy(&fixture.admin, &1_000, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn swap_sy_for_pt_rejects_after_maturity() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        mint_sy(&fixture, &fixture.admin, 1_000);

        fixture.env.ledger().set_timestamp(MATURITY);
        fixture.client.swap_sy_for_pt(&fixture.admin, &1_000, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn swap_sy_for_yt_rejects_after_maturity() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        mint_sy(&fixture, &fixture.admin, 1_000);

        fixture.env.ledger().set_timestamp(MATURITY);
        fixture.client.swap_sy_for_yt(&fixture.admin, &1_000, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn swap_yt_for_sy_rejects_after_maturity() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        fixture.env.ledger().set_timestamp(MATURITY);
        fixture.client.swap_yt_for_sy(&fixture.admin, &1_000, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #12)")]
    fn non_lp_cannot_remove_liquidity() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &0);

        fixture
            .client
            .remove_liquidity(&fixture.bob, &1_000, &0, &0);
    }

    #[test]
    fn swap_pt_for_sy_updates_reserves_and_observation() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        mint_pt(&fixture, &fixture.admin, 1_000);
        let admin_pt_before = pt_balance(&fixture, &fixture.admin);
        let admin_sy_before = sy_balance(&fixture, &fixture.admin);

        fixture.env.ledger().set_timestamp(NOW + 60);
        let sy_out = fixture.client.swap_pt_for_sy(&fixture.admin, &1_000, &1);
        let state = fixture.client.state();

        assert!(sy_out > 0);
        assert_eq!(state.total_pt, 21_000);
        assert_eq!(state.total_sy, 20_000 - sy_out);
        assert_eq!(state.last_observation, NOW + 60);
        assert!(state.twap_ln_implied_rate > 0);
        assert_eq!(pool_pt_balance(&fixture), state.total_pt);
        assert_eq!(pool_sy_balance(&fixture), state.total_sy);
        assert_eq!(
            pt_balance(&fixture, &fixture.admin),
            admin_pt_before - 1_000
        );
        assert_eq!(
            sy_balance(&fixture, &fixture.admin),
            admin_sy_before + sy_out
        );
    }

    #[test]
    fn swap_sy_for_pt_updates_reserves_and_observation() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        mint_sy(&fixture, &fixture.admin, 1_000);
        let admin_pt_before = pt_balance(&fixture, &fixture.admin);
        let admin_sy_before = sy_balance(&fixture, &fixture.admin);

        fixture.env.ledger().set_timestamp(NOW + 60);
        let pt_out = fixture.client.swap_sy_for_pt(&fixture.admin, &1_000, &1);
        let state = fixture.client.state();

        assert!(pt_out > 0);
        assert_eq!(state.total_pt, 20_000 - pt_out);
        assert_eq!(state.total_sy, 21_000);
        assert_eq!(state.last_observation, NOW + 60);
        assert!(state.twap_ln_implied_rate > 0);
        assert_eq!(pool_pt_balance(&fixture), state.total_pt);
        assert_eq!(pool_sy_balance(&fixture), state.total_sy);
        assert_eq!(
            pt_balance(&fixture, &fixture.admin),
            admin_pt_before + pt_out
        );
        assert_eq!(
            sy_balance(&fixture, &fixture.admin),
            admin_sy_before - 1_000
        );
    }

    #[test]
    fn pt_for_sy_quote_reprices_after_sy_rate_move_without_liquidity_change() {
        // Regression test for the SY/asset unit conflation at
        // precompute_or_panic (formerly `total_asset = state.total_sy`
        // unconverted). Yield accrual on the SY side, with no add/remove
        // liquidity, must move the curve's priced output even though
        // state.total_sy and state.total_pt are untouched.
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &1_000_000, &1_000_000, &0);

        let baseline = quote_pt_for_sy(&fixture, 10_000).expect("quote at par");

        let landed_rate = set_rate(&fixture, 1_000_000, 1_100_000_000_000_000_000);
        assert!(landed_rate > WAD, "rate must have moved above par");

        let state = fixture.client.state();
        assert_eq!(
            state.total_sy, 1_000_000,
            "no liquidity op should touch total_sy"
        );
        assert_eq!(state.total_pt, 1_000_000);

        let after_accrual = quote_pt_for_sy(&fixture, 10_000).expect("quote after accrual");
        assert_ne!(
            baseline, after_accrual,
            "quote must reprice once the SY exchange rate departs from 1.0, even with total_sy unchanged"
        );
        // Each SY share is now worth more of the underlying asset, so the
        // same PT face amount is priced against fewer, more valuable shares.
        assert!(
            after_accrual < baseline,
            "sy_out should fall as the SY exchange rate rises above par: baseline={baseline} after_accrual={after_accrual}"
        );
    }

    #[test]
    fn pt_for_sy_quote_falls_monotonically_as_sy_rate_rises() {
        let mut prior = i128::MAX;
        for target_rate in [
            WAD,
            1_050_000_000_000_000_000,
            1_100_000_000_000_000_000,
            1_200_000_000_000_000_000,
            1_500_000_000_000_000_000,
        ] {
            let fixture = fixture(NOW);
            initialize(&fixture);
            fixture
                .client
                .add_liquidity(&fixture.admin, &1_000_000, &1_000_000, &0);
            set_rate(&fixture, 1_000_000, target_rate);

            let sy_out = quote_pt_for_sy(&fixture, 10_000).expect("quote should succeed");
            assert!(
                sy_out < prior,
                "sy_out must decrease as the SY rate rises: rate={target_rate} sy_out={sy_out} prior={prior}"
            );
            prior = sy_out;
        }
    }

    #[test]
    fn swap_pt_for_sy_executes_fewer_sy_shares_at_appreciated_rate() {
        let par_fixture = fixture(NOW);
        initialize(&par_fixture);
        par_fixture
            .client
            .add_liquidity(&par_fixture.admin, &1_000_000, &1_000_000, &0);
        mint_pt(&par_fixture, &par_fixture.admin, 10_000);
        let par_sy_out = par_fixture
            .client
            .swap_pt_for_sy(&par_fixture.admin, &10_000, &1);

        let rich_fixture = fixture(NOW);
        initialize(&rich_fixture);
        rich_fixture
            .client
            .add_liquidity(&rich_fixture.admin, &1_000_000, &1_000_000, &0);
        set_rate(&rich_fixture, 1_000_000, 1_100_000_000_000_000_000);
        mint_pt(&rich_fixture, &rich_fixture.admin, 10_000);
        let rich_sy_out = rich_fixture
            .client
            .swap_pt_for_sy(&rich_fixture.admin, &10_000, &1);

        assert!(
            rich_sy_out < par_sy_out,
            "the same PT trade must settle for fewer SY shares once the SY rate has appreciated: par={par_sy_out} rich={rich_sy_out}"
        );
        // Sanity bound: the shares should have shrunk by roughly the SY rate
        // ratio (~1.10x), not stayed flat (the pre-fix bug) and not moved by
        // an unrelated magnitude.
        assert!(rich_sy_out * 11 / 10 <= par_sy_out + 5);
    }

    #[test]
    fn yt_quote_reprices_after_sy_rate_move() {
        // quote_sy_for_yt/quote_yt_for_sy do not touch the tokenizer, so they
        // exercise the flash-route curve math directly even with this
        // fixture's stub tokenizer.
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &1_000_000, &1_000_000, &0);

        let baseline_yt = fixture.client.quote_sy_for_yt(&10_000);

        set_rate(&fixture, 1_000_000, 1_100_000_000_000_000_000);
        let after_yt = fixture.client.quote_sy_for_yt(&10_000);

        assert_ne!(
            baseline_yt, after_yt,
            "the YT/flash quote must reflect the SY exchange rate through the same curve as the PT/SY path"
        );
    }

    #[test]
    fn round_trip_sy_to_pt_to_sy_conserves_value_at_nonpar_rate() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &1_000_000, &1_000_000, &0);
        set_rate(&fixture, 1_000_000, 1_200_000_000_000_000_000);

        mint_sy(&fixture, &fixture.admin, 50_000);
        let sy_before = sy_balance(&fixture, &fixture.admin);

        let pt_out = fixture.client.swap_sy_for_pt(&fixture.admin, &10_000, &1);
        let sy_out = fixture.client.swap_pt_for_sy(&fixture.admin, &pt_out, &1);

        let sy_after = sy_balance(&fixture, &fixture.admin);
        assert_eq!(sy_after, sy_before - 10_000 + sy_out);
        assert!(
            sy_out < 10_000,
            "round-tripping through PT must not create value beyond fee/rounding loss: sy_out={sy_out}"
        );
        // The only value destroyed should be the two legs' fees, the curve's
        // own price impact on a trade against finite depth, and
        // integer-rounding dust — not a unit-conversion artifact. Bound
        // generously (1% of notional against a 100x-deeper pool) so this
        // catches a broken conversion (which would be off by the ~20% SY
        // rate move) without being sensitive to the curve's normal slippage.
        let max_loss = 10_000 / 100;
        assert!(
            10_000 - sy_out <= max_loss,
            "round-trip loss {} exceeds the fee+slippage+rounding budget {}",
            10_000 - sy_out,
            max_loss
        );
    }

    #[test]
    fn sy_exact_in_swaps_credit_only_the_charged_amount_to_reserves() {
        let pt_fixture = fixture(NOW);
        initialize(&pt_fixture);
        pt_fixture
            .client
            .add_liquidity(&pt_fixture.admin, &20_000, &20_000, &0);
        let (sy_in, required_sy) = sy_in_with_rounding_gap(&pt_fixture);
        assert!(required_sy < sy_in);

        let before = pt_fixture.client.state();
        let sy_wallet_before = sy_balance(&pt_fixture, &pt_fixture.admin);
        pt_fixture
            .client
            .swap_sy_for_pt(&pt_fixture.admin, &sy_in, &1);
        let after = pt_fixture.client.state();
        let spent = sy_wallet_before - sy_balance(&pt_fixture, &pt_fixture.admin);

        // Reserves grow by exactly what the trader was debited, and the trader
        // is debited the curve cost — not their whole budget.
        //
        // This test previously asserted `after.total_sy == before.total_sy +
        // sy_in`, treating the (sy_in - required_sy) gap as rounding dust the
        // pool keeps. That holds only while the solver is bounded by the
        // caller's budget. When it is bounded by the curve instead, the same
        // line donates an unbounded amount: on the live testnet pool a 40 SY
        // order bought the same PT as a 4 SY order and lost ~90% of its input.
        assert_eq!(
            spent, required_sy,
            "trader charged more than the curve cost"
        );
        assert_eq!(after.total_sy, before.total_sy + required_sy);
        assert!(spent < sy_in, "fixture must exercise the rounding gap");
    }

    #[test]
    fn same_timestamp_swaps_do_not_overwrite_twap() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        fixture.env.ledger().set_timestamp(NOW + 60);
        fixture.client.swap_sy_for_pt(&fixture.admin, &1_000, &1);
        let after_first = fixture.client.state();

        fixture.client.swap_sy_for_pt(&fixture.admin, &1_500, &1);
        let after_second = fixture.client.state();

        assert_ne!(
            after_second.last_ln_implied_rate, after_first.twap_ln_implied_rate,
            "second swap must move spot so this test proves TWAP did not follow it"
        );
        assert_eq!(after_second.last_observation, after_first.last_observation);
        assert_eq!(
            after_second.twap_ln_implied_rate,
            after_first.twap_ln_implied_rate
        );
    }

    // The YT flash swaps move real tokens through the tokenizer and are
    // exercised end to end in tests/integration. Here we assert the pure
    // pricing the routes are built on.
    #[test]
    fn quote_sy_for_yt_is_leveraged() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        // Buying YT is leveraged: each SY buys more than its face in YT,
        // because the freshly minted PT is sold to fund the position.
        let yt_out = fixture.client.quote_sy_for_yt(&1_000);
        assert!(yt_out > 1_000);
    }

    #[test]
    fn quote_yt_for_sy_is_below_face() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        // Selling YT yields less SY than its face: PT must be repurchased to
        // complete the recombine.
        let sy_out = fixture.client.quote_yt_for_sy(&1_000);
        assert!(sy_out > 0 && sy_out < 1_000);
    }

    #[test]
    fn read_accessors_match_state_and_rate_views() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        fixture.env.ledger().set_timestamp(NOW + 60);
        fixture.client.swap_sy_for_pt(&fixture.admin, &1_000, &1);

        let state = fixture.client.state();

        assert_eq!(fixture.client.reserve_pt(), state.total_pt);
        assert_eq!(fixture.client.reserve_sy(), state.total_sy);
        assert_eq!(fixture.client.total_lp(), state.total_lp);
        assert_eq!(fixture.client.spot_apy(), fixture.client.implied_apy());
        assert!(fixture.client.twap_apy() > 0);
        assert_eq!(fixture.client.reserve_pt(), pool_pt_balance(&fixture));
        assert_eq!(fixture.client.reserve_sy(), pool_sy_balance(&fixture));
    }

    #[test]
    fn rate_views_track_warmup_and_zero_at_maturity() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        assert!(fixture.client.twap_warming_up());

        fixture.env.ledger().set_timestamp(NOW + TWAP_WINDOW);
        assert!(!fixture.client.twap_warming_up());

        fixture.env.ledger().set_timestamp(MATURITY);
        assert_eq!(fixture.client.implied_apy(), 0);
        assert_eq!(fixture.client.spot_apy(), 0);
        assert_eq!(fixture.client.twap_apy(), 0);
        assert!(!fixture.client.twap_warming_up());
    }

    /// After an idle gap of a full TWAP window, the next swap's observation
    /// fully replaces the TWAP (there is no history worth blending). One trade
    /// deciding the oracle value is the manipulation window the TWAP exists to
    /// close, so that snap must re-enter warm-up: consumers gating on
    /// twap_warming_up ignore the value until a fresh window has passed.
    #[test]
    fn twap_re_enters_warmup_after_an_idle_gap_snaps_it() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        // Trade while warm so the TWAP has a real blended history, then let
        // the initial warm-up lapse.
        fixture.env.ledger().set_timestamp(NOW + 60);
        fixture.client.swap_sy_for_pt(&fixture.admin, &1_000, &1);
        fixture.env.ledger().set_timestamp(NOW + TWAP_WINDOW + 61);
        assert!(
            !fixture.client.twap_warming_up(),
            "warmed up after a window"
        );

        // Idle for well over a full window, then a single swap lands: the
        // observation snaps the TWAP, so the market must declare itself
        // warming up again for a full window from that swap.
        let after_gap = NOW + TWAP_WINDOW + 61 + 3 * TWAP_WINDOW;
        fixture.env.ledger().set_timestamp(after_gap);
        fixture.client.swap_sy_for_pt(&fixture.admin, &1_000, &1);
        assert!(
            fixture.client.twap_warming_up(),
            "a full-window idle snap must re-enter warm-up"
        );

        fixture.env.ledger().set_timestamp(after_gap + TWAP_WINDOW);
        assert!(
            !fixture.client.twap_warming_up(),
            "trust returns after a fresh window"
        );
    }

    #[test]
    fn quote_accessors_match_pt_route_execution_without_mutating_state() {
        let first_fixture = fixture(NOW);
        initialize(&first_fixture);
        first_fixture
            .client
            .add_liquidity(&first_fixture.admin, &20_000, &20_000, &0);

        let before = first_fixture.client.state();
        let quoted_sy_out = first_fixture.client.quote_pt_for_sy(&1_000);
        let quoted_pt_out = first_fixture.client.quote_sy_for_pt(&1_000);
        let after_quote = first_fixture.client.state();

        assert_eq!(before, after_quote);
        assert_eq!(
            quoted_sy_out,
            first_fixture
                .client
                .swap_pt_for_sy(&first_fixture.admin, &1_000, &1)
        );

        let second_fixture = fixture(NOW);
        initialize(&second_fixture);
        second_fixture
            .client
            .add_liquidity(&second_fixture.admin, &20_000, &20_000, &0);
        assert_eq!(
            quoted_pt_out,
            second_fixture
                .client
                .swap_sy_for_pt(&second_fixture.admin, &1_000, &1)
        );
    }

    #[test]
    fn quote_yt_accessors_do_not_mutate_state() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        let before = fixture.client.state();
        assert!(fixture.client.quote_sy_for_yt(&1_000) > 0);
        assert!(fixture.client.quote_yt_for_sy(&1_000) > 0);
        let after_quote = fixture.client.state();

        assert_eq!(before, after_quote);
    }

    #[test]
    fn quote_accessors_return_typed_errors_before_trade_execution() {
        let fixture = fixture(NOW);
        initialize(&fixture);

        assert_eq!(
            fixture
                .env
                .as_contract(&fixture.contract_id, || AmmMarket::quote_pt_for_sy(
                    fixture.env.clone(),
                    0
                )),
            Err(Error::InvalidAmount)
        );
        assert_eq!(
            fixture
                .env
                .as_contract(&fixture.contract_id, || AmmMarket::quote_sy_for_pt(
                    fixture.env.clone(),
                    0
                )),
            Err(Error::InvalidAmount)
        );
        assert_eq!(
            fixture.env.as_contract(&fixture.contract_id, || {
                AmmMarket::quote_sy_for_yt(fixture.env.clone(), 1_000)
            }),
            Err(Error::MarketNotSeeded)
        );
        assert_eq!(
            fixture.env.as_contract(&fixture.contract_id, || {
                AmmMarket::quote_yt_for_sy(fixture.env.clone(), 1_000)
            }),
            Err(Error::MarketNotSeeded)
        );
    }

    #[test]
    fn quote_accessors_reject_matured_market() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        fixture.env.ledger().set_timestamp(MATURITY);

        assert_eq!(
            fixture.env.as_contract(&fixture.contract_id, || {
                AmmMarket::quote_pt_for_sy(fixture.env.clone(), 1_000)
            }),
            Err(Error::MarketMatured)
        );
        assert_eq!(
            fixture.env.as_contract(&fixture.contract_id, || {
                AmmMarket::quote_sy_for_pt(fixture.env.clone(), 1_000)
            }),
            Err(Error::MarketMatured)
        );
        assert_eq!(
            fixture.env.as_contract(&fixture.contract_id, || {
                AmmMarket::quote_sy_for_yt(fixture.env.clone(), 1_000)
            }),
            Err(Error::MarketMatured)
        );
        assert_eq!(
            fixture.env.as_contract(&fixture.contract_id, || {
                AmmMarket::quote_yt_for_sy(fixture.env.clone(), 1_000)
            }),
            Err(Error::MarketMatured)
        );
    }

    #[derive(Clone, Debug)]
    enum ModelOp {
        Split(i128),
        Recombine(i128),
        BuyPt(i128),
        SellPt(i128),
    }

    #[derive(Clone, Debug)]
    struct PositionModel {
        free_sy: i128,
        free_pt: i128,
        free_yt: i128,
        escrowed_sy: i128,
        total_pt_supply: i128,
        total_yt_supply: i128,
    }

    impl PositionModel {
        fn new(free_sy: i128) -> Self {
            Self {
                free_sy,
                free_pt: 0,
                free_yt: 0,
                escrowed_sy: 0,
                total_pt_supply: 0,
                total_yt_supply: 0,
            }
        }

        fn assert_invariant(&self) {
            assert_eq!(self.escrowed_sy, self.total_pt_supply);
            assert_eq!(self.escrowed_sy, self.total_yt_supply);
            assert!(self.free_sy >= 0);
            assert!(self.free_pt >= 0);
            assert!(self.free_yt >= 0);
            assert!(self.escrowed_sy >= 0);
        }
    }

    fn arb_op() -> impl Strategy<Value = ModelOp> {
        (0u8..4, 1i128..100i128).prop_map(|(kind, amount)| match kind {
            0 => ModelOp::Split(amount),
            1 => ModelOp::Recombine(amount),
            2 => ModelOp::BuyPt(amount),
            _ => ModelOp::SellPt(amount),
        })
    }

    fn quote_sy_for_pt(fixture: &Fixture, sy_in: i128) -> Option<i128> {
        let config = fixture.client.config();
        let state = fixture.client.state();
        let comp = precompute_or_panic(&fixture.env, &config, &state);

        catch_unwind(AssertUnwindSafe(|| {
            exact_sy_in_pt_out_or_panic(&fixture.env, &config, &state, &comp, sy_in)
        }))
        .ok()
    }

    fn quote_pt_for_sy(fixture: &Fixture, pt_in: i128) -> Option<i128> {
        let config = fixture.client.config();
        let state = fixture.client.state();
        let comp = precompute_or_panic(&fixture.env, &config, &state);

        catch_unwind(AssertUnwindSafe(|| {
            exact_pt_in_sy_out_or_panic(&fixture.env, &config, &state, &comp, pt_in)
        }))
        .ok()
    }

    fn sy_in_with_rounding_gap(fixture: &Fixture) -> (i128, i128) {
        let config = fixture.client.config();
        let state = fixture.client.state();
        let comp = precompute_or_panic(&fixture.env, &config, &state);

        for sy_in in 1..5_000 {
            let Some(pt_out) = quote_sy_for_pt(fixture, sy_in) else {
                continue;
            };
            let required_sy = catch_unwind(AssertUnwindSafe(|| {
                exact_pt_out_sy_in_or_panic(&fixture.env, &config, &state, &comp, pt_out)
            }));
            let Ok(required_sy) = required_sy else {
                continue;
            };
            if required_sy < sy_in {
                return (sy_in, required_sy);
            }
        }

        panic!("expected a SY input with rounding gap");
    }

    fn lower_instance_ttl_below_threshold(fixture: &Fixture) {
        let ttl = fixture
            .env
            .deployer()
            .get_contract_instance_ttl(&fixture.contract_id);
        assert!(ttl > AMM_INSTANCE_TTL_THRESHOLD_LEDGERS);

        let target_ttl = AMM_INSTANCE_TTL_THRESHOLD_LEDGERS - 1;
        let ledgers_to_advance = ttl - target_ttl;
        fixture
            .env
            .ledger()
            .set_sequence_number(fixture.env.ledger().sequence() + ledgers_to_advance);
        assert!(
            fixture
                .env
                .deployer()
                .get_contract_instance_ttl(&fixture.contract_id)
                < AMM_INSTANCE_TTL_THRESHOLD_LEDGERS
        );
    }

    proptest! {
        #![proptest_config(ProptestConfig {
            cases: 10_000,
            .. ProptestConfig::default()
        })]

        #[test]
        fn pt_yt_sy_invariant_holds_across_random_sequences(ops in prop::collection::vec(arb_op(), 1..8)) {
            let fixture = fixture(NOW);
            initialize(&fixture);
            burn_pt(&fixture, &fixture.admin, INITIAL_TOKEN_BALANCE);
            burn_sy(&fixture, &fixture.admin, INITIAL_TOKEN_BALANCE);
            mint_pt(&fixture, &fixture.admin, 2_000_000);
            mint_sy(&fixture, &fixture.admin, 2_000_000);
            fixture.client.add_liquidity(&fixture.admin, &1_000_000, &1_000_000, &0);

            let mut model = PositionModel::new(1_000_000);
            let mut wallet_pt = 1_000_000;
            let mut wallet_sy = 1_000_000;

            for op in ops {
                match op {
                    ModelOp::Split(amount) if model.free_sy >= amount => {
                        let (pt_out, yt_out) = (amount, amount);
                        model.free_sy -= amount;
                        model.free_pt += pt_out;
                        model.free_yt += yt_out;
                        model.escrowed_sy += amount;
                        model.total_pt_supply += pt_out;
                        model.total_yt_supply += yt_out;
                    }
                    ModelOp::Recombine(amount)
                        if model.free_pt >= amount
                            && model.free_yt >= amount
                            && model.escrowed_sy >= amount =>
                    {
                        model.free_pt -= amount;
                        model.free_yt -= amount;
                        model.free_sy += amount;
                        model.escrowed_sy -= amount;
                        model.total_pt_supply -= amount;
                        model.total_yt_supply -= amount;
                    }
                    ModelOp::BuyPt(amount)
                        if wallet_sy >= amount
                            && model.free_sy >= amount
                            && quote_sy_for_pt(&fixture, amount).is_some() =>
                    {
                        let pt_out = fixture.client.swap_sy_for_pt(&fixture.admin, &amount, &1);
                        wallet_sy -= amount;
                        wallet_pt += pt_out;
                        model.free_sy -= amount;
                        model.free_pt += pt_out;
                    }
                    ModelOp::SellPt(amount)
                        if wallet_pt >= amount
                            && model.free_pt >= amount
                            && quote_pt_for_sy(&fixture, amount).is_some() =>
                    {
                        let sy_out = fixture.client.swap_pt_for_sy(&fixture.admin, &amount, &1);
                        wallet_pt -= amount;
                        wallet_sy += sy_out;
                        model.free_pt -= amount;
                        model.free_sy += sy_out;
                    }
                    _ => {}
                }

                model.assert_invariant();
            }

            assert_eq!(pt_balance(&fixture, &fixture.admin), wallet_pt);
            assert_eq!(sy_balance(&fixture, &fixture.admin), wallet_sy);
            assert_eq!(pool_pt_balance(&fixture), fixture.client.reserve_pt());
            assert_eq!(pool_sy_balance(&fixture), fixture.client.reserve_sy());
        }
    }
}
