# Novaire Release Notes

**Version:** v0.2.0 (proposed — see Git Tag Recommendation)
**Git SHA:** `b384401`
**Date:** 2026-08-08

## Highlights

This release closes out a security-hardening pass (SEC-03 through SEC-14) and a
decentralization pass (removal of single-key admin control over mint authority,
withdrawals, epoch creation, loss accounting), then adds a frontend correctness
pass that removes every place the UI was fabricating a financial number when
live data was unavailable, plus a real testnet verification harness to prove it.

No contract source changed in this final commit — only frontend/services/scripts
and test tooling. Contract logic ships as already committed in `9356ca7` and
prior.

## Major Features

- Real testnet verification suite (`scripts/verify-testnet.ts`, `scripts/verify_testnet/`) that exercises 5 live wallet scenarios against deployed contracts, no mocks.
- Playwright e2e specs for the portfolio/dashboard UI (`apps/web/e2e/`).
- `assertRequiredAddresses` deploy-time guard rejecting missing/placeholder contract IDs before `deploy_epoch` runs.
- Real projected-daily-yield calculation (`apps/web/src/utils/yield.ts`) replacing a static "Unavailable on Testnet" placeholder.

## Smart Contract Changes

None in this commit. Most recent contract-affecting work (already on `master` prior to this release commit):
- `9356ca7` — decentralization Phases 2–5: removed single-key admin control over mint authority, withdrawals, epoch creation, loss accounting.
- `004b62e` — corrected Blend Capital bToken/`b_rate` accounting in SY Wrapper.
- `0b59396` — wired `maturity_engine` into Factory as canonical epoch FSM.
- `53bb66b` — YT priced off live YieldSpace curve instead of flat 1-TWAP formula.
- SEC-03 through SEC-14 (commits `dcb4ed8`..`b94069a`) — CEI-ordering, dead-param, zero-amount-convention, unit-coverage fixes across `sy_wrapper`, `rollover`, `pt_token`/`yt_token`.

## Frontend Changes

- Removed duplicate PT/YT accounting against synthetic vault-rollup entries (`portfolioService.ts`) — rollup is now display-only, excluded from `totalValueUsd` and allocation%.
- `TradingAnalytics`, `ProtocolDashboard`, `TradeInterface`, `KPICards`, `MetricCard` updated to render "Stale"/"unavailable" states instead of computed numbers when underlying data is untrustworthy.
- `useTrade.ts` and `protocolService.ts` switched to `get_twap_rate_checked()`.

## Backend Changes

- `scripts/utils.ts` — `assertRequiredAddresses` guard; unit-tested (`scripts/utils.test.ts`).
- `scripts/deploy.ts`, `scripts/deploy_xlm_epoch.ts` — wired to the new guard.

## SDK Changes

None.

## Security Improvements

- **TWAP staleness surfaced, not silently swallowed.** `get_twap_rate()` → `get_twap_rate_checked()`; a revert now sets `twapStale: true` and forces `impliedYieldApy` to `0` instead of computing from a stale price.
- **Oracle-failure fallback price removed.** `xlmPriceUsd` no longer silently defaults to `0.1`; `priceUnavailable: true` is surfaced and `tvlUsd` forced to `0`.
- Carried forward from `9356ca7`: single-key admin no longer controls mint authority, withdrawals, epoch creation, or loss accounting.
- Carried forward from SEC-03..SEC-14: CEI-ordering fix in `sy_wrapper` deposit (SEC-11), rollover PT-custody invariant hardening (SEC-08/09, `398b178`, `32b3cfa`).

## Financial Correctness Fixes

- Fixed duplicate-accounting bug that double-counted intent-flow (PT/YT) positions against synthetic vault-rollup entries (verified end-to-end by testnet Scenario D — allocation sums to exactly 100%).
- Division-by-zero guards on `totalInvestedXlm` / `totalClaimableYieldXlm` when `xlmPriceUsd` is 0 (eliminates an `Infinity` path during oracle outage).
- Replaced fabricated 0.1 XLM/USD fallback price with an explicit "Price feed unavailable" UI state.

## Blend Integration

- SY Wrapper bToken/`b_rate` accounting fix (`004b62e`) — `positions.supply` now converts via `b_rate` instead of being treated 1:1 as underlying.
- Deploy-time guard requires `BLEND_POOL` to be present, non-empty, non-placeholder before an epoch can deploy.

## PT/YT Improvements

- YT priced off live YieldSpace curve (`53bb66b`), replacing a flat 1-TWAP formula.
- Large-YT-trade warning + quote functions for YT swaps (`09ff290`).
- Rollover PT-custody invariant strengthened to prevent orphaned custodied PT on position overwrite (`32b3cfa`, `398b178`).

## Deployment Improvements

- `assertRequiredAddresses` blocks `deploy_epoch` if any required contract ID (`BLEND_POOL`, `underlying_token`, `sy_wrapper`, `vault`, `pt_token`, `yt_token`, `tokenizer`, `marketplace`, `intent_engine`, `rollover`, `factory`) is missing, empty, a zero/burn address, or a placeholder (`TODO`/`PLACEHOLDER`/`CHANGEME`/`UNSET`).

## Breaking Changes

- UI contract change: components that previously rendered a computed number when data was stale/unavailable now render an explicit unavailable state ("Stale", "Price feed unavailable"). Any downstream consumer scraping those numeric strings will need to handle the new text states.

## Migration Notes

- No contract redeployment required by this commit — contract WASM is unchanged from the current testnet deployment (epoch tracked in `scripts/deployments.testnet.json`, `maturity_ledger: 4135061`).
- Frontend/services consumers of `portfolioService.ts` should re-check any code relying on the old (duplicated) `totalValueUsd` — the value will now be lower and correct.

## Known Limitations

- Scenario E (claimable-yield accrual) in `verify:testnet` is **skipped**: `yt_token` has no user-callable accrual transaction in this contract version. The safe-math guard (`xlmPriceUsd > 0 ? ... : 0`) was verified non-NaN/non-Infinity by inspection instead.
- `npm run lint` fails on pre-existing baseline debt (585 errors / 13,314 warnings, mostly `@typescript-eslint/no-explicit-any`) unrelated to this change set — confirmed identical on the pre-diff base via `git stash` comparison. Not fixed in this release.

## Contributors

- Ahir Sarkar
- Swarupa Saha
