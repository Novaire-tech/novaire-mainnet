// SPDX-License-Identifier: Apache-2.0

use super::common::{deploy, measure, Market};
use crate::report::ScenarioResult;
use novaire_amm::AmmMarketClient;
use novaire_sy_wrapper::SyWrapperClient;
use novaire_tokenizer::TokenizerClient;
use soroban_sdk::Env;

pub fn run() -> Vec<ScenarioResult> {
    vec![
        add_liquidity(),
        remove_liquidity(),
        swap_sy_for_pt(),
        swap_pt_for_sy(),
        swap_sy_for_yt(),
        swap_yt_for_sy(),
    ]
}

fn scenario(name: &str, cpu: u64, mem: u64) -> ScenarioResult {
    ScenarioResult {
        contract: "amm".into(),
        name: name.into(),
        cpu_instructions: cpu,
        mem_bytes: mem,
    }
}

/// Deposits SY, splits it into PT/YT, and returns the market with the user
/// holding enough PT + SY to seed liquidity.
fn seed_split(env: &Env) -> Market {
    let m = deploy(env);
    let sy = SyWrapperClient::new(env, &m.sy);
    let tokenizer = TokenizerClient::new(env, &m.tokenizer);
    sy.deposit(&m.user, &2_000_000_000_i128);
    tokenizer.split(&m.user, &1_000_000_000_i128);
    m
}

fn add_liquidity() -> ScenarioResult {
    let env = Env::default();
    let m = seed_split(&env);
    let amm = AmmMarketClient::new(&env, &m.amm);
    let (cpu, mem) = measure(&env, || {
        amm.add_liquidity(&m.user, &800_000_000_i128, &800_000_000_i128, &0);
    });
    scenario("add_liquidity", cpu, mem)
}

fn remove_liquidity() -> ScenarioResult {
    let env = Env::default();
    let m = seed_split(&env);
    let amm = AmmMarketClient::new(&env, &m.amm);
    let lp = amm.add_liquidity(&m.user, &800_000_000_i128, &800_000_000_i128, &0);
    let (cpu, mem) = measure(&env, || {
        amm.remove_liquidity(&m.user, &lp, &0, &0);
    });
    scenario("remove_liquidity", cpu, mem)
}

fn swap_sy_for_pt() -> ScenarioResult {
    let env = Env::default();
    let m = seed_split(&env);
    let amm = AmmMarketClient::new(&env, &m.amm);
    amm.add_liquidity(&m.user, &800_000_000_i128, &800_000_000_i128, &0);
    let (cpu, mem) = measure(&env, || {
        amm.swap_sy_for_pt(&m.user, &1_000_000_i128, &0);
    });
    scenario("swap_sy_for_pt", cpu, mem)
}

fn swap_pt_for_sy() -> ScenarioResult {
    let env = Env::default();
    let m = seed_split(&env);
    let amm = AmmMarketClient::new(&env, &m.amm);
    amm.add_liquidity(&m.user, &800_000_000_i128, &800_000_000_i128, &0);
    let pt_out = amm.swap_sy_for_pt(&m.user, &1_000_000_i128, &0);
    let (cpu, mem) = measure(&env, || {
        amm.swap_pt_for_sy(&m.user, &pt_out, &0);
    });
    scenario("swap_pt_for_sy", cpu, mem)
}

fn swap_sy_for_yt() -> ScenarioResult {
    let env = Env::default();
    let m = seed_split(&env);
    let amm = AmmMarketClient::new(&env, &m.amm);
    amm.add_liquidity(&m.user, &800_000_000_i128, &800_000_000_i128, &0);
    let (cpu, mem) = measure(&env, || {
        amm.swap_sy_for_yt(&m.user, &1_000_000_i128, &1);
    });
    scenario("swap_sy_for_yt", cpu, mem)
}

fn swap_yt_for_sy() -> ScenarioResult {
    let env = Env::default();
    let m = seed_split(&env);
    let amm = AmmMarketClient::new(&env, &m.amm);
    amm.add_liquidity(&m.user, &800_000_000_i128, &800_000_000_i128, &0);
    let yt_out = amm.swap_sy_for_yt(&m.user, &1_000_000_i128, &1);
    let (cpu, mem) = measure(&env, || {
        amm.swap_yt_for_sy(&m.user, &yt_out, &1);
    });
    scenario("swap_yt_for_sy", cpu, mem)
}
