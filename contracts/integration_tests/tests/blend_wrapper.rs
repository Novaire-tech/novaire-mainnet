// SPDX-License-Identifier: Apache-2.0

//! Blend-backed SY integration coverage using a Soroban pool test double.

use novaire_blend_adapter::testutils::{MockBlendPool, MockBlendPoolClient};
use novaire_blend_adapter::{assets_from_b_tokens, b_tokens_from_assets, derived_exchange_rate};
use novaire_pt_token::{PtToken, PtTokenClient};
use novaire_sy_wrapper::{Error as SyError, SyWrapper, SyWrapperClient};
use novaire_tokenizer::{Tokenizer, TokenizerClient};
use novaire_yt_token::{YtToken, YtTokenClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, vec, Address, Env,
};

const WAD: i128 = 1_000_000_000_000_000_000;
const UNIT: i128 = 10_000_000;
const MATURITY: u64 = 1_000_000;

#[test]
fn blend_supply_rate_growth_yield_claim_and_withdraw_round_trip() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1);

    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let underlying = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let pool = env.register(MockBlendPool, ());
    let sy = env.register(SyWrapper, ());
    let pt = env.register(PtToken, ());
    let yt = env.register(YtToken, ());
    let tokenizer = env.register(Tokenizer, ());

    let pool_client = MockBlendPoolClient::new(&env, &pool);
    pool_client.initialize(&underlying);
    let sy_client = SyWrapperClient::new(&env, &sy);
    sy_client.initialize_blend(&admin, &underlying, &pool);
    PtTokenClient::new(&env, &pt).initialize(&admin, &tokenizer, &sy, &MATURITY);
    YtTokenClient::new(&env, &yt).initialize(&admin, &tokenizer, &sy, &MATURITY);
    let tokenizer_client = TokenizerClient::new(&env, &tokenizer);
    tokenizer_client.initialize(&admin, &sy, &pt, &yt, &MATURITY);

    token::StellarAssetClient::new(&env, &underlying).mint(&alice, &(100 * UNIT));
    let initial_b_rate = 1_055_791_870_000;
    pool_client.set_b_rate(&initial_b_rate);
    let expected_b_tokens = b_tokens_from_assets(100 * UNIT, initial_b_rate).unwrap();
    let expected_shares = assets_from_b_tokens(expected_b_tokens, initial_b_rate).unwrap();
    assert!(
        expected_shares < 100 * UNIT,
        "Blend rounding must be exercised"
    );
    assert_eq!(sy_client.deposit(&alice, &(100 * UNIT)), expected_shares);
    assert_eq!(sy_client.exchange_rate(), WAD);
    assert_eq!(
        token::TokenClient::new(&env, &underlying).balance(&pool),
        100 * UNIT
    );
    assert_eq!(
        pool_client.get_positions(&sy).supply.get(0),
        Some(expected_b_tokens)
    );

    tokenizer_client.split(&alice, &expected_shares);
    pool_client.set_b_rate(&1_100_000_000_000);
    token::StellarAssetClient::new(&env, &underlying).mint(&pool, &(10 * UNIT));
    let expected_rate = derived_exchange_rate(
        assets_from_b_tokens(expected_b_tokens, 1_100_000_000_000).unwrap(),
        expected_shares,
    )
    .unwrap();
    assert!(expected_rate > WAD);
    assert_eq!(sy_client.exchange_rate(), expected_rate);
    // The legacy admin rate setter no longer exists on `SyWrapperClient` at
    // all: `exchange_rate()` derives solely from the Blend pool now.

    let claimed = tokenizer_client.claim_yield(&alice);
    assert!(claimed > 0);
    let principal = tokenizer_client.recombine(&alice, &expected_shares, &expected_shares);
    assert!(principal > 0);
    let sy_to_redeem = sy_client.balance(&alice);
    assert_eq!(sy_to_redeem, claimed + principal);

    let redeemed = sy_client.redeem(&alice, &sy_to_redeem);
    assert!(redeemed > 100 * UNIT);
    assert_eq!(token::TokenClient::new(&env, &underlying).balance(&sy), 0);
    assert!(pool_client.get_positions(&sy).supply.get(0).unwrap_or(0) < expected_b_tokens);
}

/// If the pool is reconfigured so the underlying no longer sits at the reserve
/// index recorded at init, the wrapper must refuse to value the position
/// (InvalidBlendReserve, #10) rather than silently price the wrong reserve.
#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn exchange_rate_traps_when_the_reserve_index_moves() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1);

    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let underlying = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let pool = env.register(MockBlendPool, ());
    let sy = env.register(SyWrapper, ());

    let pool_client = MockBlendPoolClient::new(&env, &pool);
    pool_client.initialize(&underlying);
    let sy_client = SyWrapperClient::new(&env, &sy);
    sy_client.initialize_blend(&admin, &underlying, &pool);

    token::StellarAssetClient::new(&env, &underlying).mint(&alice, &(100 * UNIT));
    sy_client.deposit(&alice, &(100 * UNIT));
    assert_eq!(sy_client.exchange_rate(), WAD);

    pool_client.set_reserve_index(&1);
    sy_client.exchange_rate();
}

/// A Blend-backed wrapper with a single depositor, ready for reindex/failure
/// scenarios. Returns the env plus the clients and actors the tests need.
struct BlendFixture {
    env: Env,
    pool_client: MockBlendPoolClient<'static>,
    sy_client: SyWrapperClient<'static>,
    admin: Address,
    alice: Address,
    underlying: Address,
}

fn blend_fixture() -> BlendFixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1);

    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let underlying = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let pool = env.register(MockBlendPool, ());
    let sy = env.register(SyWrapper, ());

    let pool_client = MockBlendPoolClient::new(&env, &pool);
    pool_client.initialize(&underlying);
    let sy_client = SyWrapperClient::new(&env, &sy);
    sy_client.initialize_blend(&admin, &underlying, &pool);

    token::StellarAssetClient::new(&env, &underlying).mint(&alice, &(100 * UNIT));
    sy_client.deposit(&alice, &(100 * UNIT));
    assert_eq!(sy_client.exchange_rate(), WAD);

    BlendFixture {
        env,
        pool_client,
        sy_client,
        admin,
        alice,
        underlying,
    }
}

/// After a Blend reindex trips the fail-closed guard, an admin migration
/// re-syncs the stored reserve index and rate reads recover.
#[test]
fn migrate_reserve_index_recovers_after_a_reindex() {
    let f = blend_fixture();

    // The pool moves the underlying from slot 0 to slot 1. The rate path now
    // traps because the stored index no longer matches the pool's.
    let other = Address::generate(&f.env);
    f.pool_client
        .set_reserve_list(&vec![&f.env, other, f.underlying.clone()]);
    f.pool_client.set_reserve_index(&1);
    assert_eq!(
        f.sy_client.try_exchange_rate(),
        Err(Ok(SyError::InvalidBlendReserve.into()))
    );

    // Admin migrates; the wrapper re-derives index 1 from the pool.
    assert_eq!(f.sy_client.migrate_reserve_index(&f.admin), 1);
    assert_eq!(f.sy_client.config().reserve_index, 1);

    // Rate reads (and therefore every deposit/redeem path) work again.
    assert_eq!(f.sy_client.exchange_rate(), WAD);
}

/// The migration is admin-gated: a non-admin caller is rejected without
/// touching the stored index.
#[test]
fn migrate_reserve_index_rejects_non_admin() {
    let f = blend_fixture();

    let other = Address::generate(&f.env);
    f.pool_client
        .set_reserve_list(&vec![&f.env, other, f.underlying.clone()]);
    f.pool_client.set_reserve_index(&1);

    assert!(matches!(
        f.sy_client.try_migrate_reserve_index(&f.alice),
        Err(Ok(SyError::NotAuthorized))
    ));
    // Still bricked: the rejected call left the stored index untouched.
    assert_eq!(f.sy_client.config().reserve_index, 0);
}

/// The migration only accepts an index whose asset is `config.underlying`. If
/// the pool's list no longer contains the underlying, the migration is refused
/// rather than pointing the rate at some other asset.
#[test]
fn migrate_reserve_index_rejects_when_underlying_absent() {
    let f = blend_fixture();

    let other = Address::generate(&f.env);
    f.pool_client.set_reserve_list(&vec![&f.env, other]);

    assert!(matches!(
        f.sy_client.try_migrate_reserve_index(&f.admin),
        Err(Ok(SyError::InvalidBlendReserve))
    ));
    assert_eq!(f.sy_client.config().reserve_index, 0);
}

/// The list position and the pool's authoritative `get_reserve` index must
/// agree. If the list claims the underlying sits at a slot the reserve record
/// disagrees with, the migration is refused (the asset-match cross-check).
#[test]
fn migrate_reserve_index_rejects_on_index_mismatch() {
    let f = blend_fixture();

    // List places the underlying at slot 1, but the reserve record still
    // reports index 0. The cross-check must reject the migration.
    let other = Address::generate(&f.env);
    f.pool_client
        .set_reserve_list(&vec![&f.env, other, f.underlying.clone()]);
    // reserve_index left at 0.

    assert!(matches!(
        f.sy_client.try_migrate_reserve_index(&f.admin),
        Err(Ok(SyError::InvalidBlendReserve))
    ));
    assert_eq!(f.sy_client.config().reserve_index, 0);
}

/// A tolerated Blend withdrawal failure must surface as an explicit typed error
/// (BlendWithdrawalFailed, #11), not a silent zero, and must leave the holder's
/// shares untouched so the failed redeem can be retried.
#[test]
fn redeem_surfaces_tolerated_withdrawal_failure() {
    let f = blend_fixture();

    let shares_before = f.sy_client.balance(&f.alice);
    let supply_before = f.sy_client.total_supply();
    assert!(shares_before > 0);

    f.pool_client.set_should_fail_withdraw(&true);

    // `redeem` returns a bare i128, so its `try_` variant surfaces the trap as
    // a raw soroban error carrying the contract error code, not the typed enum.
    assert_eq!(
        f.sy_client.try_redeem(&f.alice, &(40 * UNIT)),
        Err(Ok(SyError::BlendWithdrawalFailed.into()))
    );

    // The failed withdraw burned nothing: funds are intact, not bricked.
    assert_eq!(f.sy_client.balance(&f.alice), shares_before);
    assert_eq!(f.sy_client.total_supply(), supply_before);

    // Once Blend recovers, the same redeem succeeds.
    f.pool_client.set_should_fail_withdraw(&false);
    assert!(f.sy_client.redeem(&f.alice, &(40 * UNIT)) > 0);
}
