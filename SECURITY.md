# Security Policy

## Security Overview

Novaire is a yield-tokenization protocol on Soroban (Stellar smart contracts). Users deposit an underlying asset, which is supplied into a Blend Capital lending pool through an SY wrapper, split into Principal Tokens (PT) and Yield Tokens (YT), and traded on a time-decay AMM until maturity.

**Status: testnet only. Not audited in its current form. Not mainnet-ready.** Treat all deployments and funds as experimental.

This document was rewritten from a line-by-line read of the current contract sources (`contracts/{sy-wrapper,blend-adapter,tokenizer,amm,pt-token,yt-token,shared}/src/lib.rs`), the integration suite (`contracts/integration_tests/tests/`), and `contracts/scripts/deploy-mainnet.sh`. Every claim below is intended to be traceable to code. Where a property is believed true but not proven by a test, it is labeled **UNVERIFIED** or **OPEN** — never "fixed".

Hard facts, stated up front:

- **No external security audit covers the current architecture.** `SECURITY_AUDIT.md` audits a superseded 10-contract design and is explicitly marked as such at its top. It must not be used to assess today's system.
- **There is no pause, circuit breaker, emergency withdrawal, or upgrade mechanism in any contract.** Verified: no `update_current_contract_wasm`, no pause flag, no `set_admin`/`transfer_admin` exists anywhere in `contracts/*/src/lib.rs`.
- **Admin is a single key per contract, set once at `initialize`.** No multisig, no timelock, no rotation.
- **Real Blend integration is wired but only mock-tested in CI.** All Rust tests run against `MockBlendPool` (`blend-adapter/src/lib.rs::testutils`). Only `scripts/verify-testnet.ts` scenario F touches a real testnet Blend pool.

---

## Architecture (current — 6 contracts)

| Contract | Role | Custodies funds? |
|---|---|---|
| `sy-wrapper` | Wraps a Blend plain-supply position into SEP-41 SY shares; sole exchange-rate source | Yes (underlying in transit, bTokens at Blend) |
| `tokenizer` | Splits SY into equal-face PT/YT; holds SY escrow; settlement and yield claims | Yes (escrowed SY) |
| `pt-token` | Principal claim token (SEP-41); mint/burn gated to `tokenizer` | No (ledger only) |
| `yt-token` | Yield claim token (SEP-41) with settle/consume ledger; mint/burn gated to `tokenizer` | No (ledger only) |
| `amm` | Time-decay AMM: PT↔SY direct, SY↔YT flash-routed through the tokenizer; TWAP | Yes (reserves) |
| `blend-adapter` | Library crate: Blend pool client bindings, rate math, `MockBlendPool` test double | N/A — not deployed |

`contracts/shared/types` is a 50-line trait crate (`StandardizedYield`). `contracts/integration_tests` is test-only.

Dependency graph:

```
sy-wrapper ──(BlendPoolClient: get_reserve_list/get_reserve/get_positions/submit)──▶ Blend pool
tokenizer  ──▶ sy-wrapper (exchange_rate), pt-token (mint/burn), yt-token (mint/burn/settle/consume)
amm        ──▶ sy-wrapper (exchange_rate), pt-token, yt-token, tokenizer (flash split/recombine)
```

No factory, no vault, no marketplace, no maturity_engine, no rollover, no intent_engine. Each market is a fresh, immutable deployment.

> **SUPERSEDED AUDIT.** `SECURITY_AUDIT.md` (dated 2026-08-07) reviewed the prior 10-contract architecture — factory, vault, marketplace, maturity_engine, rollover, intent_engine, tokenizer, pt_token, yt_token, sy_wrapper — replaced on 2026-08-13. Several of its positive findings (locked minimum liquidity in the SY wrapper, two-step admin transfer, runtime `assert_invariant` post-conditions, a 10%-per-call rate ratchet, admin pause) describe mechanisms that **do not exist in the current contracts**. The current 6-contract architecture has received **no external audit of any kind**.

---

## Trust Model

| Actor | Trusted for | Explicitly NOT trusted / not verified on-chain |
|---|---|---|
| Blend Capital pool (external) | Solvency; honest `get_positions`, `get_reserve.data.b_rate`, and `submit` behavior | Nothing about the pool is validated beyond a reserve-index and decimals cross-check. There is no bound on the magnitude or rate of change of `b_rate`. A wrong or malicious value flows straight into the SY rate on the next read. |
| Protocol admin (single key per contract) | Passing correct one-time init parameters (pool address, maturity, AMM curve params); `sy-wrapper::migrate_reserve_index` recovery | Cannot move user funds, mint/burn tokens, set the exchange rate, or pause anything — no such entry points exist |
| Underlying token issuer (SAC / SEP-41 asset) | Not freezing or clawing back protocol-held balances | No on-chain mitigation exists for issuer clawback/authorization revocation |
| Users | Their own funds only, gated by `require_auth()` | Anything belonging to anyone else |
| Off-chain infra (RPC, frontend, `scripts/`) | Nothing security-relevant | Out of scope of this policy |

---

## Access Control

Every entry point that moves funds or is privileged, across all six contracts.

| Contract | Function | Moves funds? | Auth mechanism | Privileged? | Status |
|---|---|---|---|---|---|
| sy-wrapper | `initialize_blend` | No | `admin.require_auth()` + `AlreadyInitialized` guard | Yes (one-shot) | OK |
| sy-wrapper | `migrate_reserve_index` | No | `admin.require_auth()` + `admin == config.admin` | Yes | OK — re-derives index from pool, cannot point at a different asset |
| sy-wrapper | `deposit` | Yes | `from.require_auth()` | No | OK |
| sy-wrapper | `redeem` | Yes | `from.require_auth()` | No | OK |
| sy-wrapper | `transfer` / `transfer_from` / `approve` | Yes (shares) | `from` / `spender.require_auth()` + allowance | No | OK |
| sy-wrapper | (internal) `push_underlying`, `blend_submit` | Yes | `authorize_as_current_contract` scoped to one `(contract, fn, args)` triple | N/A | OK |
| tokenizer | `initialize` | No | `admin.require_auth()` + one-shot guard | Yes | OK |
| tokenizer | `split` | Yes | `from.require_auth()` | No | OK |
| tokenizer | `recombine` | Yes | `from.require_auth()` | No | OK |
| tokenizer | `redeem_at_maturity` | Yes | `from.require_auth()` + `require_matured` | No | OK |
| tokenizer | `claim_yield` | Yes | `holder.require_auth()` | No | OK |
| tokenizer | `observe_rate` / `freeze_maturity_rate` | No | None — permissionless by design | No | OK — read-and-record only; freeze is idempotent and uses the last pre-maturity observation |
| pt-token | `initialize` | No | `admin.require_auth()` + one-shot guard | Yes | OK |
| pt-token | `mint` | No (supply) | `config.tokenizer.require_auth()` | Yes (tokenizer only) | OK — fixed at init, no rotation |
| pt-token | `burn` / `burn_from` | No (supply) | `from` / `spender.require_auth()` | No | OK |
| pt-token | `transfer` / `transfer_from` / `approve` | Yes | `from` / `spender.require_auth()` | No | OK |
| yt-token | `initialize` | No | `admin.require_auth()` + one-shot guard | Yes | OK |
| yt-token | `mint` | No (supply) | `config.tokenizer.require_auth()` | Yes | OK |
| yt-token | `settle` / `consume` / `burn_settled` | No (ledger) | `config.tokenizer.require_auth()` | Yes | OK — tokenizer calls these via scoped `authorize_as_current_contract` |
| yt-token | `burn` / `burn_from` / `transfer` / `transfer_from` / `approve` | Yes | `from` / `spender.require_auth()` | No | OK |
| amm | `initialize` | No | `admin.require_auth()` + one-shot guard + bounds checks on maturity/scalar/anchor/fee/TWAP window | Yes | OK |
| amm | `swap_pt_for_sy`, `swap_sy_for_pt`, `swap_sy_for_yt`, `swap_yt_for_sy` | Yes | `from.require_auth()` | No (permissionless AMM) | OK |
| amm | `add_liquidity` / `remove_liquidity` | Yes | `from.require_auth()` | No | OK |
| amm | (internal) flash split/recombine, pool transfers | Yes | `authorize_as_current_contract` with exact args | N/A | OK — arg-pinning asserted in `auth_invariants.rs` |
| blend-adapter | — | — | Library only, not deployed | — | N/A |

Auth evidence: `integration_tests/tests/auth_invariants.rs::flash_route_top_level_auth_is_arg_pinned` (auth entries carry exact `sy_in`/`min_yt_out`; every authorized transfer amount is concrete and positive) and `::flash_route_user_only_signs_the_swap` (user signs only the top-level swap plus its funding transfer; the AMM self-scopes every sub-call).

No missing `require_auth()` was found on any fund-moving or privileged entry point.

---

## Admin Model

**Admin is a single `Address` per contract, supplied at `initialize` and never changeable.** `contracts/scripts/deploy-mainnet.sh` (lines 185–198) passes `--admin "$DEPLOYER_ADDRESS"` — a single `stellar keys` identity — to all five deployed contracts. There is **no multisig, no timelock, no two-step transfer, and no rotation path**. If the key is lost, `migrate_reserve_index` becomes permanently unavailable; if it is compromised, the blast radius is the list below.

**Admin can:**
- Set every one-time init parameter: the Blend `pool` address, `underlying`, `maturity`, `tokenizer`/`sy_token` wiring, AMM `scalar_root`, `initial_anchor`, `fee_bps`, `twap_window`.
- Call `sy-wrapper::migrate_reserve_index`, which re-derives the reserve index from the pool's own reserve list, cross-checks it against `get_reserve(underlying).config.index`, and requires decimals to still match. It cannot aim the wrapper at a different asset.

**Admin cannot:**
- Move, freeze, or seize any user funds.
- Mint or burn SY, PT, or YT (mint/burn are gated to the `tokenizer` address, fixed at init).
- Set or override the SY exchange rate — no setter exists anywhere.
- Pause, halt, or rate-limit any operation — no such function exists.
- Upgrade or replace contract code — no `update_current_contract_wasm` call exists.
- Change fees, the maturity, the AMM curve, or the wired contract addresses after init.
- Transfer or renounce admin rights.

Note that the *deployer key*, before initialization completes, controls which addresses get wired together. A market is only trustworthy if its full init transcript is verified.

---

## External Dependencies

### REAL BLEND INTEGRATION (in the deployed code path)

`contracts/blend-adapter/src/lib.rs` defines a hand-written `#[contractclient] BlendPoolClient` with four calls: `get_reserve_list`, `get_reserve`, `get_positions`, `submit`. It is hand-written rather than imported because `blend-contract-sdk` pins Soroban SDK 25 while Novaire is on 26.1.

- The pool address is supplied by the deployer at `initialize_blend` and **stored immutably**. Init validates only that `underlying` appears in the pool's reserve list, that the pool's own `get_reserve(underlying).config.index` agrees with that position, and that reserve decimals equal 7. **No on-chain check can distinguish a genuine Blend pool from a convincing fake** — this is entirely an operational deploy-time concern.
- Assets under management are read live on every rate call: `blend_assets_under_management` reads `get_positions(self).supply[reserve_index]` and multiplies by `get_reserve(underlying).data.b_rate / 1e12` (`assets_from_b_tokens`). It traps with `InvalidBlendReserve` if the pool has since moved the underlying to a different reserve index — fail-closed, recoverable only by `migrate_reserve_index`.
- The exchange rate is `aum * WAD / sy_supply` (`derived_exchange_rate`), returning `WAD` when supply is zero. **There is no bound on the value, no monotonicity enforcement, no rate-of-change limiter, and no independent cross-check.** The adapter's doc comment asserts monotonicity "under normal operation" — that is an assumption about Blend, not an enforced invariant.
- Deposits use plain `Supply` (request type 0), not `SupplyCollateral`, so the position is never seizable in a Blend liquidation. Withdrawals use `try_submit` so a failing Blend withdraw reverts before any share is burned (`sy-wrapper` line ~520).

### MockBlendPool — TEST INFRASTRUCTURE ONLY

`blend-adapter/src/lib.rs::testutils::MockBlendPool` is an in-memory double compiled only under `#[cfg(any(test, feature = "testutils"))]`. It exposes unrestricted `set_b_rate`, `set_reserve_index`, `set_reserve_list`, `set_should_fail_withdraw` with **no authorization at all** — appropriate for a test double, catastrophic if ever deployed. It is not in the mainnet deploy script's contract list (`sy_wrapper pt_token yt_token tokenizer amm`).

**Every Rust unit and integration test in this repo runs against MockBlendPool.** Any claim that Blend integration is "verified" refers to mock behavior unless it names `scripts/verify-testnet.ts`.

---

## Economic Security

### SY exchange rate
Derived only from the Blend position: `assets_from_b_tokens(b_tokens, b_rate) * WAD / total_shares`. No admin setter exists (confirmed by the absence of `set_exchange_rate` from `SyWrapperClient`; the sy-wrapper test module notes it would not compile if one existed). Deposits are priced at the **pre-deposit** rate and mint against the *actual* AUM increase after Blend's bToken rounding, so a deposit cannot dilute the rate.

### First-depositor / inflation attack

- **`amm`: MITIGATED.** `MINIMUM_LIQUIDITY = 1_000` LP shares are permanently unminted on the first `add_liquidity` (`amm/src/lib.rs` lines 587–609), the standard dead-shares pattern. Covered by tests asserting the seed mints `sqrt(pt*sy) - MINIMUM_LIQUIDITY`.
- **`sy-wrapper`: OPEN.** There is **no minimum liquidity lock, no dead shares, and no virtual-share offset.** Shares are `assets_credited * WAD / exchange_rate`, and `exchange_rate` bootstraps to `WAD` only while supply is zero. **No regression test for a donation/inflation attack exists.** The previous revision of this document argued the attack is closed because AUM is read from the wrapper's own bToken position rather than a donatable token balance. **That argument is not sound as written**: Blend's `submit` credits the `from` address's supply position, so a third party paying their own underlying into the pool on behalf of the wrapper's address would raise the wrapper's bToken balance — and therefore its AUM and rate — without minting any SY. Whether real Blend permits a non-authorizing `from` on a supply request is a property of Blend, not of this repo, and **has not been verified here against the real pool contract**. Until it is, treat sy-wrapper first-depositor inflation as **OPEN**, not mitigated.

### AMM: SY shares vs. underlying asset units

The curve prices PT face against **asset** units while reserves are held in **SY shares**. The current code converts at the boundary:

- `precompute_or_panic` (line ~890) computes `total_asset = sy_to_asset(state.total_sy, rate)` with the live SY rate read from the SY contract (`sy_rate_or_panic`, the same entry point the tokenizer prices with), floor-rounded.
- Trade math converts back with `asset_to_sy_down` when paying out and `asset_to_sy_up` when charging in (lines ~930–1070), i.e. rounding always favors the pool.
- `apply_exact_*_trade` recomputes the observed implied rate from `sy_to_asset(state.total_sy, comp.rate)`, not raw shares.
- Flash routes convert with `shares_in_for_face_up` / `shares_out_for_face_down`, ceil/floor matched to the tokenizer's own flooring.

**Evidence this is exercised at a non-unit rate:** `integration_tests/tests/journey.rs::flash_route_over_mint_dust_stays_a_matched_pair_and_never_panics` sweeps ~220 rate/trade-size combinations with the pool-derived rate moved above `WAD`, asserting the buyer receives exactly `yt_out` and `amm.reserve_sy() == sy.balance(&amm)` throughout; `::yt_flash_route_accepts_one_share_recombine_dust_window` does the same at three rate deltas. **Status: MOCK-TESTED as correct on the trade path.**

**Residual, OPEN:** the *seeding* path still conflates the two units. In `add_liquidity`, when `state.total_lp == 0`, the initial `last_ln_implied_rate` is computed as `get_ln_implied_rate_or_panic(env, state.total_pt, state.total_sy, ...)` (`amm/src/lib.rs` lines 598–605) — passing raw SY shares into the `total_asset` parameter, with no `sy_to_asset` conversion. Every other call site converts. A market seeded when the SY rate has already accrued above `WAD` therefore starts from a mispriced implied rate and anchor. No test covers this: every AMM test seeds liquidity while the rate is still `WAD`, and the `proptest` fuzzer runs entirely at `WAD`. **Severity P2, status OPEN.**

### PT/YT invariants (tokenizer)
- `split` mints equal PT and YT face `= floor(sy_amount * rate / WAD)` and escrows the SY. Collateral-neutral by construction; deliberately not gated on solvency (matching Pendle's `_mintPY`).
- `recombine` and `redeem_at_maturity` cap the payout at `min(full, escrow_shares * pt_amount / pt_supply)` — a pro-rata haircut under shortfall rather than a first-come drain.
- `claim_yield` is **PT-senior**: it pays `min(owed, max(0, escrow_shares - ceil(pt_supply * WAD / rate)))`, reserving full PT face (rounded up) before YT may draw. Unpaid yield stays banked in the YT ledger, never lost, never overpaid.
- Post-maturity redemption uses a frozen rate — the last rate observed **at or before** maturity (`effective_rate`), never a live post-maturity read, so freeze timing cannot move value between PT and YT.
- Rate reads on the tokenizer path use 256-bit intermediates (`mul_div_floor`/`mul_div_ceil` over `I256`) so `pt_supply * WAD` cannot spuriously overflow.

---

## Threat Model

Trust boundaries along the value path.

**1. User → sy-wrapper**
Trusted party: none (user is adversarial). Attacker capability: arbitrary deposit/redeem/transfer sizes and ordering. Protected asset: other users' SY shares and principal accounting. Mitigation: `require_auth()` on every path; positive-amount checks; balance checks; principal moved pro-rata on transfer; deposits priced pre-deposit against actual credited AUM. Residual risk: **first-depositor inflation is OPEN** (no minimum-liquidity lock, no regression test).

**2. sy-wrapper → Blend pool**
Trusted party: Blend, fully. Attacker capability: a compromised, buggy, or insolvent pool can report any `b_rate`/position, or fail withdrawals. Protected asset: all underlying in the protocol, and the rate every PT/YT valuation derives from. Mitigation: reserve-index/decimals cross-check; plain-supply (non-collateral) position; fail-closed `InvalidBlendReserve` trap on reindex; `try_submit` so a failed withdraw burns no shares. Residual risk: **unbounded** — no magnitude bound, no rate-of-change limiter, no independent oracle, no pool rotation, and the pool address is only as good as the deploy-time check.

**3. sy-wrapper → tokenizer (PT/YT)**
Trusted party: the SY contract's `exchange_rate`. Attacker capability: exploit a rate move between quote and execution, or drain escrow ahead of other holders. Protected asset: escrowed SY backing PT face. Mitigation: pro-rata escrow cap on both exit paths; PT-senior surplus cap on `claim_yield`; maturity-rate freeze from a pre-maturity observation. Residual risk: `recombine` has **no on-chain `min_sy_out`** — slippage from a rate move must be bounded client-side; the pre-maturity observation tail is credited conservatively to PT.

**4. tokenizer → PT/YT tokens**
Trusted party: the `tokenizer` address recorded at init. Attacker capability: forge a mint/burn/settle. Protected asset: PT/YT supply integrity. Mitigation: `config.tokenizer.require_auth()` on `mint`, `settle`, `consume`, `burn_settled`; the tokenizer authorizes those calls with exact arguments via `authorize_as_current_contract`. Residual risk: a misconfigured `tokenizer` address at init is unrecoverable — there is no `set_tokenizer`.

**5. PT/YT → AMM**
Trusted party: none. Attacker capability: sandwiching, flash-loan style single-transaction manipulation, degenerate curve inputs, dust farming on the flash route. Protected asset: LP reserves. Mitigation: bounds checks (`MAX_RESERVE_UNITS`, `MAX_SCALAR_ROOT`, `MAX_ANCHOR`, fee range) at init and per trade; slippage floors on all four swaps; `MINIMUM_LIQUIDITY` dead shares; rounding always in the pool's favor; over-minted flash dust retained as a matched, recombinable PT/YT pair. Residual risk: **market-seed implied rate is computed in the wrong units (P2, OPEN)**; `reconcile_reserves` sets reserves from live token balances, so a direct token donation to the pool address shifts reserves without a corresponding implied-rate update — economic impact **UNVERIFIED**.

**6. AMM/tokenizer → Settlement (maturity)**
Trusted party: whoever pokes `observe_rate` before maturity (permissionless). Attacker capability: withhold observations so the frozen rate is stale, or race the first post-maturity call. Protected asset: the split of terminal value between PT and YT. Mitigation: freeze uses the last at-or-before-maturity observation, is idempotent, and `claim_yield` establishes the same rate before settling YT, so ordering cannot change outcomes (`economics.rs::pt_redeem_and_yt_claim_use_one_frozen_rate_regardless_of_order`). Residual risk: an unobserved tail between the last observation and maturity is resolved in PT's favor; YT holders must poke `observe_rate` to close it.

---

## Security Controls (present in code)

- `require_auth()` on every fund-moving and privileged entry point (table above).
- Cross-contract authorization narrowly scoped via `authorize_as_current_contract` to a single `(contract, function, exact args)` triple with empty `sub_invocations`, in `sy-wrapper`, `tokenizer`, and `amm`.
- Checked arithmetic throughout (`checked_*` helpers that trap with `MathOverflow`); 256-bit intermediates in the tokenizer; `overflow-checks` enabled for release builds.
- One-shot `AlreadyInitialized` guards on all five deployed contracts; `NotInitialized` traps on every public path of `sy-wrapper` before config exists.
- Fail-closed Blend reserve validation (index + decimals) at init, at every AUM read, and at migration.
- Tolerated Blend withdraw (`try_submit`) that reverts before burning shares.
- AMM input bounds: reserve size, scalar root, anchor, fee bps, TWAP window, plus `ExchangeRateBelowOne` rejection before any implied-rate write.
- Slippage floors (`min_*_out`) on all four AMM swaps and on `remove_liquidity`.
- `MINIMUM_LIQUIDITY` dead shares in the AMM.
- Pro-rata escrow cap and PT-senior yield subordination in the tokenizer.
- Maturity-rate freeze from a pre-maturity observation.
- Storage TTL extension: persistent balance/principal/LP entries bumped on write, instance entries bumped via `bump_instance_ttl`, temporary allowance entries extended to cover their requested expiration.

**Not present:** pause, circuit breaker, emergency withdrawal, upgradeability, admin transfer, rate-of-change limiter, oracle sanity bounds, multisig, timelock, per-block or per-user rate limits, deposit caps.

---

## Testing & Verification

| Area | Label | Evidence |
|---|---|---|
| Authorization / arg-pinning on the flash route | **TESTED** | `auth_invariants.rs` (2 tests) |
| Admin gating of `migrate_reserve_index` | **TESTED** | `sy-wrapper` unit test + `blend_wrapper.rs` (non-admin, absent underlying, index mismatch) |
| SY deposit/redeem/transfer, principal accounting, allowance TTL | **MOCK-TESTED** | `sy-wrapper/src/lib.rs` tests against `MockBlendPool` |
| Blend rate propagation, reindex trap, reindex recovery, tolerated withdraw failure | **MOCK-TESTED** | `blend_wrapper.rs` (5 tests) |
| Blend rate math (`b_rate` scaling, derived rate, monotonic-under-growth, overflow) | **TESTED** (pure functions) | `blend-adapter` unit tests |
| Real Blend pool behavior end-to-end | **TESTNET-VERIFIED (partial, single scenario)** | `scripts/verify-testnet.ts` scenario F "Blend rate propagation (real pool)"; skips if the reserve is disabled. No mainnet verification. |
| PT/YT economics: yield accrual, frozen maturity rate, ordering independence, rate-regression haircut, PT-senior subordination, banked-yield recovery, conservation under random sequences | **MOCK-TESTED** | `economics.rs` (~20 tests incl. a seeded randomized conservation test) |
| AMM swaps, fees, LP mint/burn, slippage, minimum liquidity, TTL, reserve reconciliation | **TESTED** | `amm/src/lib.rs` test module |
| AMM PT/YT/SY invariants under randomized op sequences | **TESTED (at SY rate = WAD only)** | `proptest!` 10,000 cases; the fuzzer never moves the SY rate |
| AMM unit correctness (SY shares vs. asset) on the **trade** path at rate > WAD | **MOCK-TESTED** | `journey.rs` dust sweeps across ~220 rate/size combinations |
| AMM unit correctness on the **market-seed** path at rate > WAD | **NOT TESTED** | See finding N-01 |
| sy-wrapper first-depositor / donation inflation attack | **NOT TESTED** | No such test exists in the repo |
| Adversarial Blend: out-of-bounds, decreasing, or hostile `b_rate` | **NOT TESTED** | Only benign growth and two overflow cases are exercised |
| Underlying-issuer clawback / authorization revocation | **NOT TESTED** | — |
| Mainnet deployment | **NOT PERFORMED** | `deploy-mainnet.sh` simulates by default; requires `--execute-mainnet` |
| External security audit of the current architecture | **NONE** | `SECURITY_AUDIT.md` covers the superseded 10-contract design |

---

## Known Risks

1. **Unbounded trust in the external Blend pool.** No magnitude bound, no rate-of-change limiter, no independent oracle cross-check, no pool rotation. A single bad `b_rate` reaches the SY rate on the next read. **Unmitigated on-chain.**
2. **No emergency controls of any kind.** No pause, no circuit breaker, no emergency withdrawal, no upgrade. If a critical bug is found post-deployment, there is no on-chain lever — only off-chain communication and frontend takedown, which do not stop on-chain activity.
3. **sy-wrapper first-depositor inflation: OPEN.** No dead shares, no virtual shares, no regression test. The prior "likely mitigated" reasoning is not sound (see Economic Security).
4. **AMM market-seed unit conflation: OPEN (P2).** Raw SY shares passed where asset units are expected, at first `add_liquidity` only.
5. **Single-key admin, no timelock, no rotation, no recovery.** Key loss permanently disables `migrate_reserve_index`, the only recovery path from a Blend reindex.
6. **Pool address is immutable and unverifiable on-chain.** A wrong or hostile address wired at deploy time is permanent.
7. **`recombine` has no on-chain `min_sy_out`.** A rate move between quote and execution changes the share count returned; callers must bound this client-side.
8. **Direct token donations to the AMM change reserves.** `reconcile_reserves` reads live balances; economic effect **UNVERIFIED**.
9. **`MockBlendPool` has no authorization on its setters.** Test-only and excluded from the deploy list, but it must never be built into a deployed artifact.
10. **No external audit of the current architecture.**

---

## Security Findings

| ID | Severity | Component | Finding | Status |
|---|---|---|---|---|
| N-01 | P2 | amm | First `add_liquidity` computes the initial `last_ln_implied_rate` from raw `state.total_sy` instead of `sy_to_asset(total_sy, rate)` (lines 598–605); every other call site converts. A market seeded at SY rate > WAD starts from a mispriced anchor. | **OPEN** — no test covers seeding at a non-unit rate |
| N-02 | P1 | sy-wrapper | No first-depositor protection: no minimum-liquidity lock, no dead shares, no virtual-share offset, and no donation/inflation regression test. Prior "mitigated" reasoning depends on unverified Blend `submit` semantics for a third-party `from`. | **OPEN / UNVERIFIED** |
| N-03 | P1 | sy-wrapper / blend-adapter | SY exchange rate has no magnitude bound, no rate-of-change limiter, and no independent cross-check; a hostile or buggy `b_rate` propagates immediately. No adversarial `b_rate` test exists. | **OPEN — accepted design trade-off, unmitigated** |
| N-04 | P1 | all | No pause, circuit breaker, emergency withdrawal, or upgrade mechanism exists anywhere. | **OPEN — by design; no incident-response lever** |
| N-05 | P2 | all | Admin is a single key per contract with no multisig, timelock, transfer, or rotation. | **OPEN** |
| N-06 | P2 | sy-wrapper | Blend `pool` address is immutable after `initialize_blend`, and no on-chain check can distinguish a genuine pool from a fake. | **OPEN — operational control only** |
| N-07 | P3 | tokenizer | `recombine` accepts no `min_sy_out`; rate drift between quote and execution changes the share count. Documented in-code as deliberate. | **OPEN — accepted, client-side mitigation required** |
| N-08 | P3 | amm | `reconcile_reserves` derives reserves from live token balances, so an unsolicited token transfer to the pool shifts reserves without an implied-rate update. | **UNVERIFIED** |
| N-09 | P3 | blend-adapter | `MockBlendPool` exposes unauthenticated `set_b_rate` / `set_reserve_index` / `set_reserve_list`. Gated behind `#[cfg(any(test, feature = "testutils"))]` and absent from the deploy list. | **MITIGATED by build gating — verify no release artifact enables `testutils`** |
| N-10 | INFO | repo | `SECURITY_AUDIT.md` covers the superseded 10-contract architecture; its positive findings (dead shares in SY, two-step admin, runtime invariants, rate ratchet, pause) do not apply to current code. | **DOCUMENTED — marked superseded in both files** |
| N-11 | INFO | amm | The `proptest` invariant fuzzer runs entirely at SY rate = WAD, so it cannot detect SY-vs-asset unit errors. | **OPEN — coverage gap** |
| N-12 | INFO | all | No mitigation or detection for underlying-issuer clawback / authorization revocation on protocol-held balances. | **OPEN — accepted** |

Findings from earlier revisions that were re-verified and remain closed: the AMM `ExchangeRateBelowOne` "trading DoS" report is not reproducible — the check runs before `last_ln_implied_rate` is persisted, so the failing trade reverts atomically and leaves market state unchanged. No alternate state-write path or second AMM implementation exists in the current source.

---

## Mainnet Readiness — Security Considerations

**This protocol is not ready for mainnet, and this document makes no claim of mainnet readiness.** Items that must be resolved or explicitly, publicly accepted first:

1. Obtain an external security audit of the **current 6-contract architecture**. None exists.
2. Resolve or formally accept **N-01** (AMM seed-path unit conflation) — this one is a code fix, not a documentation decision.
3. Close **N-02** with a real donation/inflation regression test, or add a minimum-liquidity lock to `sy-wrapper`.
4. Decide, publicly, on **N-03** (unbounded Blend trust) and **N-04** (no emergency controls): implement a mitigation or record them as permanent accepted trade-offs with user-facing disclosure.
5. Decide on **N-05**: move admin to a multisig or timelocked account, or document the single-key model as accepted.
6. Execute the pre-deploy verification checklist below and publish the transcript.
7. Add adversarial Blend tests (out-of-bounds, decreasing, and hostile `b_rate`).
8. Replace the placeholder security contact below with a monitored address and publish a PGP key.

### Pre-deploy verification (required for every deployment)

- [ ] Confirm the `BLEND_POOL` address matches the official Blend Capital pool in Blend's own registry for the target network — not copied from a prior deployment, a fork, or a third party.
- [ ] Confirm the pool's reserve for `UNDERLYING_ID` is enabled, has 7 decimals, and matches the intended asset.
- [ ] Confirm `MATURITY`, `SCALAR_ROOT`, `INITIAL_ANCHOR`, `FEE_BPS`, `TWAP_WINDOW` — all immutable after init.
- [ ] Confirm the admin address, and that whoever controls it accepts the single-key model (or has moved it to a multisig account first).
- [ ] Verify the deployed WASM hashes against a reproducible build, and confirm no artifact was built with the `testutils` feature.
- [ ] Confirm every contract's init succeeded with the intended wiring **before** any user funds enter — the `tokenizer` address in PT/YT is unchangeable.
- [ ] Seed AMM liquidity being aware of finding N-01 while it remains open.
- [ ] Record the full init transcript alongside the deployment record.

`deploy-mainnet.sh` helps here: it simulates by default, requires `--execute-mainnet`, validates the network passphrase against the real mainnet passphrase, refuses testnet-looking network names, and requires every economic parameter to be supplied explicitly with no fallback defaults.

---

## Incident Response

The honest position: **there are no on-chain incident-response mechanisms.** No pause, no emergency withdrawal, no upgrade, no admin fund recovery.

What actually exists:

- **Detection:** contract events (`Deposit`, `Redeem`, `ReserveMigrated`, `Split`, `Recombine`, `RedeemAtMaturity`, `ClaimYield`) can be monitored off-chain. No automated monitoring or alerting is claimed here.
- **Fail-closed traps:** several classes of anomaly halt themselves — `InvalidBlendReserve` on a Blend reindex bricks all rate reads (and therefore deposits, splits, recombines) until an admin migration; `MathOverflow`, `ExchangeRateBelowOne`, and `InsufficientLiquidity` revert the offending transaction atomically. These are self-protective traps, not an operator-controlled kill switch.
- **The one admin lever:** `sy-wrapper::migrate_reserve_index`, which only recovers from a Blend reindex.
- **Off-chain response only:** public advisory, frontend takedown, direct communication. **None of these stop on-chain activity against a deployed market.** Users can always exit through the normal paths as long as the Blend pool is functioning.
- **New markets:** because contracts are immutable and each market is a fresh deployment, remediation of a code defect means deploying a new market — existing markets cannot be fixed in place.

---

## Responsible Disclosure

If you discover a security vulnerability in this protocol, **please do not open a public GitHub issue.**

**Contact:** security@novaire.xyz *(placeholder — replace with a monitored address before mainnet)*
**PGP key:** *(placeholder — publish a PGP key fingerprint here before mainnet; encrypt any report containing exploit details)*

**What to include:** affected contract(s) and function(s), a description of the issue, and if possible a minimal reproduction (test case, transaction sequence, or PoC contract). We do not require a working exploit — a clearly described theoretical vulnerability with code citations is enough to start triage.

**Response times (target, testnet-stage):**
- Acknowledgment of report: within 48 hours.
- Initial severity assessment: within 5 business days.
- Fix or mitigation for Critical/High findings: best-effort, prioritized immediately; no funds are at mainnet risk today, so no bounty program is active yet.

**Severity classification:**
- **Critical** — direct, unconditional loss or freezing of user funds, or a way to mint/redeem tokens outside protocol rules.
- **High** — fund loss achievable under plausible (not contrived) conditions, or a way to break a core protocol invariant.
- **Medium** — fund loss only under narrow/unlikely conditions, or a way to degrade protocol integrity without direct loss.
- **Low** — fails safe (reverts rather than corrupts), narrow theoretical exposure, or a defense-in-depth gap.
- **Informational** — code quality, documentation, or centralization observations with no direct exploit path.

**Disclosure timeline:** we ask reporters to give us 90 days from acknowledgment before any public disclosure, or until a fix is shipped, whichever is sooner. We will keep you updated on remediation progress throughout.
