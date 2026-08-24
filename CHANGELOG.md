# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project has not yet adopted Semantic Versioning tags in git; version numbers
below are proposed for the first tagged release.

## [Unreleased]

## [v0.2.0] - 2026-08-08

### Added

- Real testnet verification suite (`scripts/verify-testnet.ts`, `scripts/verify_testnet/`) exercising 5 live wallet scenarios against deployed contracts.
- Playwright e2e specs for portfolio/dashboard UI (`apps/web/e2e/`).
- `assertRequiredAddresses` deploy-time guard in `scripts/utils.ts`, wired into `scripts/deploy.ts` and `scripts/deploy_xlm_epoch.ts`.
- Real projected-daily-yield calculation (`apps/web/src/utils/yield.ts`), unit-tested.
- `CONTRIBUTING.md`.
- Unit tests: `apps/web/src/services/protocolService.test.ts`, `apps/web/src/utils/yield.test.ts`, `scripts/utils.test.ts`.
- `apps/web/vitest.config.ts`, `scripts/vitest.config.ts`.

### Changed

- `portfolioService.ts`: synthetic vault-rollup entries excluded from `totalValueUsd` and allocation% (display-only now).
- `protocolService.ts`, `useTrade.ts`: `get_twap_rate()` → `get_twap_rate_checked()`.
- `TradingAnalytics.tsx`, `ProtocolDashboard.tsx`, `TradeInterface.tsx`, `KPICards.tsx`, `MetricCard.tsx`: render explicit "Stale"/"unavailable" states instead of a computed number when underlying data is untrustworthy.

### Fixed

- Duplicate PT/YT accounting against synthetic vault-rollup entries (double-counted `totalValueUsd`/allocation%).
- Division-by-zero paths in `totalInvestedXlm` / `totalClaimableYieldXlm` when `xlmPriceUsd` is 0.

### Security

- Removed silent fallback to a stale TWAP-derived implied APY; stale reads now surface `twapStale: true` and force `impliedYieldApy` to `0`.
- Removed hardcoded `0.1` XLM/USD fallback price on oracle failure; failures now surface `priceUnavailable: true` and force `tvlUsd` to `0`.

### Deprecated

- Nothing.

### Removed

- Placeholder "Today's Yield: Unavailable on Testnet" static string in `KPICards.tsx` (replaced by real calculation with an explicit fallback string only when APY is genuinely 0/unavailable).

## Prior history (pre-changelog, from git log)

- `9356ca7` feat(decentralization): remove single-key admin control over mint authority, withdrawals, epoch creation, loss accounting.
- `004b62e` fix(contracts): correct Blend Capital bToken/`b_rate` accounting in SY Wrapper.
- `0b59396` feat: wire `maturity_engine` into Factory as canonical epoch FSM.
- `53bb66b` feat: price YT off live YieldSpace curve instead of flat 1-TWAP formula.
- `dcb4ed8`..`b94069a` fix/test(security): SEC-03 through SEC-14 remediation.
- `398b178`, `32b3cfa` fix(rollover): strengthen PT custody invariant.
- `ee6e3a8` fix(admin): add emergency pause to marketplace.
- `9a636a0` fix(storage): add TTL management for persistent state.
