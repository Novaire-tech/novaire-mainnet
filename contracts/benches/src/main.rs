// SPDX-License-Identifier: Apache-2.0

//! Contract cost benchmarks: runs the protocol's key entrypoints in a
//! Soroban test `Env` and reports CPU-instruction and memory cost per call,
//! as measured by `Env::budget()`. Not a wall-clock benchmark — Soroban's
//! deterministic resource metering is the number that actually determines
//! transaction fees and resource limits on-chain, so it's what's worth
//! tracking for regressions.
//!
//! Usage:
//!   cargo run -p novaire-benches --release -- [--out PATH] [--check BASELINE] [--threshold PCT] [--update-baseline]

mod report;
mod scenarios;

use report::ScenarioResult;
use std::path::PathBuf;

struct Args {
    out: PathBuf,
    check: Option<PathBuf>,
    threshold_pct: f64,
    update_baseline: Option<PathBuf>,
}

fn parse_args() -> Args {
    let mut out = PathBuf::from("../../benchmarks/results/contracts-latest.json");
    let mut check = None;
    let mut threshold_pct = 10.0;
    let mut update_baseline = None;

    let mut iter = std::env::args().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--out" => out = PathBuf::from(iter.next().expect("--out needs a path")),
            "--check" => check = Some(PathBuf::from(iter.next().expect("--check needs a path"))),
            "--threshold" => {
                threshold_pct = iter
                    .next()
                    .expect("--threshold needs a percent value")
                    .parse()
                    .expect("--threshold must be a number");
            }
            "--update-baseline" => {
                update_baseline = Some(PathBuf::from(
                    iter.next().expect("--update-baseline needs a path"),
                ));
            }
            other => panic!("unrecognized argument: {other}"),
        }
    }

    Args {
        out,
        check,
        threshold_pct,
        update_baseline,
    }
}

fn main() {
    let args = parse_args();

    let mut results: Vec<ScenarioResult> = Vec::new();
    results.extend(scenarios::sy_wrapper::run());
    results.extend(scenarios::tokenizer::run());
    results.extend(scenarios::amm::run());
    results.extend(scenarios::pt_token::run());
    results.extend(scenarios::yt_token::run());

    report::print_table(&results);
    report::write_json(&results, &args.out).expect("failed to write benchmark report");
    println!("\nwrote {}", args.out.display());

    if let Some(baseline_path) = &args.update_baseline {
        report::write_json(&results, baseline_path).expect("failed to write baseline");
        println!("updated baseline at {}", baseline_path.display());
    }

    if let Some(baseline_path) = &args.check {
        let baseline = report::load_json(baseline_path).unwrap_or_else(|e| {
            panic!(
                "failed to read baseline at {}: {e}",
                baseline_path.display()
            )
        });
        let failures = report::check_regressions(&baseline, &results, args.threshold_pct);
        if failures.is_empty() {
            println!(
                "\nno cost regressions beyond {:.1}% vs {}",
                args.threshold_pct,
                baseline_path.display()
            );
        } else {
            eprintln!(
                "\ncost regressions beyond {:.1}% vs {}:",
                args.threshold_pct,
                baseline_path.display()
            );
            for f in &failures {
                eprintln!("  - {f}");
            }
            std::process::exit(1);
        }
    }
}
