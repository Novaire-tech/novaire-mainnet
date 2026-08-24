# Novaire — Mainnet Hardening Findings

Working branch: `mainnet-hardening`
Parent commit: `d1232c1c` ("Add benchmarking suite for contracts, indexer, and web")
Work order: `prompt-novaire.md`

Every finding below was independently re-verified against `HEAD` before any code changed.
Baseline evidence: `docs/evidence/probe-baseline-testnet.txt`

---

### P1-01 — Exact-in swaps silently confiscate unspent input

- **Status:** REPRODUCED
- **Severity:** Critical (unbounded, silent loss of user funds; no attacker required)
- **Files:** `contracts/amm/src/lib.rs` — `swap_sy_for_pt`, `swap_sy_for_yt`,
  `exact_sy_in_pt_out_with_cost_or_panic`, `solve_yt_out_for_sy_in_with_cost`,
  `apply_exact_sy_in_trade_with_required_sy_or_panic`
- **Evidence (live testnet simulation, `docs/evidence/probe-baseline-testnet.txt`):**

  ```
   size    |      pt_out (buy)       |      yt_out (buy)
    1.0000 |  1.034803 @0.97547      |   8.109892 @0.12447
    4.0000 |  3.958591 @1.01998      |  16.590710 @0.24337
    6.0000 |  3.958591 @1.52997      |  18.447211 @0.32832
   10.0000 |  3.958591 @2.54995      |  18.447211 @0.54719
   40.0000 |  3.958591 @10.19979     |  18.447211 @2.18877
  ```

  `quote_sy_for_pt` saturates at **3.958591 PT for any input >= 4 SY**. At 40 SY in, the trader
  pays an effective **10.20 asset per PT** — for a zero-coupon token that redeems at 1.00.
  ~36 SY (90% of input) is absorbed into LP reserves and never returned.
  `quote_sy_for_yt` saturates identically at 18.447211 YT for any input >= 6 SY.

- **Root cause:** the solver returns the largest *affordable* output, bounded by
  `high = total_pt - 1` and by `try_get_exchange_rate` returning `None` at the
  `ExchangeRateBelowOne` / `MAX_MARKET_PROPORTION` boundary. The swap then transfers the full
  `sy_in` into the pool and credits `state.total_sy += sy_in`, ignoring `required_sy`.
- **Why `min_out` does not protect:** `quote_*` runs the identical solver, so the quote returns
  the same saturated output. The frontend derives `minimumReceived` from that quote
  (`apps/web/src/hooks/useTrade.ts` -> `utils/slippage.ts`). Quote and execution agree exactly;
  the bound passes; the user signs.
- **Status:** FIXED
- **Fix:** charge the curve-derived cost, not the caller's budget.
  - `apply_exact_sy_in_trade_with_required_sy_or_panic` now credits `required_sy` to reserves
    (was `sy_in`).
  - `swap_sy_for_pt` transfers `required_sy` from the trader (was `sy_in`).
  - `swap_sy_for_yt` transfers `shares_to_split - sy_funded`, the buyer's true shortfall
    (was `sy_in`).
  - New read-only entrypoints `quote_sy_for_pt_cost` / `quote_sy_for_yt_cost` return
    `(amount_out, sy_used)` so callers can see and display what will actually be spent.
- **Regression tests** (`contracts/amm/src/lib.rs`, all fail on the parent commit):
  - `saturated_pt_buy_charges_only_the_curve_cost` — overshoot saturation 8x; asserts the trader
    is debited the quoted cost, the pool receives exactly that, and `spent < sy_in`.
  - `pt_buy_charge_equals_quoted_cost_at_every_size` — trader delta == pool delta == quoted cost
    across five sizes.
  - `pt_buy_effective_price_never_exceeds_par_plus_fee` — a zero-coupon PT can never honestly
    cost more than `1.0 + fee` per unit of face. Live baseline paid up to **10.20x par**.
  - `sy_exact_in_swaps_credit_only_the_charged_amount_to_reserves` — **rewritten**; see P1-01b.

---

### P1-01b — Existing test codified the confiscation as intended behaviour

- **Status:** FIXED (test corrected)
- **File:** `contracts/amm/src/lib.rs` — was `sy_exact_in_swaps_credit_full_input_to_reserves`
- **Detail:** the test asserted `after.total_sy == before.total_sy + sy_in`, i.e. the
  `sy_in - required_sy` gap belongs to LPs. That framing is only true while the solver is bounded
  by the caller's *budget*, where the gap is one stroop of rounding dust — which is the case the
  test exercised (21001 vs 21002). When the solver is bounded by the *curve* instead, the identical
  line donates an unbounded amount. Renamed to
  `sy_exact_in_swaps_credit_only_the_charged_amount_to_reserves` and now asserts
  `trader_debit == required_sy == pool_credit`.

---

### P1-01c — Solver never checked post-trade feasibility (found while fixing P1-01)

- **Status:** FIXED
- **Severity:** Medium (liveness: valid-looking trades trap; was masked by P1-01)
- **File:** `contracts/amm/src/lib.rs` — `try_exact_pt_out_sy_in`, `try_exact_pt_in_sy_out`
- **How it surfaced:** with P1-01 fixed, `saturated_pt_buy_charges_only_the_curve_cost` failed with
  `Error(Contract, #15)` (`ExchangeRateBelowOne`) *during execution*, after the quote had succeeded.
- **Root cause:** the solver validated only the pre-trade exchange rate. `apply_*` then recomputes
  the implied rate from post-trade reserves and traps if that point is off-curve. Crediting the
  caller's full `sy_in` had been inflating `total_asset` just enough to keep the post-trade point
  valid — **the confiscated funds were holding the invariant up.** Charging the true cost exposed it.
- **Fix:** new `require_post_trade_feasible()` gate, applied in both solver directions. A candidate
  is affordable only if the state it leaves behind is within reserve bounds and still priceable by
  `try_get_exchange_rate`. Trades that would break the market are now rejected at quote time rather
  than trapping mid-execution.

---

### P1-02 — AMM curve state derived from attacker-writable `balanceOf`

- **Status:** FIXED
- **Severity:** High
- **File:** `contracts/amm/src/lib.rs` — `reconcile_reserves`
- **Evidence:** `state.total_pt`/`total_sy` are assigned directly from
  `token::TokenClient::balance(amm)`. Any address can `transfer` PT or SY to the AMM; the next
  `add_liquidity` / `remove_liquidity` / flash-route swap folds the donation into curve state.
  Commit `4e0c5bc` made plain PT<->SY swaps skip the reconcile, so `state` and balances now
  legitimately diverge and snap on the next flash route.
- **Confirmed side effect (live):** `amm.reserve_pt` (199638224) currently equals
  `state.total_pt` (199638224), but nothing enforced this between reconciles.
- **Fix:** reserves are now authoritative in `state` and move only by amounts the contract
  accounted for.
  - `reconcile_reserves` (balance assignment) replaced by `credit_flash_dust`, which folds in
    only the dust a flash split/recombine actually minted — measured from the tokenizer's own
    return value, so a donation cannot masquerade as dust.
  - `add_liquidity` / `remove_liquidity` no longer read balances at all; their state deltas were
    already exact.
  - `settle_and_record_without_reconcile` became `settle_and_record_without_dust`, now a named
    alias making the no-dust property explicit rather than describing a skipped balance read.
  - `reserve_pt()` / `reserve_sy()` now report **curve state**, not custody, so they can no
    longer disagree with `state()`. New `untracked_balance()` surfaces the difference.
  - Donated tokens sit in the contract, permanently outside the curve. Nobody can farm them and
    nobody can move the anchor with them.
- **Regression tests:** `donated_pt_never_enters_curve_reserves` (donates, then drives every
  mutating path and asserts reserves never absorb it), `donated_sy_never_enters_curve_reserves`,
  `reserve_views_report_curve_state_not_custody`.

---

### P2-01 — `spot_apy` / `twap_apy` / `implied_apy` return ln-rate, not APY

- **Status:** REPRODUCED
- **Severity:** Medium (wrong headline metric, wrong data for integrators)
- **File:** `contracts/amm/src/lib.rs` — `ln_rate_to_bps`
- **Evidence (live):** `amm.state.last_ln_implied_rate = 195909333878730541` (0.195909).
  `amm.spot_apy()` returns **1959 bps = 19.59%**. True annualized = `e^0.195909 - 1` =
  **21.64%**. Understated by 2.05 percentage points.
- **Status:** FIXED
- **Fix:** `ln_rate_to_bps` now returns `(e^ln_rate - 1) * 10_000` via the existing `exp_wad`
  helper. Negative log rates (PT above par) map to negative bps rather than being clamped, so an
  inverted market is distinguishable from a flat one.
- **Regression tests:** `ln_rate_to_bps_annualizes_instead_of_reporting_the_log_rate` (pins the
  live value: 0.195909 -> ~2164 bps, not 1959), `ln_rate_to_bps_is_zero_at_zero`,
  `ln_rate_to_bps_matches_log_rate_closely_when_small`,
  `ln_rate_to_bps_reports_negative_yield_as_negative`, `spot_apy_reports_annualized_yield`.
- **Note:** the frontend's `bps / 100` conversion is unchanged and still correct.

---

### P2-02 — `sy_wrapper::redeem` rounds shares-to-burn in the redeemer's favour

- **Status:** REPRODUCED (by inspection)
- **Severity:** Low (only rounding in the codebase pointing the wrong way)
- **File:** `contracts/sy-wrapper/src/lib.rs` — partial-withdraw branch of `redeem`
- **Evidence:** `mul_div_or_panic(env, received, WAD, exchange_rate)` truncates toward zero, so
  the redeemer burns fewer shares than the underlying received is worth. Shortfall is socialised
  across remaining SY holders.
- **Status:** FIXED
- **Fix:** new `mul_div_ceil_or_panic` rounds shares-to-burn **up** on the partial-fill path,
  capped at the holder's balance so a ceil can never burn more than they own.

---

### Confirmed correct — do not change

Verified during review; these are deliberate and right:

- Cross-contract re-entrancy model (tokenizer computes the rate once and passes it down to YT).
- Maturity freeze uses the last pre-maturity observation, never a live post-maturity read.
- PT seniority: `claim_yield` reserves `ceil(pt_supply * WAD / rate)` before paying YT.
- Escrow conservation: surplus == sum of YT accruals, exactly.
- **AMM curve marginal pricing is correct.** Live no-arb check at smallest size:
  `PT 0.96198 + YT 0.03809 = 1.00007`. The curve math is not the bug; the exact-in
  *settlement* is.


---

## Test evidence

| Run | Scope | Result |
|---|---|---|
| `docs/evidence/cargo-test-p1-01.log` | full workspace, P1-01 applied | **135 passed, 0 failed** (exit 0) |
| `docs/evidence/probe-baseline-testnet.txt` | live testnet read-only probe, pre-fix | saturation reproduced |

Per-crate on the P1-01 run: amm 44, integration/economics 19, integration/journey 7,
integration/blend_wrapper 7, integration/auth_invariants 2, blend-adapter 14, sy-wrapper 14,
tokenizer 10, pt-token 9, yt-token 9.

## Deliberately not done (needs a human decision)

Work-order Phases 3 and 4 are architectural changes with explicit decisions attached. They were
**not** implemented unilaterally:

- **P3-01** multisig admin + two-step transfer. (`admin` is currently dead storage in 4 of 5
  contracts; the only live admin path is a single deployer key.)
- **P3-02** pause. Design is settled (asymmetric: entries pausable, exits never) but it lands
  with P3-01.
- **P3-03** DECISION: timelocked upgradeability vs deliberate immutability.
- **P3-04** Blend emergency wind-down. Highest-value remaining safety item.
- **P3-05** DECISION: protocol fee switch. Must be decided *before* deploy if P3-03 picks
  immutability, because there is no way to add it afterwards.
- **P4-01** LP as a real token (prerequisite for any LP incentive program).
- **P4-02** market factory / rolling maturities.
- **P4-03** seed liquidity sizing (capital decision) and replacing the CoinDCX price feed with
  Reflector.
