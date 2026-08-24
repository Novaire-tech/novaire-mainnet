# CI/CD

Novaire is a monorepo: a Rust/Soroban contract workspace (`contracts/`, 6 crates),
two Node/TypeScript apps (`apps/web` — Next.js, `apps/indexer`), and a standalone
tooling workspace (`scripts/` — deploy/verify scripts, its own lockfile, not an npm
workspace member). CI is implemented entirely in GitHub Actions under `.github/`.

This file is the human entry point. The authoritative, always-current description of
every workflow (triggers, jobs, artifacts, required secrets, failure recovery) lives in
[`.github/workflows/README.md`](.github/workflows/README.md) — read that for details;
this file summarizes how to reproduce CI locally and what's required before merge.

## What runs, and when

| Workflow | Trigger | What it checks |
|---|---|---|
| `ci.yml` | every PR, push to `main`/`develop` | Rust fmt/clippy/test/audit/build (per-contract wasm matrix) + Node tsc/lint/test/build for `web`, `indexer`, `scripts` |
| `protocol-integrity.yml` | PR/push touching `contracts/**` | Invariant test suites, full workspace tests, NaN/Infinity accounting scan, portfolio/allocation vitest |
| `security.yml` | every PR, push, daily 03:17 UTC | gitleaks, custom secret/mnemonic/key pattern scan, `cargo audit`, unsafe-Rust detection, `npm audit` |
| `code-quality.yml` | every PR, push | Configurable scan for TODO/FIXME/console.log/debugger/hardcoded values |
| `docs-validation.yml` | every PR, push, manual | Confirms required docs exist and are non-empty |
| `deployment-validation.yml` | PR/push touching deployment manifests, manual | Validates `scripts/deployments.{testnet,mainnet}.json` shape |
| `dependency-review.yml` | PR touching `Cargo.toml`/`Cargo.lock`/`package.json`/`package-lock.json` | GitHub dependency-review-action, fails on high-severity advisories in the diff |
| `verify-testnet.yml` | manual only | Live Stellar Testnet run + optional Playwright real-wallet e2e |
| `nightly.yml` | cron 02:00 UTC, manual | Reuses protocol-integrity + security, plus verify:testnet and dependency scan |
| `release-validation.yml` | GitHub Release created, manual | Every gate above plus verify:testnet; produces release/deployment reports |
| Dependabot (`dependabot.yml`) | weekly (Monday) | Opens PRs for cargo (`contracts/`), npm (root + `scripts/`), GitHub Actions — same as any other PR, these automatically trigger `ci.yml`, `security.yml`, `code-quality.yml`, `docs-validation.yml`, and `dependency-review.yml` |

Dependabot needs no special wiring: its PRs are ordinary `pull_request` events, so every
workflow above that triggers on `pull_request` runs against them automatically. Dependabot
only opens PRs and manages dependency metadata — it never bypasses CI.

## Reproducing CI locally

### Rust / Soroban (run from `contracts/`)

```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features --workspace -- -D warnings
cargo test --workspace --all-features
cargo audit --file Cargo.lock
cargo build --release --target wasm32-unknown-unknown -p <contract-crate>
```

Contract crates: `sy-wrapper`, `tokenizer`, `pt-token`, `yt-token`, `amm`, `blend-adapter`, `shared/types`, `integration_tests`.

### TypeScript / JavaScript

```bash
npm ci                    # root workspaces: apps/*, packages/*
npm ci --prefix scripts   # scripts/ has its own lockfile

npx tsc --noEmit          # in apps/web, apps/indexer, scripts
npm run lint -w web
npx vitest run            # in apps/web, apps/indexer, scripts
npm run build -w web
npm run build --if-present --prefix apps/indexer
```

### Security

```bash
cargo audit --file Cargo.lock --deny warnings   # in contracts/
npm audit --audit-level=high                    # in root and scripts/
bash .github/scripts/scan-secrets.sh            # custom wallet/mnemonic/key pattern scan
```
`gitleaks` runs only in Actions (via `gitleaks/gitleaks-action@v2`); there is no bundled
local equivalent — install the [gitleaks CLI](https://github.com/gitleaks/gitleaks) and run
`gitleaks detect --config .github/gitleaks.toml` to reproduce it locally.

## Debugging a failed CI run

1. Open the failing job in the Actions tab and check whether it failed on a specific
   step (compile error, test assertion, lint rule) vs. the aggregating `*-gate` job — the
   gate job only reports which of its dependencies failed, the real error is in that
   dependency's log.
2. Reproduce the exact failing command from the tables above, in the matching
   directory (`contracts/`, `apps/web`, `apps/indexer`, or `scripts/`).
3. Common fixes:
   - `rust-fmt-clippy` fails → `cargo fmt --all && cargo clippy --fix --allow-dirty` in `contracts/`.
   - `protocol-integrity` fails → this gate blocks merge by design, do not bypass with `continue-on-error`.
   - `security` fails on gitleaks/secret-patterns → assume the credential is compromised, rotate it, then scrub it from git history (it isn't enough to remove it from HEAD).
   - `deployment-validation` fails → fix `scripts/deployments.*.json`, don't disable the check.
4. Download job artifacts (test reports, coverage, nightly/release reports) from the run summary for full output beyond what's printed in the log.

Full recovery notes per workflow are in
[`.github/workflows/README.md#failure-recovery`](.github/workflows/README.md).

## Secrets and safety

- No workflow prints secret values to logs; `DATABASE_URL` falls back to a dummy local Postgres URL in `ci.yml` when unset so builds don't require a real secret.
- `DEPLOYER_SECRET` is never referenced by any `pull_request`-triggered workflow — only `workflow_dispatch`/release jobs may use it, and only behind a protected GitHub Environment.
- Required secrets and their scope are documented in [`.github/workflows/README.md#required-github-secrets`](.github/workflows/README.md).

## Required status checks before merge

Configure these as required status checks in **Settings → Branches → Branch protection** for `main` (and `develop` with a lower approval count) — see [`.github/workflows/README.md#recommended-branch-protection-main`](.github/workflows/README.md) for the full recommended ruleset:

- `ci-gate`
- `Protocol Integrity gate`
- `Security gate`
- `Documentation Validation / check-required-docs`
- `Deployment Validation gate`

This repository does not modify branch protection automatically — enabling these is a manual step in GitHub repo settings.
