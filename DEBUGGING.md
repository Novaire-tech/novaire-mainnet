# Debugging Soroban VM resource-budget failures

This document explains the diagnostic instrumentation added to reproduce and
capture evidence for VM-trap failures such as `Memory(OutOfBoundsGrowth)`,
`CpuLimitExceeded`, `BudgetExceeded`, `HostError`, and `ContractError`.

Status as of this writing: **no reproducible budget failure (CPU/memory
limit) currently exists** in the harnesses below at the scales tested. The
instrumentation exists so the *next* occurrence — in a stress test, a
testnet transaction, or production — leaves behind a complete bundle instead
of a bare panic message.

## Entry points

Every externally callable function that can initiate protocol execution,
with its immediate downstream contracts:

| Contract | Function | Downstream calls |
|---|---|---|
| `vault` | `deposit`, `withdraw` | `underlying_token` (SAC) |
| `tokenizer` | `mint_pt_yt` | `sy_wrapper`, `pt_token`, `yt_token` |
| `tokenizer` | `claim_yield` | `yt_token` (`checkpoint_user`, `claimable_yield`, `get_yield_index`) |
| `tokenizer` | `settle_epoch` | `vault`, `yt_token` |
| `tokenizer` | `redeem_pt` | `pt_token`, `vault` |
| `marketplace` | `add_liquidity`, `remove_liquidity`, `swap_underlying_for_pt`, `swap_pt_for_underlying` | `pt_token`, `underlying_token` |
| `intent_engine` | `execute_fixed_yield_intent` (and related) | `tokenizer`, `marketplace` |
| `rollover` | rollover execution | `tokenizer`, `maturity_engine`, `marketplace` |
| `maturity_engine` | maturity settlement | `tokenizer`, `vault` |
| `yt_token` | `transfer`, `transfer_from` | `tokenizer` (`try_record_surplus_baseline_pub`, re-entrant call back into `tokenizer` guarded by Soroban's reentrancy check) |

## Instrumentation

`contracts/integration_tests/src/budget_debug.rs` adds (test-only, behind
`#![cfg(test)]`, zero effect on contract WASM):

- `budget_report(env) -> String` — CPU instructions consumed, memory bytes
  consumed, and a per-`ContractCostType` breakdown (iterations, inputs,
  cpu, mem) via `env.cost_estimate().budget()`.
- `dump_budget(env, label)` — prints the above to stdout at a labeled point
  (visible with `--nocapture`), for spotting where usage jumps between
  points in a flow ("the first budget spike").
- `events_report(env) -> String` — every contract/diagnostic event emitted
  so far, in order, via `env.events().all()`.
  - **Known limitation**: `soroban-sdk` testutils only returns events from
    frames that committed successfully. When a call panics mid-frame (as
    `HostError`/`ContractError` do), `env.events().all()` at that point is
    often empty — the panic message printed to stderr (captured in
    `panic.txt`) is the authoritative diagnostic event log for that case,
    not `events.txt`.
- `write_failure_bundle(env, label, context, panic_msg)` — writes
  `artifacts/debug/<label>-<unix_ms>/{budget.txt,events.txt,context.txt,panic.txt}`.
- `run_and_capture(env, label, context, flow)` — runs `flow`, and on panic
  writes the failure bundle above before re-raising the panic (so the test
  still fails normally).

## Reproduction harness

`contracts/integration_tests/src/reproduce.rs`:

```
cargo test -p integration_tests reproduce_budget -- --nocapture
```

- `reproduce_budget_mint_pt_yt` — 500 sequential `mint_pt_yt` calls against
  growing user/position state, dumping the budget every 50 calls.
- `reproduce_budget_full_lifecycle` — 20 epochs × 20 positions of
  deposit → mint → claim_yield → settle_epoch, dumping the budget after
  each epoch settle.

Both wrap every panicking call (`Protocol::mint_pt_yt`, `claim_yield`,
`settle_epoch` — the non-`try_` variants, which panic on `HostError`/
`ContractError` instead of swallowing the `Result`) in `run_and_capture`,
so any trap during the run produces a bundle in `artifacts/debug/`
immediately, and the harness stops at that point (the panic propagates and
fails the test).

To add a new flow, follow the same pattern: call the panicking (non-`try_`)
client method, wrapped in `run_and_capture(&p.env, "<label>", "<context
string with the exact args/state>", || ...)`.

## Reading a failure bundle

`artifacts/debug/<label>-<timestamp>/`:

- `context.txt` — the exact call and inputs that were running (iteration
  index, user, amounts, ledger number).
- `panic.txt` — the panic payload. For Soroban host traps this includes the
  host error code and (when available) the diagnostic event log in
  newest-first order — read this top to bottom for the call chain: each
  `[fn_call, ...]` / `[fn_return, ...]` pair is one contract invocation,
  and the invocation tree can be reconstructed from the `contract:` field
  on each line plus call nesting.
- `budget.txt` — CPU/memory totals and per-cost-type trackers *as of the
  panic point* (not necessarily where the trap itself occurred, since
  budget metering happens inside the host and the tracker reflects
  cumulative usage across the whole `Env`, not just the failing call).
- `events.txt` — usually empty on panic (see limitation above); non-empty
  when the failure is a plain Rust assertion/panic outside the host VM.

## Reproducing against a real (testnet/mainnet) failing transaction

The harness above only reproduces failures reachable by driving the
in-process `soroban-sdk` test `Env`. If a real transaction fails on
testnet/mainnet:

1. Get the transaction hash and simulate it:
   `stellar tx simulate <hash> --network testnet` (or via `scripts/verify-testnet.ts`'s
   RPC client) to capture `simulation result`, `authorization entries`, and
   `resource usage` directly from RPC — this is real evidence and doesn't
   require this harness.
2. Reproduce the same state locally: seed a `Protocol` in
   `reproduce.rs` with the same balances/positions/epoch as the failing
   account (query current on-chain storage via RPC, or restore from a
   snapshot if available), then call the same entry point through
   `run_and_capture`.
3. Compare the resulting `budget.txt`/`panic.txt` against the RPC
   simulation's reported resource usage — if the local run's cost profile
   diverges significantly, the discrepancy itself is a lead (e.g. the SDK's
   own docs note native Rust test execution underestimates CPU/VM costs
   relative to compiled WASM, so a local near-limit reading is not
   conclusive on its own — cross-check against `stellar contract invoke
   --send=no` against the built `.wasm`, which runs the real WASM VM path).

Do not report a root cause from a local run alone unless the local
`budget.txt`/`panic.txt` matches the real transaction's RPC-reported error
class and resource profile.
