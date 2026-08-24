// SPDX-License-Identifier: Apache-2.0

use super::common::{deploy, measure, MATURITY};
use crate::report::ScenarioResult;
use novaire_sy_wrapper::SyWrapperClient;
use novaire_tokenizer::TokenizerClient;
use soroban_sdk::{testutils::Ledger as _, Env};

pub fn run() -> Vec<ScenarioResult> {
    vec![
        split(),
        recombine(),
        redeem_at_maturity(),
        claim_yield(),
        observe_rate(),
        freeze_maturity_rate(),
    ]
}

fn scenario(name: &str, cpu: u64, mem: u64) -> ScenarioResult {
    ScenarioResult {
        contract: "tokenizer".into(),
        name: name.into(),
        cpu_instructions: cpu,
        mem_bytes: mem,
    }
}

fn split() -> ScenarioResult {
    let env = Env::default();
    let m = deploy(&env);
    let sy = SyWrapperClient::new(&env, &m.sy);
    let tokenizer = TokenizerClient::new(&env, &m.tokenizer);
    let shares = sy.deposit(&m.user, &1_000_000_000_i128);
    let (cpu, mem) = measure(&env, || {
        tokenizer.split(&m.user, &shares);
    });
    scenario("split", cpu, mem)
}

fn recombine() -> ScenarioResult {
    let env = Env::default();
    let m = deploy(&env);
    let sy = SyWrapperClient::new(&env, &m.sy);
    let tokenizer = TokenizerClient::new(&env, &m.tokenizer);
    let shares = sy.deposit(&m.user, &1_000_000_000_i128);
    let (pt, yt) = tokenizer.split(&m.user, &shares);
    let (cpu, mem) = measure(&env, || {
        tokenizer.recombine(&m.user, &pt, &yt);
    });
    scenario("recombine", cpu, mem)
}

fn redeem_at_maturity() -> ScenarioResult {
    let env = Env::default();
    let m = deploy(&env);
    let sy = SyWrapperClient::new(&env, &m.sy);
    let tokenizer = TokenizerClient::new(&env, &m.tokenizer);
    let shares = sy.deposit(&m.user, &1_000_000_000_i128);
    let (pt, _yt) = tokenizer.split(&m.user, &shares);
    env.ledger().set_timestamp(MATURITY + 1);
    let (cpu, mem) = measure(&env, || {
        tokenizer.redeem_at_maturity(&m.user, &pt);
    });
    scenario("redeem_at_maturity", cpu, mem)
}

fn claim_yield() -> ScenarioResult {
    let env = Env::default();
    let m = deploy(&env);
    let sy = SyWrapperClient::new(&env, &m.sy);
    let tokenizer = TokenizerClient::new(&env, &m.tokenizer);
    let shares = sy.deposit(&m.user, &1_000_000_000_i128);
    tokenizer.split(&m.user, &shares);
    let (cpu, mem) = measure(&env, || {
        tokenizer.claim_yield(&m.user);
    });
    scenario("claim_yield", cpu, mem)
}

fn observe_rate() -> ScenarioResult {
    let env = Env::default();
    let m = deploy(&env);
    let tokenizer = TokenizerClient::new(&env, &m.tokenizer);
    let (cpu, mem) = measure(&env, || {
        tokenizer.observe_rate();
    });
    scenario("observe_rate", cpu, mem)
}

fn freeze_maturity_rate() -> ScenarioResult {
    let env = Env::default();
    let m = deploy(&env);
    let tokenizer = TokenizerClient::new(&env, &m.tokenizer);
    env.ledger().set_timestamp(MATURITY + 1);
    let (cpu, mem) = measure(&env, || {
        tokenizer.freeze_maturity_rate();
    });
    scenario("freeze_maturity_rate", cpu, mem)
}
