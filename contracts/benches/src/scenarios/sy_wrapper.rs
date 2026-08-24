// SPDX-License-Identifier: Apache-2.0

use super::common::{deploy, measure};
use crate::report::ScenarioResult;
use novaire_sy_wrapper::SyWrapperClient;
use soroban_sdk::Env;

pub fn run() -> Vec<ScenarioResult> {
    vec![deposit(), redeem(), transfer(), exchange_rate()]
}

fn scenario(name: &str, cpu: u64, mem: u64) -> ScenarioResult {
    ScenarioResult {
        contract: "sy-wrapper".into(),
        name: name.into(),
        cpu_instructions: cpu,
        mem_bytes: mem,
    }
}

fn deposit() -> ScenarioResult {
    let env = Env::default();
    let m = deploy(&env);
    let sy = SyWrapperClient::new(&env, &m.sy);
    let (cpu, mem) = measure(&env, || {
        sy.deposit(&m.user, &1_000_000_000_i128);
    });
    scenario("deposit", cpu, mem)
}

fn redeem() -> ScenarioResult {
    let env = Env::default();
    let m = deploy(&env);
    let sy = SyWrapperClient::new(&env, &m.sy);
    let shares = sy.deposit(&m.user, &1_000_000_000_i128);
    let (cpu, mem) = measure(&env, || {
        sy.redeem(&m.user, &shares);
    });
    scenario("redeem", cpu, mem)
}

fn transfer() -> ScenarioResult {
    let env = Env::default();
    let m = deploy(&env);
    let sy = SyWrapperClient::new(&env, &m.sy);
    sy.deposit(&m.user, &1_000_000_000_i128);
    let (cpu, mem) = measure(&env, || {
        sy.transfer(&m.user, &m.admin, &1_000_i128);
    });
    scenario("transfer", cpu, mem)
}

fn exchange_rate() -> ScenarioResult {
    let env = Env::default();
    let m = deploy(&env);
    let sy = SyWrapperClient::new(&env, &m.sy);
    sy.deposit(&m.user, &1_000_000_000_i128);
    let (cpu, mem) = measure(&env, || {
        sy.exchange_rate();
    });
    scenario("exchange_rate", cpu, mem)
}
