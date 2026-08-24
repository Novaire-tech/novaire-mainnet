// SPDX-License-Identifier: Apache-2.0

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioResult {
    pub contract: String,
    pub name: String,
    pub cpu_instructions: u64,
    pub mem_bytes: u64,
}

pub fn print_table(results: &[ScenarioResult]) {
    println!(
        "{:<14} {:<32} {:>16} {:>14}",
        "contract", "entrypoint", "cpu_instructions", "mem_bytes"
    );
    for r in results {
        println!(
            "{:<14} {:<32} {:>16} {:>14}",
            r.contract, r.name, r.cpu_instructions, r.mem_bytes
        );
    }
}

pub fn write_json(results: &[ScenarioResult], path: &std::path::Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(results)?;
    std::fs::write(path, json)
}

pub fn load_json(path: &std::path::Path) -> std::io::Result<Vec<ScenarioResult>> {
    let data = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&data)?)
}

/// Compares `latest` against `baseline`, returning `Err` scenario keys whose
/// cpu or mem cost regressed by more than `threshold_pct` percent. Scenarios
/// present only in one set are ignored (added/removed entrypoints aren't a
/// regression by themselves).
pub fn check_regressions(
    baseline: &[ScenarioResult],
    latest: &[ScenarioResult],
    threshold_pct: f64,
) -> Vec<String> {
    let base_by_key: BTreeMap<String, &ScenarioResult> = baseline
        .iter()
        .map(|r| (format!("{}::{}", r.contract, r.name), r))
        .collect();

    let mut failures = Vec::new();
    for r in latest {
        let key = format!("{}::{}", r.contract, r.name);
        let Some(base) = base_by_key.get(&key) else {
            continue;
        };
        let cpu_growth = growth_pct(base.cpu_instructions, r.cpu_instructions);
        let mem_growth = growth_pct(base.mem_bytes, r.mem_bytes);
        if cpu_growth > threshold_pct {
            failures.push(format!(
                "{key}: cpu_instructions grew {cpu_growth:.1}% ({} -> {})",
                base.cpu_instructions, r.cpu_instructions
            ));
        }
        if mem_growth > threshold_pct {
            failures.push(format!(
                "{key}: mem_bytes grew {mem_growth:.1}% ({} -> {})",
                base.mem_bytes, r.mem_bytes
            ));
        }
    }
    failures
}

fn growth_pct(base: u64, latest: u64) -> f64 {
    if base == 0 {
        return if latest == 0 { 0.0 } else { 100.0 };
    }
    (latest as f64 - base as f64) / base as f64 * 100.0
}
