# Novaire Protocol — Security Audit

> **SUPERSEDED — applies to the pre-2026-08-13 architecture.**
>
> This audit report covers the **10-contract architecture** (factory, vault, marketplace, maturity_engine, rollover, intent_engine, tokenizer, pt_token, yt_token, sy_wrapper) that was replaced in the migration of **2026-08-13** (commit `7a2f6bbf`). The current **6-contract architecture** has not been independently audited.
>
> This document is retained for historical/audit purposes only. Do not use it to assess the current system's security.
>
> ---

**Scope:** `contracts/{factory, intent_engine, marketplace, maturity_engine, rollover, sy_wrapper, vault, tokenizer/{tokenizer,pt_token,yt_token}}` (Soroban/Rust, Stellar). Workspace root: `contracts/Cargo.toml`.
**Method:** Full read of every contract's `src/lib.rs` (10 contracts, ~9,760 lines total), test suites, `test_snapshots/`, `Cargo.toml` dependency manifests, and existing `docs/PROTOCOL_INVARIANTS.md`.
**Date:** 2026-08-07
**Auditor note:** No Critical or High severity issues were found. All findings below are cited to exact file:line with verified code. This is not a warranty of correctness — it is a point-in-time review of the code that exists in the repo today.

---

## 1. Executive Summary

Novaire is a Pendle-style yield-tokenization protocol on Soroban: users deposit an underlying asset into a `vault`, which is backed 1:1 by `sy_wrapper` shares lent into an external Blend Capital pool; `sy_wrapper` shares are tokenized 1:1 into Principal Tokens (PT) and Yield Tokens (YT) by `tokenizer`; PT/underlying trade on a YieldSpace-style time-decaying AMM in `marketplace`, which also derives a YT price via bisection against the same curve; `maturity_engine` is the single source of truth for epoch lifecycle (Active → Matured → Settled → Archived); `rollover` automates moving matured PT principal into the next epoch's fixed-yield position; `intent_engine` is an atomic multi-hop router so users never custody intermediate PT/YT/SY state; `factory` deploys and wires a full epoch's contract set.

The codebase shows evidence of prior hardening: `overflow-checks = true` is set in the release profile, arithmetic is overwhelmingly `checked_*`, every state-mutating function in `marketplace`/`tokenizer`/`rollover`/`maturity_engine` calls an `assert_invariant` post-condition, first-depositor/inflation-attack protection (locked minimum liquidity) is correctly implemented in both `marketplace` and `sy_wrapper`, admin transfer is two-step in every custody-holding contract, and in-code comments reference specific historical bug IDs ("H3", "H4", "C1", "M2") and commit `398b178` fixed a real PT-custody accounting bug in `rollover`.

**No Critical or High severity findings were confirmed.** 14 findings were confirmed, all Low/Informational, plus one process-level finding (zero unit tests in `pt_token`/`yt_token`). The most consequential items are: (1) Intent Engine's slippage gate reads an unstaleness-checked TWAP from Marketplace, (2) `sy_wrapper` never calls `extend_ttl` anywhere, a real archival-rent gap, and (3) the protocol's entire economic backing is delegated to the honesty and correctness of an external Blend Capital pool with no on-chain sanity check beyond a 10%-per-call rate-increase ratchet.

---

## 2. Architecture Review

| Contract | Role | Custodies funds? |
|---|---|---|
| `factory` | One-shot deployer/wirer per epoch; epoch registry & rollover linked-list | No |
| `vault` | Thin pass-through over sy_wrapper; vault shares == SY shares 1:1 | Yes (via sy_wrapper) |
| `sy_wrapper` | Lends underlying into Blend Capital; computes SY exchange rate (protocol's core oracle) | Yes |
| `tokenizer` | Mints PT+YT 1:1 against SY shares; tracks surplus/yield accounting; drives settlement | Yes |
| `pt_token` / `yt_token` | ERC20-like principal/yield tokens, mint/burn restricted to `tokenizer` | No (token ledger only) |
| `marketplace` | YieldSpace AMM, PT↔underlying + bisection-priced YT; TWAP oracle | Yes |
| `maturity_engine` | Canonical epoch FSM clock, consulted by tokenizer/yt_token/marketplace | No |
| `rollover` | Auto-redeems matured PT via tokenizer, re-deposits via intent_engine into next epoch | Transient only |
| `intent_engine` | Atomic multi-hop router (deposit→mint→swap→settle in one tx) | Transient only (asserted zero-residual-balance) |

**Dependency graph:** `factory` deploys+wires all others → `vault`→`sy_wrapper` (price source) → `tokenizer` (mint/settle, consults `maturity_engine`) → `pt_token`/`yt_token` → `marketplace` (trades PT/YT, consults `maturity_engine` for expiry) → `rollover`/`intent_engine` (orchestrate cross-contract flows, using scoped `authorize_as_current_contract` grants).

`soroban-sdk` versions: `22.0.0` (factory, marketplace, maturity_engine, sy_wrapper, vault, pt_token, yt_token, tokenizer) vs `22.0.11` (intent_engine, rollover) — minor version skew, not a security issue but should be aligned for reproducible builds.

---

## 3. Threat Model

**Assets at risk:** underlying tokens custodied in `vault`/`sy_wrapper`; PT/YT token supply integrity; AMM reserves in `marketplace`; correctness of the SY exchange rate (the root oracle all PT/YT redemption value derives from).

**Privileged actors:**
- **Protocol admin** (single `Address` per contract, set at `initialize`): can pause/unpause, open/settle/archive epochs (some settle paths are intentionally permissionless), change fee/config parameters, and in `pt_token`/`yt_token` can call `set_tokenizer`/`set_sy_wrapper` to redirect mint/burn authority in a single transaction (no timelock).
- **Keeper** (`rollover`): privileged only during a grace period after maturity; permissionless (anyone) after grace expires — a liveness guarantee, not a trust escalation.
- **Users**: every fund-moving action requires `require_auth()` by the fund owner; verified present at every mint/burn/deposit/withdraw/swap/redeem entry point audited.

**External trust dependency:** `sy_wrapper`'s `YieldSource` (Blend Capital pool address, set once at init, no rotation function) is fully trusted for `get_positions()` — this is the single largest external trust boundary in the protocol (Finding SEC-10).

**Attack surfaces considered:** unauthorized fund movement, reentrancy, integer overflow/underflow, TWAP/oracle manipulation, storage TTL expiry (fund lockup via archival), maturity/settlement off-by-one errors, replay of signed operations, first-depositor share-inflation attacks, admin key compromise.

---

## 4. Detailed Findings

Severity scale: Critical (direct, unconditional fund loss) / High (fund loss under plausible conditions) / Medium (fund loss under narrow conditions, or protocol integrity risk) / Low (fails safe, defense-in-depth gap, or narrow theoretical exposure) / Informational (code quality, centralization, or documentation gap) / Best Practice.

### Low-Medium

**SEC-01 — Intent Engine slippage gate uses unstaleness-checked TWAP — FIXED**
`contracts/intent_engine/src/lib.rs:206-210, 250-252` (consuming `contracts/marketplace/src/lib.rs:1144-1155`)
Intent Engine's `get_current_best_rate` calls `Marketplace::get_twap_rate()` (the plain, non-staleness-checked variant) and gates `execute_fixed_yield_intent` on `current_twap < min_implied_rate` at line 250-252. Marketplace separately exposes `get_twap_rate_checked()` (`marketplace/src/lib.rs:1176-1182`) which reverts on staleness (`MAX_TWAP_AGE_LEDGERS = 200`), but this checked variant is never called by any consumer in the codebase.
*Attack scenario:* In an idle/low-liquidity market, a stale TWAP could pass the `RateTooLow` gate even though it no longer reflects the live curve. The actual swap still executes against live reserves with its own `min_underlying_out` slippage backstop, so this is a rate-quality/UX gap rather than a direct fund-drain, but it weakens the intended protection.
*Fix applied:* Added `get_twap_rate_checked` to `MarketplaceInterface` and switched both `get_current_best_rate` and `execute_fixed_yield_intent`'s rate gate to call it instead of `get_twap_rate`. A stale TWAP now reverts the call instead of silently passing the gate. Verified with `cargo build`/`cargo test -p intent_engine -p sy_wrapper` (all 35 tests pass).

### Low

**SEC-02 — `sy_wrapper` never extends storage TTL — FIXED**
`contracts/sy_wrapper/src/lib.rs` (whole file)
Unlike every other contract in the workspace, no `env.storage().instance().extend_ttl(...)` (or persistent equivalent) call exists anywhere in `sy_wrapper`. Under sustained low usage, the instance entry (admin, rate, total shares/underlying, everything) could reach its TTL and become archived, requiring restoration before the contract is usable again — a liveness/fund-lockup risk, not a direct fund-loss vector.
*Fix applied:* Added `INSTANCE_LIFETIME_THRESHOLD`/`INSTANCE_BUMP_AMOUNT` constants (matching `marketplace`'s values) and an `extend_ttl` call in `storage::get_admin`, the helper invoked on nearly every state-changing entrypoint (`deposit`, `withdraw`, `refresh_rate`, `mark_loss`, `harvest_yield`, `pause`/`unpause`, admin transfer), so the contract's instance TTL is now refreshed on every meaningful call. Verified with `cargo build`/`cargo test -p sy_wrapper` (29 tests pass).

**SEC-03 — Raw division instead of `checked_div` in Tokenizer settlement math**
`contracts/tokenizer/tokenizer/src/lib.rs:389-392` (`claim_yield`) and `contracts/tokenizer/tokenizer/src/lib.rs:533-536` (`redeem_pt`)
```
shares_to_withdraw = claimable.checked_mul(1_000_000_000) ... / exchange_rate
```
Division by `exchange_rate`/`settlement_rate` uses raw `/`, not `checked_div`. If either rate were ever legitimately zero, this panics (transaction reverts) rather than returning a clean, mapped error. Fails safe under `overflow-checks = true` — no fund loss — but is inconsistent with the codebase's otherwise-uniform `checked_*` convention.
*Recommendation:* Convert to `checked_div` mapped to an explicit contract error.

**SEC-04 — Raw arithmetic in Intent Engine YT-sale-percentage calculation**
`contracts/intent_engine/src/lib.rs:314`
```
yt_to_sell = (yt_amount * (yt_sale_percentage as i128)) / 100
```
`yt_sale_percentage` is bounds-checked to `0..=100` at L230-231, and `yt_amount` is bounded by real token supply, so this is not practically exploitable, but it deviates from the `checked_mul`/`checked_div` convention used everywhere else.
*Recommendation:* Convert to `checked_mul`/`checked_div` for consistency and explicit error handling.

**SEC-05 — `record_surplus_baseline_pub` has no access control**
`contracts/tokenizer/tokenizer/src/lib.rs:668-670`
The function is `pub fn` with no `require_auth()` of any kind. It recomputes `LastRecordedSurplus` from live on-chain state (not attacker-supplied input), so calling it is idempotent and not directly exploitable, but it is unusual for a real-accounting setter to be world-callable rather than restricted to the `yt_token` contract it is designed to serve.
*Recommendation:* Restrict to `require_auth()` by the registered `YtToken` address, or document explicitly why it is intentionally permissionless.

**SEC-06 — Single-step admin-authority handoff for mint/burn control**
`contracts/tokenizer/pt_token/src/lib.rs:439-451` (`set_tokenizer`), `contracts/tokenizer/yt_token/src/lib.rs` (`set_tokenizer`/`set_sy_wrapper`)
Unlike `transfer_admin`/`accept_admin` (correctly two-step throughout the codebase), `set_tokenizer` and `set_sy_wrapper` take effect in a single transaction under one admin signature. A compromised admin key can instantly redirect mint/burn authority to an attacker-controlled contract.
*Recommendation:* Consider a two-step or timelocked pattern for these setters, consistent with the admin-transfer functions.

**SEC-07 — Rollover TTL-refresh helpers don't self-bump**
`contracts/rollover/src/lib.rs:140-167` (and similarly `maturity_engine/src/lib.rs:91-100`, `factory/src/lib.rs:266-275`)
`is_paused`, `get_grace_period`, `get_total_pt_held` (and analogous getters elsewhere) don't call `extend_ttl` themselves; they rely on some other function in the same call path (typically `get_address`) incidentally refreshing instance TTL. This holds under every currently-exercised call pattern but is fragile — a future code path that calls only these helpers would silently stop refreshing TTL.
*Recommendation:* Consolidate TTL-bumping into a single storage-access helper used by all instance reads, rather than relying on incidental refresh from unrelated calls.

### Informational

**SEC-08 — Rollover cross-contract deltas silently floor to zero — FIXED**
`contracts/rollover/src/lib.rs:451-452, 463, 470`
`core::cmp::max(0, ...)` clamps on `yt_proceeds`/`pt_growth`/`new_pt` deltas floor anomalous negative results to 0 instead of reverting with an explicit error. `assert_invariant` (L562-586) would still catch a resulting real custody mismatch, but a same-magnitude accounting bug elsewhere that happens to still balance custody could be masked here rather than failing loudly. Replaced with `checked_sub(...).ok_or(NovaireRolloverError::MathOverflow)?` so any anomalous negative delta reverts explicitly instead of silently flooring.

**SEC-09 — Stale test snapshot with no corresponding test for rollover's keeper gate — FIXED**
`contracts/rollover/test_snapshots/test/test_unauthorized_keeper.1.json` exists with no corresponding test function in `contracts/rollover/src/test.rs`. The keeper-vs-permissionless access-control boundary at `rollover/src/lib.rs:360-362` (`current_ledger <= grace_expiration` requires keeper) is one of only two privileged code paths in the contract and currently has no live test exercising it. Added `test_execute_rollover_keeper_vs_permissionless_boundary`, which exercises all three phases (inside grace, exactly at `grace_expiration`, and one ledger past it) and asserts on `env.auths()` that keeper authorization is required in the first two and absent in the third.

**SEC-10 — Full trust in external Blend Capital pool, no independent sanity bound**
`contracts/sy_wrapper/src/lib.rs:147-155` (`pool_supplied_value`)
The SY exchange-rate computation sums the entire `supply` map from `BlendPoolClient::get_positions()` with no filtering or independent cross-check, beyond a 10%-per-call rate-increase ratchet (`refresh_rate`, L340-379) that bounds how fast a bad report can move the rate. A compromised or buggy Blend pool would (rate-limited) permanently inflate `TotalUnderlying`, letting early withdrawers over-drain relative to real backing. `YieldSource` is set once at `initialize` with no rotation function — good for reducing admin-rug risk, but means the deployed address must be independently verified as genuine before mainnet.
*This is the single largest external trust dependency in the protocol and should be named explicitly in any external audit summary or user-facing risk disclosure.*

**SEC-11 — `sy_wrapper.deposit` external call precedes final state commit — FIXED**
`contracts/sy_wrapper/src/lib.rs:226-274`
The external Blend `submit` call (L267) executes before final state commits (L269-274), a CEI-pattern deviation. `withdraw`'s ordering is correct (state decremented before the external call). Low practical risk on Soroban (no reentrancy vector via standard SAC tokens confirmed), but `deposit` should mirror `withdraw`'s ordering for defense-in-depth. `total_shares`/`total_underlying` are now committed before `pool_client.submit(...)`, matching `withdraw`'s CEI ordering.

**SEC-12 — Unused `_maturity_ledger` parameter in Intent Engine — FIXED**
`contracts/intent_engine/src/lib.rs:225`
`execute_fixed_yield_intent` accepts `_maturity_ledger: u32`, never read or validated. Not an authorization bypass (the wired contract set is fixed at `initialize` — no per-call epoch selection exists), but dead/misleading API surface: a caller might assume passing a stale value has an effect. Parameter removed from `execute_fixed_yield_intent` and every call site (`rollover`, `integration_tests` test harness, unit/e2e tests).

**SEC-13 — `add_accrued_yield` silently no-ops on zero amount — FIXED**
`contracts/tokenizer/yt_token/src/lib.rs:547`
`if amount > 0` silently skips rather than rejecting, inconsistent with the codebase's usual `<=0 → explicit error` convention. Harmless in practice (only caller already gates on `historical_yield > 0`). Now rejects `amount <= 0` with `InvalidAmount`, matching convention; the sole caller (`tokenizer`'s late-mint path) already only invokes this with `historical_yield > 0`, so behavior is unchanged for all real call sites.

**SEC-14 — Zero unit-test coverage in `pt_token` and `yt_token` — FIXED** *(process finding, not a code defect)*
Added standalone `#[cfg(test)] mod test;` suites to both contracts (37 tests in `pt_token`, 43 in `yt_token`), covering: initialization/double-init, mint/burn authorization and error paths, pause behavior (including transfer's intentional pause-bypass), approve/transfer_from allowance accounting, the two-step admin/tokenizer(/sy_wrapper for YT) transfer flows, and for `yt_token` specifically: yield-index update monotonicity, checkpoint/accrual math, `add_accrued_yield`, the H4 fix (yield locks to the sender across a transfer), and maturity/expiry transitions via a real `maturity_engine` instance. Both packages needed a `[dev-dependencies]` `soroban-sdk testutils` feature added to their `Cargo.toml` (previously absent, which is presumably why no tests existed).
`contracts/tokenizer/pt_token/src/lib.rs`, `contracts/tokenizer/yt_token/src/lib.rs`
Neither file contains a `#[cfg(test)]` module. All confidence in these contracts' correctness is transitive via `tokenizer`'s 8 integration tests, which do not exercise allowance mechanics, pause toggling, `transfer_from` edge cases, yield-index monotonicity rejection, or the sender-keeps-earned-yield-on-transfer property directly.

---

## 5. Risk Matrix

| ID | Title | Severity | Likelihood | Fund-loss potential |
|---|---|---|---|---|
| SEC-01 | Unstaleness-checked TWAP in intent_engine slippage gate | Low-Medium | Low (requires idle market) | Bounded by downstream `min_underlying_out` — **FIXED** |
| SEC-02 | sy_wrapper has no TTL extension | Low | Low (requires long inactivity) | None (liveness/lockup only) — **FIXED** |
| SEC-03 | Raw division in tokenizer settlement math | Low | Very low | None (fails safe: revert) |
| SEC-04 | Raw arithmetic in intent_engine YT-sale calc | Low | Very low | None (fails safe: revert) |
| SEC-05 | record_surplus_baseline_pub unauthenticated | Low | Low | None demonstrated |
| SEC-06 | Single-step tokenizer/sy_wrapper reassignment | Low | Requires admin key compromise | High if admin compromised |
| SEC-07 | Rollover TTL helpers don't self-bump | Low | Low | None (liveness only) |
| SEC-08 | Rollover deltas floor to zero | Informational | Low | None (invariant check backstops) — **FIXED** |
| SEC-09 | Missing keeper-gate test | Informational | N/A | Test-hygiene only — **FIXED** |
| SEC-10 | Full trust in Blend pool | Informational/Trust | Depends on third party | High if Blend pool compromised |
| SEC-11 | sy_wrapper deposit CEI ordering | Informational | Very low | None demonstrated — **FIXED** |
| SEC-12 | Dead `_maturity_ledger` param | Informational | N/A | None — **FIXED** |
| SEC-13 | add_accrued_yield no-op on zero | Informational | N/A | None — **FIXED** |
| SEC-14 | pt_token/yt_token zero unit tests | Process | N/A | Increases risk of undetected regressions — **FIXED** |

---

## 6. Test Coverage Review

**Strongest coverage:** `marketplace` (~2,930 lines; dedicated TWAP-manipulation, flash-loan-resistance, and reciprocal-pricing regression tests referencing named historical bugs "H3"; a "C1" reserve-accounting regression suite; and a `proptest`-based invariant fuzzer at `contracts/marketplace/src/lib.rs:2757-2933`, confirmed present, the only property-based testing in the workspace). `sy_wrapper` also has a dedicated `audit_tests.rs` with randomized stress testing and an explicit donation-attack clamp test.

**Solid coverage:** `maturity_engine` (full FSM + exact-boundary + spam-idempotency tests), `rollover` (full-stack E2E lifecycle, PT-custody invariant, invariant-violation trip test), `vault` (E2E flow + TTL-survival test), `tokenizer` (8 tests: state-machine gating, dust redemptions, double-redeem/zero-amount rejection), `intent_engine` (6 tests covering both intent types, slippage/pause/zero-amount rejection, zero-residual-balance assertions), `factory` (confirmed: `test_wiring_mismatch_fails`, `test_maturity_engine_wiring_mismatch_fails`, `test_duplicate_maturity_panic`, `test_unauthorized_initialization_fails` all present in `contracts/factory/src/test.rs`).

**Zero coverage:** `pt_token`, `yt_token` — no `#[cfg(test)]` module in either file (SEC-14) — **FIXED**, see above.

**Specific gaps identified:**
- No live test of rollover's keeper-vs-permissionless access boundary (SEC-09).
- No exact-boundary test at `grace_expiration` in rollover (only `<=` vs `<` behavior is implied by code, not tested at the exact tick).
- No test of `mint_pt_yt` with `sy_shares <= 0` in tokenizer.
- No test of tokenizer's late-minter `add_accrued_yield` historical-credit path — described in `docs/PROTOCOL_INVARIANTS.md` as the mechanism preventing dilution of existing YT holders, yet the most novel logic in the file has no dedicated test.
- No simulation of a dishonest/misbehaving Blend pool in `sy_wrapper` tests (inflated `get_positions`, reverting `submit`) — the mock pool is honest-by-construction in all existing tests, so SEC-10's trust boundary is entirely untested.
- No `intent_engine` test of `min_underlying_out` slippage rejection on the fixed-yield path's marketplace leg (only the speculation path's slippage rejection is tested).

---

## 7. Recommendations (Summary)

1. ~~Switch `intent_engine`'s rate gate to `get_twap_rate_checked()` (SEC-01).~~ **Fixed.**
2. ~~Add `extend_ttl` calls throughout `sy_wrapper` (SEC-02).~~ **Fixed.**
3. Convert remaining raw division/multiplication to `checked_*` (SEC-03, SEC-04).
4. Add `require_auth()` restricting `record_surplus_baseline_pub` to the YtToken address (SEC-05).
5. Consider two-step/timelocked handoff for `set_tokenizer`/`set_sy_wrapper` (SEC-06).
6. Consolidate TTL-bump logic into shared storage helpers so no read path can silently skip it (SEC-07).
7. Add unit test suites for `pt_token` and `yt_token` (SEC-14).
8. Restore/add a live keeper-access-control test in `rollover` (SEC-09).
9. Add adversarial-Blend-pool test scenarios to `sy_wrapper` (SEC-10).
10. Independently verify the genuine, official Blend Capital pool contract address before mainnet deployment (SEC-10).
11. Align `soroban-sdk` versions across all workspace crates (currently 22.0.0 vs 22.0.11).

---

## 8. Security Score per Category

Scoring is qualitative (0-10), justified by evidence above; this is not a certification.

| Category | Score | Justification |
|---|---|---|
| Access control | 8/10 | `require_auth()` verified present at every fund-moving entry point audited; only gap is single-step `set_tokenizer`/`set_sy_wrapper` (SEC-06) and unauthenticated `record_surplus_baseline_pub` (SEC-05, not exploitable). |
| Arithmetic safety | 8/10 | `overflow-checks=true` at workspace level plus near-universal `checked_*` use; a handful of raw `/`/`*` remain (SEC-03, SEC-04) but all fail safe (revert, not wrap). |
| Storage / TTL discipline | 6/10 | Persistent storage is consistently and correctly TTL-bumped everywhere. Instance storage has a recurring pattern of read-only helpers not self-bumping (SEC-07), and `sy_wrapper` has no TTL management at all (SEC-02) — a real gap. |
| Oracle / price security | 7/10 | TWAP design (pre-swap-price recording, 200-ledger staleness bound, dedicated regression tests for temporal-ordering and flash-loan resistance) is well-built, but the staleness-checked variant isn't actually used by its one consumer (SEC-01). SY exchange rate is fully dependent on an external pool with only a rate-of-change limiter as protection (SEC-10). |
| AMM / settlement correctness | 8/10 | `assert_invariant` after every mutating call in marketplace/tokenizer/rollover/maturity_engine; first-depositor protection correctly implemented; property-based fuzz testing present in marketplace; several named historical bugs already fixed and regression-tested. |
| Reentrancy posture | 8/10 | Soroban's native cross-contract call restrictions plus explicit CEI ordering in `vault.withdraw` (documented in-code) and scoped `authorize_as_current_contract` grants with empty sub-invocations in `intent_engine`/`rollover`; one CEI deviation in `sy_wrapper.deposit` (SEC-11, low risk). |
| Test coverage | 6/10 | Excellent depth in marketplace/sy_wrapper/rollover; zero unit tests in pt_token/yt_token (SEC-14) and several missing boundary/adversarial scenarios pull the average down. |
| Admin / centralization risk | 6/10 | Two-step admin transfer is the norm; single-step `set_tokenizer`/`set_sy_wrapper` and single-key admin (no multisig/timelock observed in-contract) represent standard but real centralization risk for a testnet-stage protocol. |

**Overall: 7/10 — solid pre-mainnet posture, no fund-draining bug confirmed, but several Low findings and one real trust dependency (Blend pool) should be addressed/documented before mainnet.**

---

## 9. Mainnet Readiness Assessment

**Not blocked by any Critical/High finding — none was found.** Before mainnet deployment, the audit team recommends:

1. **Must-fix (Low findings with concrete code changes):** SEC-01 through SEC-07 — all are small, mechanical changes with clear fixes above.
2. **Must-verify (no code change, but a real operational step):** independently confirm the genuine Blend Capital pool contract address wired into `sy_wrapper` (SEC-10) — this cannot be validated by code review alone.
3. **Should-fix before mainnet:** add unit tests for `pt_token`/`yt_token` (SEC-14), restore the missing rollover keeper-gate test (SEC-09), and add the boundary/adversarial test scenarios listed in §6.
4. **Should-consider:** timelock or multisig for admin functions, especially `set_tokenizer`/`set_sy_wrapper` and `mark_loss`, given the outsized blast radius of a single compromised admin key (SEC-06).
5. **Recommended but not blocking:** align `soroban-sdk` versions workspace-wide; get an independent third-party audit given this document was produced by AI-assisted code review, not a licensed security firm, and should not be treated as a substitute for one.

This document reflects the state of the code as of commit `881fc15` (branch `master`) and should be re-run against any subsequent changes before mainnet launch.
