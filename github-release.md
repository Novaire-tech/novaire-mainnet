# Release title

Novaire v0.2.0 — Financial-Correctness Hardening & Testnet Verification Suite

**Version:** v0.2.0
**Git SHA:** `b384401`

## Summary

This release removes every place the frontend was fabricating a financial
number when live data was unavailable (stale TWAP, dead oracle, duplicated
PT/YT accounting), and adds a real testnet verification harness — 5 wallet
scenarios run against live deployed contracts, no mocks — to prove it. No
contract source changed in this commit; the underlying contract security and
decentralization work (SEC-03..SEC-14, admin-key removal) shipped in prior
commits already on `master`.

## Features

- Real testnet verification suite (`npm run verify:testnet`) — 5 scenarios against live contracts.
- Playwright e2e specs for portfolio/dashboard.
- `assertRequiredAddresses` deploy-time guard against missing/placeholder contract IDs.
- Real projected-daily-yield calculation replacing a static placeholder string.
- `CONTRIBUTING.md`.

## Fixes

- Duplicate PT/YT accounting against synthetic vault-rollup entries (double-counted totals/allocation%).
- Division-by-zero guards when the price oracle is unavailable.

## Security

- Stale TWAP no longer silently used — surfaced as `twapStale: true`, implied APY forced to 0.
- Oracle-failure fallback price (`0.1` XLM/USD) removed — surfaced as `priceUnavailable: true`, TVL forced to 0.

## Upgrade notes

- Breaking (UI-visible only): components that previously showed a computed number on stale/unavailable data now show explicit text ("Stale", "Price feed unavailable"). Any scraping of those numeric strings needs updating.
- No contract redeploy required — WASM unchanged from current testnet deployment.

## Deployment notes

- Network: Stellar Testnet, RPC `https://soroban-testnet.stellar.org`.
- Current epoch (`maturity_ledger: 4135061`) contract IDs are unchanged by this release — see `deployment-summary.md`.
- `deploy_epoch` now refuses to run if any required contract address is missing, empty, zero/burn, or a placeholder string.
