// SPDX-License-Identifier: Apache-2.0

//! Shared multi-contract deployment helper, adapted from
//! `integration_tests/tests/journey.rs`'s `deploy()` so bench scenarios wire
//! up the protocol the same way the correctness tests do.

use novaire_amm::{AmmMarket, AmmMarketClient};
use novaire_blend_adapter::testutils::MockBlendPool;
use novaire_pt_token::PtToken;
use novaire_sy_wrapper::{SyWrapper, SyWrapperClient};
use novaire_tokenizer::{Tokenizer, TokenizerClient};
use novaire_yt_token::YtToken;
use soroban_sdk::{testutils::Address as _, token, Address, Env};

pub const WAD: i128 = 1_000_000_000_000_000_000;
pub const MATURITY: u64 = 1_000_000;
pub const SCALAR_ROOT: i128 = 2 * WAD;
pub const INITIAL_ANCHOR: i128 = 1_050_000_000_000_000_000;
pub const FEE_BPS: i128 = 10;
pub const TWAP_WINDOW: u64 = 1_800;

#[allow(dead_code)]
pub struct Market {
    pub admin: Address,
    pub user: Address,
    pub sy: Address,
    pub pool: Address,
    pub pt: Address,
    pub yt: Address,
    pub tokenizer: Address,
    pub amm: Address,
}

pub fn deploy(env: &Env) -> Market {
    env.mock_all_auths_allowing_non_root_auth();
    let admin = Address::generate(env);
    let user = Address::generate(env);
    let underlying = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::StellarAssetClient::new(env, &underlying).mint(&user, &2_000_000_000_000_i128);

    let sy = env.register(SyWrapper, ());
    let pt = env.register(PtToken, ());
    let yt = env.register(YtToken, ());
    let tokenizer = env.register(Tokenizer, ());
    let amm = env.register(AmmMarket, ());

    let pool = env.register(MockBlendPool, ());
    novaire_blend_adapter::testutils::MockBlendPoolClient::new(env, &pool).initialize(&underlying);
    SyWrapperClient::new(env, &sy).initialize_blend(&admin, &underlying, &pool);
    novaire_pt_token::PtTokenClient::new(env, &pt).initialize(&admin, &tokenizer, &sy, &MATURITY);
    novaire_yt_token::YtTokenClient::new(env, &yt).initialize(&admin, &tokenizer, &sy, &MATURITY);
    TokenizerClient::new(env, &tokenizer).initialize(&admin, &sy, &pt, &yt, &MATURITY);
    AmmMarketClient::new(env, &amm).initialize(
        &admin,
        &pt,
        &sy,
        &yt,
        &tokenizer,
        &MATURITY,
        &SCALAR_ROOT,
        &INITIAL_ANCHOR,
        &FEE_BPS,
        &TWAP_WINDOW,
    );

    Market {
        admin,
        user,
        sy,
        pool,
        pt,
        yt,
        tokenizer,
        amm,
    }
}

/// Runs `f`, resetting the env's budget to unlimited immediately beforehand
/// so setup cost (deploy, mint, seeding) isn't counted, then returns the
/// (cpu_instructions, mem_bytes) the call itself consumed.
pub fn measure<F: FnOnce()>(env: &Env, f: F) -> (u64, u64) {
    env.cost_estimate().budget().reset_unlimited();
    f();
    (
        env.cost_estimate().budget().cpu_instruction_cost(),
        env.cost_estimate().budget().memory_bytes_cost(),
    )
}
