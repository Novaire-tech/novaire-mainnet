# Protocol Invariants — current 5-contract architecture

Scope: `sy-wrapper`, `pt-token`, `yt-token`, `tokenizer`, `amm`.
(`blend-adapter` and `shared/types` are libraries, not deployed contracts.)

Each invariant names the test that enforces it. If you change code and an invariant here has no
passing test, the invariant is a claim, not a guarantee — fix that before shipping.

> Supersedes `docs/archive/PROTOCOL_INVARIANTS.superseded.md`, which described the pre-2026-08-13
> 10-contract system (`factory`, `vault`, `marketplace`, `maturity_engine`, `rollover`,
> `intent_engine`) and cited `refresh_rate`, `mark_loss`, and a +10% rate ratchet. **None of those
> mechanisms exist in the current contracts.**

---

## 1. SY exchange rate (the root oracle)

**SY-01 — The rate is derived, never stored.**
`exchange_rate() == blend_assets_under_management * WAD / sy_supply`, computed on every call from
the live Blend position. There is no setter, no refresh, no admin lever.
→ `blend-adapter`: `derived_rate_reflects_aum_over_supply`, `derived_rate_is_monotonic_as_interest_accrues`

**SY-02 — Bootstrap is WAD.** With `sy_supply <= 0` the rate is exactly `WAD`.
→ `blend-adapter`: `derived_rate_bootstraps_to_wad_when_empty`

**SY-03 — Deposits cannot dilute.** Shares are minted against the *measured AUM increase* after
Blend's bToken rounding, priced at the rate observed **before** the supply.
→ `sy-wrapper` unit tests; `integration_tests::blend_wrapper`

**SY-04 — Redemption never shorts remaining holders.** On a partial Blend withdrawal, shares burned
are rounded **up**, so `exchange_rate` is non-decreasing across any deposit/redeem sequence.
→ P2-02 regression (see `FINDINGS.md`)

**SY-05 — Wrong reserve fails closed.** If Blend moves the underlying to a different reserve index,
every rate read traps with `InvalidBlendReserve` rather than pricing the wrong asset. Recovery is
`migrate_reserve_index`, which re-derives the index from the pool and cannot be aimed at a
different asset.
→ `integration_tests::blend_wrapper::exchange_rate_traps_when_the_reserve_index_moves`,
  `migrate_reserve_index_rejects_when_underlying_absent`, `..._rejects_on_index_mismatch`

**Trust boundary.** SY-01 means the protocol's entire economic backing is the honesty and solvency
of one external Blend pool, fixed at `initialize_blend` with no rotation path. This is the largest
unmitigated risk in the system (see work order P3-04).

---

## 2. Tokenization (PT / YT)

**TK-01 — Split is collateral-neutral.** `split` escrows `sy_amount` SY (asset value `face` at the
current rate) and mints exactly `face` PT and `face` YT. Escrow coverage cannot worsen, so split is
never gated on solvency — matching Pendle, where `_mintPY` has no collateralization check.
→ `integration_tests::journey::split_then_recombine_preserves_sy`

**TK-02 — PT redeems principal, not shares.** After maturity, PT returns
`pt_amount * WAD / frozen_rate` SY. The *asset* value returned equals face regardless of how the
rate moved.
→ `integration_tests::economics::pt_redeems_to_principal_not_share`,
  `journey::pt_redeems_one_to_one_after_maturity`

**TK-03 — The maturity rate is the last rate observed at or before maturity.** Never a live
post-maturity read: Blend has no maturity concept and keeps accruing, so a live read would let
freeze *timing* move value between PT and YT.
→ `economics::redemption_uses_frozen_maturity_rate`,
  `freeze_ignores_post_maturity_accrual_even_on_late_first_touch`,
  `unobserved_pre_maturity_tail_freezes_at_the_last_observation`

**TK-04 — One rate, regardless of call order.** A PT redemption and a YT claim in either order
settle against the same frozen rate.
→ `economics::pt_redeem_and_yt_claim_use_one_frozen_rate_regardless_of_order`

**TK-05 — PT is senior to YT.** `claim_yield` pays only
`min(owed, escrow - ceil(pt_supply * WAD / rate))`. The PT reservation is rounded **up**, so PT is
never shorted by a rounding notch. Unpaid YT yield stays banked, never lost.
→ `economics::yt_claim_is_subordinated_when_pt_is_under_covered`,
  `yt_claim_takes_only_the_surplus_over_pt_reservation`,
  `banked_yield_becomes_claimable_after_the_rate_recovers`, `pt_face_reservation`

**TK-06 — Shortfalls are priced, not blocked.** Under a rate regression, `recombine` and
`redeem_at_maturity` cap payout at the holder's pro-rata share of escrow, preserving the
escrow/PT ratio for later redeemers. Neither ever reverts on collateralization.
→ `economics::redemption_is_capped_when_rate_regresses`,
  `split_and_recombine_survive_a_rate_regression`,
  `claim_yield_survives_a_sub_stroop_rate_regression`

**TK-07 — Escrow conservation.** Escrow surplus over the PT reservation equals exactly the sum of
YT accruals: `face * WAD * (1/c - 1/r)`. Yield is conserved across transfers and claims.
→ `economics::escrow_covers_outstanding_claims`, `transfer_conserves_yield_through_claims`,
  `conservation_holds_across_random_sequences`

**TK-08 — Re-entrancy model.** Soroban forbids re-entering a contract already on the stack. The
tokenizer therefore computes the canonical rate **once** and passes it down to YT (`settle`,
`consume`, `burn_settled`) rather than letting YT call back. YT paths entered *directly* by a
holder (`transfer`, `burn`) instead route their rate read through the tokenizer's `observe_rate` /
`freeze_maturity_rate`, so every rate YT banks at is also on record for the freeze.
→ `economics::direct_yt_transfer_is_observed_by_the_maturity_freeze`,
  `direct_yt_burn_is_observed_by_the_maturity_freeze`

**TK-09 — YT supply may fall below PT supply.** Holders can burn YT directly. This is by design: no
economic path reads YT `total_supply`; escrow, the PT-senior cap, and the pro-rata math read only
`pt_total_supply`.

---

## 3. AMM

**AMM-01 — Marginal prices satisfy no-arb.** `PT_price + YT_price ≈ 1.0` in asset terms at
infinitesimal size.
→ live probe (`scripts/probe-live.mjs`); baseline `0.96198 + 0.03809 = 1.00007`

**AMM-02 — Exact-in swaps charge the curve cost, never the caller's budget.** The trader is debited
exactly `required_sy`, reserves grow by exactly that amount, and `spent <= sy_in`. No value is
created or destroyed by the settlement.
→ `amm`: `saturated_pt_buy_charges_only_the_curve_cost`,
  `pt_buy_charge_equals_quoted_cost_at_every_size`,
  `sy_exact_in_swaps_credit_only_the_charged_amount_to_reserves`

**AMM-03 — PT never executes above par plus fee.** A zero-coupon PT redeems at 1.0 face, so no
honest fill pays more than `1.0 + fee` per unit of face.
→ `amm`: `pt_buy_effective_price_never_exceeds_par_plus_fee`

**AMM-04 — A trade may only leave the market on a valid curve point.** The solver rejects any
candidate whose post-trade reserves cannot be priced by `try_get_exchange_rate` or exceed reserve
bounds. Infeasible sizes are rejected at quote time, not trapped mid-execution.
→ `require_post_trade_feasible`; covered by AMM-02's tests

**AMM-05 — Flash-route rounding dust stays a matched pair.** `flash_split` ceils, so it may
over-mint up to one face unit of PT+YT. Both stay in pool custody as a recombinable pair; the
trader never receives dust.
→ `integration_tests::journey::flash_route_over_mint_dust_stays_a_matched_pair_and_never_panics`

**AMM-06 — Curve unit discipline.** The curve prices PT face against **underlying-asset** value, so
`total_sy` is converted through the live SY rate before standing in for `total_asset`. Conversions
floor when paying out and ceil when charging in.
→ `amm`: `round_trip_sy_to_pt_to_sy_conserves_value_at_nonpar_rate`,
  `swap_pt_for_sy_executes_fewer_sy_shares_at_appreciated_rate`

**AMM-07 — TWAP re-enters warm-up after an idle gap.** A gap of a full window snaps the TWAP to a
single observation, which is exactly the manipulation window a TWAP exists to prevent — so
`warmup_until` is pushed out and consumers must not trust the value until a full window passes.
→ `amm`: `twap_re_enters_warmup_after_an_idle_gap_snaps_it`

**AMM-08 — Maturity closes trading, not exit.** All four swaps and `add_liquidity` reject after
maturity; `remove_liquidity` does not.
→ `amm`: `swap_*_rejects_after_maturity`, `remove_liquidity_after_maturity_returns_pro_rata_assets`

---

## 4. Governance invariants

**GOV-01 — Admin transfer is two-step** in all three privileged contracts.
`propose_admin` nominates; nothing changes until the nominee calls
`accept_admin`. A mistyped address cannot orphan governance.
→ `admin_transfer_is_two_step` (×3), `accept_admin_without_a_nomination_fails`

**GOV-02 — Pause is asymmetric.** Guardian or admin may pause; only the admin
may unpause. Cheap to stop, deliberate to restart.
→ `guardian_can_pause_but_not_unpause`

**GOV-03 — Pause never blocks an exit.** `redeem`, `recombine`,
`redeem_at_maturity`, `claim_yield`, `observe_rate`, `remove_liquidity`, every
SEP-41 `transfer`/`burn`, and every read-only quote all remain callable while
paused. Only entries (`deposit`, `split`, `swap_*`, `add_liquidity`) close.
→ `pause_blocks_deposits_but_never_redemptions`,
  `pause_blocks_entries_but_never_lets_lps_get_stuck`, `pause_blocks_split_only`

**GOV-04 — Upgrades are timelocked 72h and advertised.** `propose_upgrade`
emits `UpgradeProposed{wasm_hash, eta}`; `execute_upgrade` reverts before `eta`.
→ `upgrade_cannot_execute_before_the_timelock`, `upgrade_respects_the_timelock`

**GOV-05 — Renouncing is permanent and total.** After `renounce_admin`, no
pause, upgrade, sweep, fee change, reserve migration or wind-down is possible.
→ `renounce_permanently_disables_governance`

**GOV-06 — Sweep can never touch a protocol asset.** `sy-wrapper` refuses the
underlying; `tokenizer` refuses SY/PT/YT; `amm` refuses PT/SY.
→ `sweep_moves_foreign_tokens_but_never_the_underlying`,
  `sweep_refuses_escrow_and_the_pt_yt_pair`, `sweep_refuses_the_reserves`

**GOV-07 — The protocol fee is a share of the FEE, never of the trade**, capped
at 50%, and ships at 0 so launch economics are unchanged.
→ `protocol_fee_defaults_to_zero_and_changes_nothing`,
  `protocol_fee_takes_a_share_of_the_fee_not_the_trade`,
  `protocol_fee_share_is_capped`

**GOV-08 — Wind-down preserves the rate and pays pro-rata.**
`emergency_withdraw_all` recovers the Blend position into idle custody without
repricing holders; redemption then pays each holder their exact pro-rata slice.
Irreversible.
→ `emergency_wind_down_recovers_funds_and_keeps_redemption_open`,
  `emergency_withdraw_is_irreversible`

---

## 5. Known gaps (not yet invariants)

Stated so nobody mistakes their absence for a guarantee. Tracked in
`FINDINGS.md`.

- **No external audit.** The single largest gap. Everything above is
  self-verified.
- **Protocol fee accrues on plain PT↔SY swaps only.** The YT flash routes are
  composite trades through the tokenizer; threading a fee deduction through them
  would disturb the dust accounting the escrow invariants depend on.
- **AMM-held YT dust accrues yield nothing claims.** Small, but monotonic over a
  market's life.
- **LP positions are not tokens** — no transfer, no composability, and therefore
  no LP incentive program.
- **One market per deployment.** No factory, so no rolling maturities.
- **Blend remains a single unrotatable dependency.** Wind-down (GOV-08) is an
  exit, not a migration.
- **Liquidity is far below usable depth.** A capital problem, not a code one.
