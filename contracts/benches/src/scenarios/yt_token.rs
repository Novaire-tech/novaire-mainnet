// SPDX-License-Identifier: Apache-2.0

use super::common::{deploy, measure, WAD};
use crate::report::ScenarioResult;
use novaire_sy_wrapper::SyWrapperClient;
use novaire_tokenizer::TokenizerClient;
use novaire_yt_token::YtTokenClient;
use soroban_sdk::Env;

pub fn run() -> Vec<ScenarioResult> {
    vec![mint(), transfer(), burn(), settle()]
}

fn scenario(name: &str, cpu: u64, mem: u64) -> ScenarioResult {
    ScenarioResult {
        contract: "yt-token".into(),
        name: name.into(),
        cpu_instructions: cpu,
        mem_bytes: mem,
    }
}

fn mint() -> ScenarioResult {
    let env = Env::default();
    let m = deploy(&env);
    let yt = YtTokenClient::new(&env, &m.yt);
    let (cpu, mem) = measure(&env, || {
        yt.mint(&m.user, &1_000_000_i128);
    });
    scenario("mint", cpu, mem)
}

fn transfer() -> ScenarioResult {
    let env = Env::default();
    let m = deploy(&env);
    let sy = SyWrapperClient::new(&env, &m.sy);
    let tokenizer = TokenizerClient::new(&env, &m.tokenizer);
    let yt = YtTokenClient::new(&env, &m.yt);
    let shares = sy.deposit(&m.user, &1_000_000_000_i128);
    tokenizer.split(&m.user, &shares);
    let (cpu, mem) = measure(&env, || {
        yt.transfer(&m.user, &m.admin, &1_000_i128);
    });
    scenario("transfer", cpu, mem)
}

fn burn() -> ScenarioResult {
    let env = Env::default();
    let m = deploy(&env);
    let sy = SyWrapperClient::new(&env, &m.sy);
    let tokenizer = TokenizerClient::new(&env, &m.tokenizer);
    let yt = YtTokenClient::new(&env, &m.yt);
    let shares = sy.deposit(&m.user, &1_000_000_000_i128);
    tokenizer.split(&m.user, &shares);
    let (cpu, mem) = measure(&env, || {
        yt.burn(&m.user, &1_000_i128);
    });
    scenario("burn", cpu, mem)
}

fn settle() -> ScenarioResult {
    let env = Env::default();
    let m = deploy(&env);
    let sy = SyWrapperClient::new(&env, &m.sy);
    let tokenizer = TokenizerClient::new(&env, &m.tokenizer);
    let yt = YtTokenClient::new(&env, &m.yt);
    let shares = sy.deposit(&m.user, &1_000_000_000_i128);
    tokenizer.split(&m.user, &shares);
    let (cpu, mem) = measure(&env, || {
        yt.settle(&m.user, &WAD);
    });
    scenario("settle", cpu, mem)
}
