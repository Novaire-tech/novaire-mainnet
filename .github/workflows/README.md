# Novaire CI/CD

Monorepo: `contracts/` (Rust/Soroban workspace, 6 crates), `apps/web` (Next.js),
`apps/indexer`, `scripts/` (deploy/verify tooling, separate npm workspace).

## Workflows

| Workflow | File | Trigger | Purpose |
|---|---|---|---|
| CI | `ci.yml` | PR, push to `main`/`develop`, reusable | Rust fmt/clippy/test/audit/build (matrix per contract) + Node tsc/lint/test/build (web, indexer, scripts), parallel jobs, gated by `ci-gate` |
| Protocol Integrity | `protocol-integrity.yml` | PR/push touching `contracts/**`, reusable | Runs `cargo test -p integration_tests`, full workspace tests, NaN/Infinity scan, portfolio/allocation vitest. Fails immediately on invariant break. See `docs/PROTOCOL_INVARIANTS.md`. |
| Security | `security.yml` | PR, push, daily 03:17 UTC, reusable | gitleaks, custom secret/mnemonic/key pattern scan, `cargo audit`, unsafe-Rust detection, `npm audit` (root + scripts) |
| Deployment Validation | `deployment-validation.yml` | PR/push touching deployment files, manual, reusable | Validates `apps/web/src/config/deployments.{testnet,mainnet}.json` — required keys present, correctly shaped strkeys/wasm hashes, no placeholders/zero values |
| Verify Testnet | `verify-testnet.yml` | **Manual only** (`workflow_dispatch`) | Runs `npm run verify:testnet` against live Stellar Testnet, captures report/wallets/tx hashes; optional Playwright real-wallet/portfolio e2e with traces |
| Nightly | `nightly.yml` | Cron 02:00 UTC, manual | Calls protocol-integrity + security workflows, runs verify:testnet + dependency scan, produces nightly report |
| Release Validation | `release-validation.yml` | GitHub Release created, manual | Runs every gate above plus verify:testnet, produces `release-validation.md` + `deployment-summary.md`, fails release on any blocker |
| Dependabot | `../dependabot.yml` | Weekly (Monday) | Automated PRs for cargo (`contracts/`), npm (root + `scripts/`), GitHub Actions |

## Composite actions

- `.github/actions/setup-rust` — installs stable toolchain + wasm32 target + clippy/rustfmt + cargo-audit, caches `~/.cargo` and `contracts/target` keyed on `Cargo.lock`.
- `.github/actions/setup-node` — Node 20 with npm cache, runs `npm ci` at root (workspaces: `apps/*`, `packages/*`) and in `scripts/` (separate lockfile, not an npm workspace member).

## Manual triggers

```
gh workflow run verify-testnet.yml
gh workflow run verify-testnet.yml -f run_e2e_traces=true
gh workflow run nightly.yml
gh workflow run release-validation.yml -f run_verify_testnet=true
gh workflow run deployment-validation.yml
```

## Required GitHub Secrets

| Secret | Used by | Notes |
|---|---|---|
| `TESTNET_RPC` | verify-testnet, nightly, release-validation | Soroban Testnet RPC URL |
| `NETWORK_PASSPHRASE` | verify-testnet, nightly, release-validation | `Test SDF Network ; September 2015` for testnet |
| `MAINNET_RPC` | future mainnet deploy workflow | Not currently wired into any workflow above — add before enabling mainnet automation |
| `DEPLOYER_SECRET` | not used in CI today (deploys are manual/local) | **Do not** add to a workflow that runs on `pull_request` — only ever reference in `workflow_dispatch`/`release` jobs with required environment protection |
| `DATABASE_URL` | `ci.yml` (web build) | Falls back to a dummy local Postgres URL if unset so CI builds still succeed without a real DB |
| `GITHUB_TOKEN` | gitleaks-action | Auto-provided by Actions, no setup needed |

`BLEND_POOL`, `SY_WRAPPER_ID`, `TOKENIZER_ID`, `PT_TOKEN_ID`, `YT_TOKEN_ID`, `AMM_ID`: these live in `apps/web/src/config/deployments.{testnet,mainnet}.json`, not GitHub Secrets — `deployment-validation.yml` validates that file directly rather than duplicating the values as secrets.

Add secrets in **repo Settings → Secrets and variables → Actions**. Scope `DEPLOYER_SECRET` to a protected **Environment** (e.g. `mainnet-release`) with required reviewers if/when a real deploy-from-CI workflow is added — none of the workflows above currently deploy.

## Artifacts produced

- `rust-test-report`, `node-test-report-*`, `web-build`, `wasm-<contract>` (CI)
- `protocol-integrity-log` (Protocol Integrity)
- `verify-testnet-report`, `wallets.txt`, `transaction-hashes.txt`, `playwright-e2e-artifacts` (Verify Testnet)
- `nightly-report`, `nightly-verify-testnet-report` (Nightly)
- `release-validation-reports` (`release-validation.md`, `deployment-summary.md`) (Release Validation)

## Failure recovery

- **CI fails on `rust-fmt-clippy`**: run `cargo fmt --all` and `cargo clippy --fix` locally in `contracts/`, re-push.
- **Protocol Integrity fails**: read `docs/PROTOCOL_INVARIANTS.md` first — an invariant break here blocks merge by design; do not bypass with `continue-on-error`.
- **Security fails on gitleaks/secret-patterns**: rotate the exposed credential immediately (assume it's compromised), then scrub it from history (`git filter-repo` or BFG) before merging — removing it from HEAD alone doesn't clear the finding from history.
- **Deployment Validation fails**: the referenced `apps/web/src/config/deployments.*.json` key is missing, placeholder-shaped, or fails strkey/wasm-hash format checks — fix the manifest, don't disable the check.
- **verify:testnet fails**: inspect the `verify-testnet-report` artifact's `RESULT: FAIL` scenario; this hits live Testnet contracts, so also check Testnet RPC/Friendbot availability before assuming a code regression.
- **Release Validation fails**: read `release-validation.md` from the `release-validation-reports` artifact — it names every failed gate; the release should not be published until all gates are green.

## Performance notes

- All Rust jobs share a `cargo`+`target` cache keyed on `contracts/Cargo.lock`; wasm builds run as a matrix (one job per contract) so a slow contract doesn't block the others.
- All Node jobs use `actions/setup-node`'s built-in npm cache; `apps/web`, `apps/indexer`, `scripts` build/typecheck as a matrix.
- Every workflow triggered by `push`/`pull_request` has a `concurrency` group with `cancel-in-progress: true`, so superseded pushes don't burn runner time.
- `protocol-integrity.yml`, `security.yml`, `ci.yml`, `deployment-validation.yml` all declare `workflow_call`, so `nightly.yml` and `release-validation.yml` reuse them instead of duplicating steps.

## Recommended branch protection (`main`)

- Require a pull request before merging (no direct pushes)
- Require approvals: **2** (matches `CONTRIBUTING.md`'s "paired review" requirement for `contracts/` changes)
- Require status checks to pass: `ci-gate`, `Protocol Integrity gate`, `Security gate`, `Deployment Validation gate`
- Require branches to be up to date before merging
- Require conversation resolution before merging
- Require linear history
- Require signed commits (recommended, not yet enforced)
- Do not allow bypassing the above, including for admins

Same protections recommended for `develop`, with 1 required approval instead of 2.
