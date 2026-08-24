# Contributing to Novaire

Thank you for considering a contribution to Novaire. This document describes the repository, the development environment, the quality gates every change must pass, and the conventions we expect contributors to follow.

Novaire is an **intent-based fixed-yield protocol** built on Stellar/Soroban. Contributions touch moving value and on-chain accounting, so we hold them to a high bar: the blast radius of a faulty merge — a broken yield calculation, a misplaced `authorize_as_current_contract`, an unguarded arithmetic operation — is measured in user funds, not hours of rework. Please read this document in full before opening a pull request.

---

## Table of Contents

- [Introduction](#introduction)
- [Repository Structure](#repository-structure)
- [Development Environment](#development-environment)
- [Getting Started](#getting-started)
- [Branch Strategy](#branch-strategy)
- [Coding Standards](#coding-standards)
- [Commit Convention](#commit-convention)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Smart Contract Development](#smart-contract-development)
- [Protocol Safety](#protocol-safety)
- [Security](#security)
- [Documentation Expectations](#documentation-expectations)
- [CI/CD](#cicd)
- [Review Guidelines](#review-guidelines)
- [Release Process](#release-process)
- [Code of Conduct](#code-of-conduct)
- [License](#license)

---

## Introduction

Novaire brings structured fixed income to the Stellar ecosystem. Users deposit a yield-bearing underlying asset (e.g. native XLM lent into a Blend Capital pool). The protocol wraps that asset into a Standardized Yield (SY) representation and splits it into two tradable components:

- **Principal Tokens (PT)** — represent the principal. Holding PT to maturity secures a fixed return.
- **Yield Tokens (YT)** — represent the variable yield stream of the underlying until maturity.

An **Intent Engine** contract routes multi-step user actions (deposit, mint PT/YT, swap, provide liquidity) so a user expresses a high-level goal in a single atomic transaction instead of orchestrating each Soroban call manually.

### Repository purpose

The monorepo holds the entire protocol and its surrounding tooling:

1. **`contracts/`** — the on-chain protocol: ten interrelated Soroban contracts written in Rust, plus an integration-test crate.
2. **`apps/web`** — a Next.js application: the frontend UI and the Next.js API routes that act as the backend. It reads all financial state live from the contracts over Soroban RPC; off-chain history uses a file-based JSON store (`history-store.json`), and waitlist/keeper-registration are flat-file/simulated placeholders. A Prisma/Postgres schema exists but is not populated at runtime today.
3. **`apps/indexer`** — a standalone service that polls Soroban RPC and mirrors on-chain events into the same Prisma database.
4. **`packages/bindings`** — generated TypeScript client bindings, one npm package per contract.
5. **`scripts/`** — deployment, bootstrap, smoke, and verification tooling against Stellar Testnet.

### Contribution philosophy

- **Correctness over velocity.** Protocol invariants must keep holding; tests must keep passing. When in doubt, prefer the code path that reverts loudly over one that silently produces a plausible-looking but wrong number.
- **Security by default.** Assume adversarial input. In on-chain code, use `checked_*` arithmetic, narrowly scoped authorization, and post-condition invariants (see [SECURITY.md](SECURITY.md)). In off-chain code, treat user input as attacker-controlled.
- **Small, reviewable pulls.** Prefer many focused PRs over one large one. Contract changes ship with their tests, regenerated bindings, and docs in the **same** PR.
- **Understand before changing.** Read `docs/PROTOCOL_INVARIANTS.md`, `docs/protocol/CONTRACTS.md`, and the existing tests for a component before assuming you know how it behaves.

### Code quality expectations

- No debug statements, commented-out code, or leftover `console.log` / `dbg!` / `println!` in merged code.
- No dead code, unused imports, or placeholder implementations.
- Every state-mutating contract change ships with tests.
- Every behavioral change documents itself: inline comments where the reasoning is subtle, and the relevant file under [`docs/`](docs/) when a protocol surface changes.

---

## Repository Structure

```
Novaire/
├── contracts/                          # Rust/Cargo workspace (Soroban contracts)
│   ├── factory/                       # Epoch deployment factory: deploys + wires each epoch's contract set
│   ├── intent_engine/                 # Routes multi-step user intents (mint, swap, deposit) atomically
│   ├── marketplace/                   # PT/underlying AMM with TWAP (20-ledger weighted EMA)
│   ├── maturity_engine/               # Single source of truth for epoch/maturity state machine
│   ├── rollover/                      # Rolls matured PT positions into the next epoch
│   ├── sy_wrapper/                    # Standardized Yield: wraps the external yield source
│   ├── tokenizer/
│   │   ├── tokenizer/                 # Mints/burns PT & YT in 1:1 against SY shares
│   │   ├── pt_token/                  # Principal Token implementation
│   │   └── yt_token/                  # Yield Token implementation
│   ├── vault/                         # Custody of the underlying asset on behalf of users
│   ├── integration_tests/             # Cross-contract tests: invariants, fuzz, M1/M2/M3/M5 regressions
│   ├── Cargo.toml                     # Workspace manifest, members, size-optimized release profile
│   └── target/                        # Build cache (git-ignored, local only)
├── apps/
│   ├── web/                           # Next.js frontend + private API routes (the backend)
│   │   ├── src/app/                   # Routes, layouts, and API routes (src/app/api/*)
│   │   ├── src/components/            # React UI components
│   │   ├── src/services/              # Protocol interaction / data-fetching logic
│   │   ├── src/config/, hooks/, lib/, providers/, types/, utils/
│   │   ├── e2e/                       # Playwright UI tests + real-wallet suites
│   │   ├── eslint.config.mjs
│   │   └── playwright.config.ts
│   └── indexer/                       # Standalone Soroban event poller → Prisma/Postgres (processor stubbed)
├── packages/
│   └── bindings/                      # Generated TS client bindings (one npm package per contract)
│       ├── factory/  marketplace/  tokenizer/  pt_token/  yt_token/
│       ├── vault/  sy_wrapper/  intent_engine/  rollover/
├── prisma/
│   └── schema.prisma                  # Postgres schema (web + indexer); schema-only at runtime today
├── scripts/                           # Deployment / bootstrap / smoke / verification tooling
│   ├── verify-testnet.ts              # `npm run verify:testnet` entrypoint
│   ├── verify_testnet/                # chain.ts, expected.ts, README.md
│   ├── utils.ts / utils.test.ts       # Shared script helpers + vitest suite
│   ├── deployments.testnet.json       # Live Testnet contract addresses
│   └── deployments.mainnet.json       # Historical/reference record only — not a live deployment
├── docs/
│   ├── PROTOCOL_INVARIANTS.md          # Source-of-truth invariant list, with code citations
│   ├── protocol/CONTRACTS.md           # Per-contract specification
│   └── architecture/ARCHITECTURE.md    # High-level architecture, layers, lifecycles
├── archive/root-dev-scripts/          # One-off debug/trace scripts — unmaintained, not part of the public interface
├── SECURITY.md                        # Security model, trust assumptions, vulnerability reporting
├── SECURITY_AUDIT.md                  # Internal audit report (SEC-01 … SEC-14) with remediation status
├── package.json                        # npm workspaces root (apps/*, packages/*)
├── .env.example                       # Template for environment configuration
└── CONTRIBUTING.md                    # This file

### Responsibility map

| Path | Responsibility |
| :--- | :--- |
| `contracts/` | All on-chain logic. Never touch PT/YT/yield accounting, Blend integration, or the AMM without a dedicated test and a security-minded review. |
| `apps/web` | User-facing UI and the only HTTP backend (the Next.js API routes under `src/app/api/*`). Reads all financial state live from the chain; history via the file-based `history-store.json`. |
| `apps/indexer` | Off-chain poller of on-chain events. Processor is currently stubbed — only the `SyncState` ledger cursor is written to Prisma/Postgres. Must tolerate RPC gaps and be safe to restart. |
| `packages/bindings/` | Generated code — do not hand-edit. Regenerate via deploy (Stellar CLI bindings) or per-package `npm run build`. |
| `scripts/` | Operational tooling. Scripts that write `deployments.<network>.json` are footguns; never run them against a network you don't intend. |
| `prisma/schema.prisma` | Postgres schema (nominally shared by web + indexer; only the indexer's cursor is written today). Changing it requires a migration and `prisma generate`. |
| `docs/` | Protocol/architecture knowledge. Treat `PROTOCOL_INVARIANTS.md` and `CONTRACTS.md` as authority. |
| `SECURITY.md`, `SECURITY_AUDIT.md` | Trust boundaries, severity classification, and audit history. No PR should silently weaken a stated trust assumption. |

> **Note:** There is **no top-level `tests/` directory and no `apps/backend`** — tests live inside `contracts/*/src/test.rs` (or `tests/` for `rollover`), `contracts/integration_tests/`, `apps/web` (vitest + Playwright), and `scripts/` (vitest). The backend is the API routes under `apps/web/src/app/api/*` plus the standalone `apps/indexer`.

---

## Development Environment

### Required tooling

| Tool | Version | Required for |
| :--- | :--- | :--- |
| **Node.js** | ≥ 20.9 (required by Next.js 16; no `engines` field is enforced — test against your Node) | Frontend, API routes, scripts, bindings, indexer |
| **npm** | ≥ 9 — **npm workspaces** are configured (`apps/*`, `packages/*`) and `package-lock.json` is the only lockfile | Everything that isn't Rust |
| **Rust + Cargo** | Recent stable toolchain (workspace pins `soroban-sdk = 22.0.11`) | Building the Soroban contracts |
| **WASM target** | `rustup target add wasm32-unknown-unknown` | Compiled Soroban WASM for building/testing contracts |
| **Stellar CLI** (`stellar`) | Any recent release | `npm run deploy` (build/upload/deploy/bindings; liquidity bootstrap runs inline) |
| **git** | any | everything |

Networking: RPC calls default to `https://soroban-testnet.stellar.org`. Verify the endpoints in your `.env` are reachable before running `deploy`/`verify:testnet`.

### Operating systems supported

- **Linux** and **macOS** are the primary, tested development environments.
- **Windows**: use Windows Subsystem for Linux (**WSL2**) with the Linux toolchain, and clone inside the Linux filesystem. Native Windows is not tested — the Rust WASM toolchain and Stellar CLI otherwise behave unpredictably.

### Environment variables

Create `.env` at the repo root from `.env.example` (`cp .env.example .env`). Only the following variables are actually read by the codebase:

| Variable | Consumed by | Description |
| :--- | :--- | :--- |
| `NETWORK` | `contracts/scripts/deploy-testnet-resilient.sh` | `testnet` (default) or `mainnet`. Selects RPC/passphrase and the `deployments.<network>.*` manifest. |
| `NETWORK_PASSPHRASE` | `contracts/scripts/deploy-testnet-resilient.sh` | Overrides the passphrase (defaults per `NETWORK`). |
| `BOOTSTRAP_AMOUNT` | `contracts/scripts/deploy-testnet-resilient.sh` | Amount used to seed initial liquidity (~12 XLM default). |
| `SKIP_BOOTSTRAP` | `contracts/scripts/deploy-testnet-resilient.sh` | If set to `true`, skips the automatic liquidity bootstrap step after deploy. |
| `NEXT_PUBLIC_RPC_URL` | Frontend (`apps/web`) | Soroban RPC the browser client talks to. |
| `NEXT_PUBLIC_NETWORK` | Frontend (`apps/web`) | `TESTNET` (default) or `MAINNET`; selects the deployment set in `apps/web/src/config/`. |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Frontend (`apps/web`) | Passphrase for client-side transaction building. |
| `DATABASE_URL` | `apps/indexer`, Prisma commands | Postgres connection string — needed only to run the indexer or Prisma tooling, **not** for the frontend (history is file-based). |
| `DATABASE_URL_UNPOOLED` | Prisma migrations | Unpooled Postgres connection string where a pooler is in use. |

**Never commit `.env`**, any `.env.*` variant, `*_keys.json`, or local files such as `testnet_keys.json` — see [Security](#security). The `.gitignore` already covers all of these; never force-add them.

---

## Getting Started

```bash
# 1. Clone (use your fork)
git clone <your-fork-url> && cd Novaire

# 2. Install JS dependencies (npm workspaces)
npm install

# 3. Environment (copy the template; defaults target Testnet)
cp .env.example .env
# No secrets are required for deploy — it auto-generates scripts/testnet_keys.json
# and seeds liquidity inline as part of the deploy script.
# Set DATABASE_URL only if you run the indexer or Prisma tooling.

# 4. Compile the Rust contracts (add the WASM target once)
rustup target add wasm32-unknown-unknown
```

The workspace does **not** require a global `stellar` install for frontend work — it is only needed for `npm run deploy`.

### Start the frontend

```bash
npm run dev          # Next.js dev server → http://localhost:3000
```

It reads `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_NETWORK`, and `NEXT_PUBLIC_NETWORK_PASSPHRASE` from `.env`, and contract addresses from `scripts/deployments.testnet.json`.

### Compile the contracts

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release   # size-optimized, LTO, overflow-checks on
cargo test                                             # unit + integration tests
```

A `release-with-logs` profile (debug assertions on) is available for debugging:

```bash
cargo build --profile release-with-logs
```

### Run the backend / data layer

The backend is two pieces:

1. **Next.js API routes** — served automatically by `npm run dev` / `npm start`:
   - `GET /api/prices`
   - `GET /api/markets`
   - `GET /api/history`, `POST /api/history/snapshot`, `POST /api/history/sync`
   - `POST /api/waitlist`

2. **Standalone indexer** — polls RPC for events on the contracts in `scripts/deployments.testnet.json` and writes into the same Prisma database:

   ```bash
   cd apps/indexer
   npx ts-node src/index.ts
   ```

After cloning or changing `prisma/schema.prisma`, regenerate the Prisma client:

```bash
npx prisma generate   # or npm run build, which includes it
```

### Run the SDK / bindings

```bash
cd packages/bindings/<contract-package>   # e.g. marketplace
npm run build    # tsc
```

Bindings are regenerated as part of `npm run deploy` via `stellar contract bindings`. If a PR changes a contract's interface, the regenerated bindings belong in the same PR.

### Run the verification tool

```bash
npm run verify:testnet
```

See [Runtime verification (`verify:testnet`)](#runtime-verification-verifytestnet).

---

## Branch Strategy

The default branch is **`master`** (there is no `main`). `master` must always be merge-ready. Use descriptive lowercase branches.

| Branch name | Purpose | Base off | Merge into |
| :--- | :--- | :--- | :--- |
| `master` | Trunk — must always be green | — | — |
| `feature/*` | New features (incl. new epochs) | `master` | `master` via squash-merged PR |
| `fix/*` | Bug fixes | `master` | `master` via squash-merged PR |
| `hotfix/*` | Emergency patch on a deployed/released contract set | `master` | `master` via squash-merged PR, then a deploy |
| `release/*` | Release candidate branch | `master` | `master` via squash-merged PR, then tagged |

Rules:

- Branch names are `kebab-case` and scoped: `feature/epoch-5`, `fix/portfolio-double-count`, `hotfix/marketplace-fee`, `release/epoch-4`.
- No long-lived topic branches and no direct pushes to `master`. All trunk changes arrive via squash-merged PRs with a clean Conventional Commit title.
- A `hotfix/*` must pass `npm run verify:testnet` against the **deployed** testnet epoch before merge, because it ships on-chain.

---

## Coding Standards

### TypeScript (frontend, API routes, scripts, bindings, indexer)

- **TypeScript strict.** No `@ts-ignore` and no `any` without an explicit justification comment; prefer typed domain models.
- **Formatting:** Prettier defaults applied via ESLint (`npm run lint`).
- **Naming:** `camelCase` for functions/variables, `PascalCase` for types and components, `UPPER_SNAKE_CASE` for module-level constants. React components are function components with a `type <X>Props` describing their props.
- **Organization:** I/O, protocol calls, and data fetching live in `apps/web/src/services/`; components stay presentational.
- **Error handling:** throw/return typed errors, never swallow them. API routes must return proper `4xx`/`5xx` responses and log structured errors.
- **Data shapes:** when you hand-author an `interface` for API/RPC data, validate or `assertType` it exactly once at the boundary; don't smuggle `any` through the rest of the app.

### Rust / Soroban (contracts)

- Formatting: `cargo fmt`; linting: `cargo clippy` (aim for `-D warnings`).
- **Use `checked_*` arithmetic everywhere** (`checked_add`, `checked_sub`, `checked_mul`, `checked_div`). Raw `*` / `/` between `i128` values are audit findings (see SEC-03 / SEC-04). The release profile sets `overflow-checks = true`; an overflow aborts the whole transaction.
- **Authorization:** any fund-moving function must `require_auth()` the owner/admin. Cross-contract moves use `env.authorize_as_current_contract()` scoped to a single `(contract, fn, args)` triple — never unrestricted sub-delegation.
- **Post-conditions:** state-mutating functions run `assert_invariant` before returning (pattern: `tokenizer/src/lib.rs`, list: `docs/PROTOCOL_INVARIANTS.md`). Never remove an invariant.
- **Storage TTL:** any persistent entry holding user balances/positions re-bumps its TTL (`extend_ttl`) on every read and write. Never regress this.
- **Events:** every user-relevant state change emits a descriptive event. Do not emit noise events for internal calls.
- **Errors:** no `unwrap()` in contract code — use custom error enums (`NovaireRolloverError::…` pattern) returned as `Result`.
- **Deps:** keep `soroban-sdk = 22.0.11` consistent across all workspace crates. Version skew between crates has been a live bug before.

### Soroban specifics

- Contracts are **immutable once deployed** — there is no upgradeable proxy. Protocol evolution happens by deploying a new epoch via `factory.deploy_epoch`. Never change non-upgradeable state assumptions lightly.
- Mind the per-transaction budget: prefer `i128` math over loops, avoid repeated storage lookups, keep hot-path logic lean. The release profile (opt-level `z`, LTO, codegen-units 1) is already set; `opt` decisions still matter inside hot paths.
- Never trust a value the protocol doesn't derive: maturity/epoint state is owned by `maturity_engine` and every other contract queries it rather than keeping local copies.

### Formatting / tooling summary

| Layer | Formatter | Linter | Test runner |
| :--- | :--- | :--- | :--- |
| Rust | `cargo fmt` | `cargo clippy` | `cargo test` |
| Frontend (web) | Prettier (via ESLint) | ESLint (`eslint.config.mjs`) | vitest + Playwright |
| Scripts | — | — | vitest (`npm run test:scripts`) |

### Comments & documentation

- Comment **why**, not what — intent, invariants, and off-by-one rationale.
- Link invariants to `docs/PROTOCOL_INVARIANTS.md` rather than duplicating them in code.
- Doc-comment every public Soroban function; keep module-level docs in each `lib.rs` in sync.

### Logging & observability

- Use structured, low-noise logs. The indexer logs start/stop, sync progress, RPC gaps, and failures — not every event.
- On-chain: rely on **events**, not `soroban` logs, for anything you need a durable trail for.

### Security expectations (general)

- Secrets exist only in `.env` / the environment — never in code, git, logs, or HTTP responses.
- Treat all API input as attacker-controlled. Don't trust `*` headers or raw bodies without validation.
- Never weaken a trust boundary documented in `SECURITY.md`; any such change must go through security review first (see [Security](#security)).

---

## Commit Convention

Every commit — and every merged PR title — follows **Conventional Commits**. We use scopes to keep the history greppable.

Prefixes:

| Prefix | Use when |
| :--- | :--- |
| `feat` | A new capability for users or the protocol |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `test` | Adding/updating tests or fixtures, no behavior change |
| `refactor` | A change that neither adds a feature nor fixes a bug |
| `perf` | A performance improvement |
| `chore` | Tooling, dependencies, scaffolding |
| `build` | Build-system changes (Cargo.toml, Dockerfile, etc.) |
| `ci` | CI configuration or scripts |
| `revert` | Reverting a prior commit |
| `deploy` | Deployment or contract-address registry changes |

Format:

```
<type>[optional scope]: <subject>

[optional body]

[optional footer(s)]
```

Common scopes: `contracts`, `web`, `indexer`, `bindings`, `scripts`, `prisma`, `docs`, `security`, `testnet`, `mainnet`.

Examples (mirroring the repo's own history):

```
feat(contracts): factory wire-protocols and cross-validates the full epoch before liveness
fix(contracts): correct Blend Capital bToken/b_rate accounting in SY Wrapper
fix(security): address outstanding issues in rollover and intent engine
docs(scripts): note inject_yield.ts is demo-only now that real b_rate accrual works
test(security): remediate SEC-14 (pt_token/yt_token unit coverage)
refactor(web): refine navbar to midnight-blue palette and compact layout
chore(prisma): add history snapshot migration
build(cargo): pin soroban-sdk 22.0.11 across all workspace crates
ci(web): run eslint + vitest on every PR
```

Rules:

- **One logical change per commit** — a PR is usually 1–5 commits; the squash-merge title is a clean `feat:` / `fix:` statement.
- Add a `BREAKING CHANGE` footer when the change alters a deployed ABI, a public endpoint, or a persisted DB field.
- **Never commit** machine-generated artifacts: `.next/`, `node_modules/`, `target/`, `test-results/`, `history-store.json` (see `.gitignore`).
- Link the motivating GitHub issue with `Refs:` / `Closes:` in the footer where one exists.

---

## Pull Request Process

### Before you open a PR

1. **Typecheck** — `npm run build` (the Next.js build runs its own typecheck and `prisma generate`).
2. **Lint** — `npm run lint`.
3. **Tests pass** —
   - Rust: `cd contracts && cargo test`
   - Web: `npm run test -w web` (vitest); plus `npm run test:e2e -w web` (Playwright) if you touched UI flows
   - Scripts: `npm run test:scripts`
4. **`npm run verify:testnet` passes** for any change to contract logic, deploy tooling, or price/portfolio math. See [Runtime verification](#runtime-verification-verifytestnet).
5. **No debug residue** — no `console.log`, `dbg!`, `println!`, commented-out blocks, or unused branches.
6. **Documentation updated** — in the relevant `docs/` files (Protocol / Architecture / Invariants) and README table, when the PR changes the surface.
7. **Screenshots included** when UI changed (dark & light theme; desktop and mobile where applicable).
8. **Bindings regenerated** if a contract ABI changed — regenerate via the deploy script's `stellar contract bindings` step (or per-package `npm run build`) and commit the diff.
9. Self-review the diff against the [Review Guidelines](#review-guidelines) before requesting review.

### PR description template

```markdown
## What
Short summary of the change in user/protocol terms.

## Why
Motivation: the bug, requirement, or invariant addressed.

## Scope
- [ ] contracts
- [ ] web
- [ ] indexer
- [ ] bindings (regenerated)
- [ ] scripts
- [ ] prisma
- [ ] docs

## Verification
- [ ] `cd contracts && cargo test`
- [ ] `npm run build && npm run lint`
- [ ] `npm run verify:testnet` (if protocol/oracle/portfolio math was touched)
- [ ] screenshots attached (UI)

## Risks / follow-ups
Migration, security, or gas implications; future work.
```

### Merge rules

- `master` advances only via **squash merge** of an approved PR.
- One maintainer approval is required for `apps/*`, `scripts/`, `packages/`, `docs/`; **two approvals** — including at least one tech-lead or security-focused reviewer — are required for changes under `contracts/`.
- Protocol changes additionally require a passing `npm run verify:testnet` before merge (see [Protocol Safety](#protocol-safety)).

---

## Testing

### Unit tests (per-contract Rust)

Live in `contracts/<contract>/src/test.rs` (and `contracts/rollover/tests/`) — run with the Soroban test harness (`#[cfg(test)]` + `testutils::Env`).

```bash
cd contracts
cargo test                # all workspace crates (unit + integration + regression/fuzz)
```

Snapshot tests live under `contracts/<contract>/test_snapshots/`. They capture the XDR snapshot of each test run and **must be regenerated** whenever a public method's behavior or storage layout changes (run the tests with the Soroban snapshot env to refresh them). Review the regenerated diffs carefully before committing them.

### Integration tests (cross-contract)

`contracts/integration_tests/` is a workspace crate exercising full flows — deposit → wrap → mint PT/YT → swap → settle — including:

- `journey.rs` — end-to-end user journeys (split/recombine, AMM swaps, flash routes, PT redemption).
- `economics.rs` — protocol-economics invariants, including `conservation_holds_across_random_sequences`: a 10,000-step randomized walk of deposit/split/transfer/claim/recombine/rate-change ops that asserts the escrow covers every holder's claim after *every* step, then checks post-maturity leftover dust stays within the expected floor-rounding bound. This test is inherently slow (~10k real Soroban host calls) — expect several minutes; that's expected, not a hang.
- `auth_invariants.rs` — access-control / authorization invariants.
- `blend_wrapper.rs` — Blend yield-source integration via the sy-wrapper.

```bash
cd contracts
cargo test -p integration_tests
```

### Frontend tests (vitest + Playwright)

```bash
npm run test -w web            # web unit tests (vitest)
npm run test:e2e -w web        # Playwright, chromium project
npm run test:e2e:real -w web   # opt-in suite with a real Freighter wallet
npm run test:e2e:portfolio -w web  # portfolio-focused suite with a real wallet
```

Real-wallet suites need a downloaded Freighter test extension first:

```bash
npm run vendor:freighter -w web
```

### Script tests (vitest)

```bash
npm run test:scripts
```

Covers `scripts/utils.ts` and friends.

### Runtime verification (`verify:testnet`)

[`scripts/verify_testnet/README.md`](scripts/verify_testnet/README.md) documents the local, **on-demand** tool that executes real signed testnet transactions against the deployed contracts (vault deposit, `mint_pt_yt`, `swap_underlying_for_pt`) and cross-checks the computed portfolio metrics — two independently implemented formulas from `verify_testnet/expected.ts` — against each other and against on-chain reads.

```bash
npm run verify:testnet
```

- It needs reachable testnet Soroban/Horizon/Friendbot endpoints.
- It fails fast if the deployed epoch has matured (redeploy first via `npm run deploy:epoch`).
- It is slow — real ledgers, ~minutes — and always creates/uses real testnet funding. Use `--deterministic` to reuse the same five wallets across runs.
- There are **no mocks and no browser automation** in this path: it verifies the protocol itself.

### Mandatory before merge

| Layer changed | Mandatory gates |
| :--- | :--- |
| **Contracts (Rust)** | `cd contracts && cargo test` **and** `npm run verify:testnet` |
| **Bindings** | per-package `npm run build` (bindings regenerate + compile) |
| **Web / API** | `npm run lint`, `npm run build`, `npm run test -w web` (+ e2e when UI changes) |
| **Indexer** | Typecheck via the workspace build; verify the indexer runs against current deployment |
| **Scripts / deploy metadata** | `npm run test:scripts` + a real run of the affected script |

---

## Smart Contract Development

Changes in `contracts/` are the highest-risk changes in the repo. The protocol has real invariants, with code citations, in [`docs/PROTOCOL_INVARIANTS.md`](docs/PROTOCOL_INVARIANTS.md) — read that file before writing code. The following is the practical checklist.

### If you change anything, check

- **Storage** — change storage keys only through contract functions; respect the TTL policy (`extend_ttl` on every access to user data); a storage layout change breaks immutability for live epochs.
- **Events** — the indexer (`apps/indexer/`) parses contract events. Non-backward-compatible event changes must ship together with the indexer change.
- **Authorization** — every fund-moving entrypoint hangs on `require_auth()`. Cross-contract calls use `authorize_as_current_contract` scoped to a single `(contract, fn, args)` triple. Prefer two-step patterns for admin handoffs (`transfer_admin`/`accept_admin`, staged tokenizer re-assignment) over single-step ones (SEC-06).
- **Replay protection / liveness** — never trust a caller-provided sequence number; users must always be able to exit (pause must not block `remove_liquidity` / `exit_rollover`).
- **Upgrade safety** — contracts are immutable post-deploy. If a change cannot coexist with the deployed ABI, it forces a new epoch deployment. Lean on `factory.deploy_epoch`'s cross-validation (metadata + wiring checks) rather than weakening it.
- **Gas / budget** — Soroban has per-transaction budgets. Avoid loops over user data, minimize storage reads, keep arithmetic direct. Budget-check your change (the tests print XDR budget) rather than assuming it fits.
- **Backward compatibility** — deployed epochs and off-chain services must keep working. New functions are additive; changed signatures are breaking and require binding + indexer + docs updates.
- **Security review** — every contract diff gets a second, security-trained paired reviewer. Anything on the [Protocol Safety](#protocol-safety) list needs explicit sign-off from both reviewers.

### Recommended workflow for a contract change

1. Write the failing test first — in `src/test.rs` or `integration_tests/` — covering the invariant or bug that motivates the change.
2. Implement the smallest surface change; keep `assert_invariants` post-conditions intact (or add new ones).
3. `cd contracts && cargo fmt && cargo clippy -- -D warnings && cargo test`.
4. If anything touches rates, balances, or pricing, run `npm run verify:testnet` against the current testnet deployment and confirm the expected PASS lines.
5. Regenerate bindings (`stellar contract bindings`) and commit them; never hand-edit `packages/bindings/`.

---

## Protocol Safety

These are the most safety-critical areas of the protocol. A bug here can silently misprice positions, break solvency, or route funds wrongly. **Do not merge a change touching them without all three:** rigorous tests, explicit paired review, and live on-chain verification (`verify:testnet`).

| Area | Where it lives | Why it is critical |
| :--- | :--- | :--- |
| **Yield accounting** | `contracts/sy_wrapper` (`refresh_rate`), `contracts/tokenizer` (`refresh_yield_index`, `add_accrued_yield`) | The exchange-rate numbers every price derives from; monotonicity / rate-limit / anti-inflation rules are load-bearing |
| **Portfolio accounting** | `apps/web/src/services/portfolioService.ts`, `scripts/verify_testnet/expected.ts` | What users are shown; a double-count bug (found once already) directly misleads |
| **PT/YT accounting** | `contracts/tokenizer`, `pt_token`, `yt_token` | PT == YT invariants, share-inflation protections, late-minter yield credit |
| **Blend integration** | `contracts/sy_wrapper` | The external yield source is trusted; a bad submit path or unverified address is systemic |
| **TWAP** | `contracts/marketplace` | Flash-loan/manipulation resistance; the slip-path gate uses `get_twap_rate_checked()` |
| **Oracle (on-chain rate/price)** | `sy_wrapper` exchange rate, `marketplace` price | The only price source; staleness and monotonicity must hold |
| **Deployment** | `contracts/scripts/deploy-testnet-resilient.sh` (build/deploy/wire/bootstrap) | A miswired deployment is caught only by the Deployment Verification checklist at best |

### Deployment verification (mandatory for every deploy, even a hotfix)

Because `blend_pool` is set once at `initialize` and cannot be rotated, the `factory.deploy_epoch` metadata cross-check cannot distinguish a genuine Blend pool from a convincing fake. Before anything is deployed:

- [ ] Confirm `blend_pool` matches the official Blend Capital registry for the **target network** (not a value copied from another epoch, a fork, or an unverified source).
- [ ] Confirm the pool's underlying asset matches the epoch's `underlying_token`.
- [ ] Record the verified address and the source used to verify it alongside the deployment.

Full steps: [SECURITY.md → Deployment Verification](SECURITY.md#deployment-verification-required-before-every-deploy).

### How a change to these areas gets merged

- The PR is labeled `contracts:` / `security:` and lists the affected invariant(s) from `PROTOCOL_INVARIANTS.md` in its description.
- Merge requires a second `contracts/` approval and a passing `npm run verify:testnet`.
- Post-condition invariants must be extended, never removed.

---

## Security

### Vulnerability reporting

Report security issues **privately** — never as a public GitHub issue. See [SECURITY.md → Vulnerability Reporting](SECURITY.md#vulnerability-reporting) for contact details and severity definitions.

- Include: affected contract(s)/function(s), a description of the issue, and a minimal reproduction wherever possible (test case, transaction sequence, or PoC). A clearly described theoretical issue with code citations is enough to start triage — no working exploit required.
- Do **not** publicly disclose until the maintainers have acknowledged and agreed to a response timeline (scope: ~48h acknowledgment, ~5 business days severity assessment at testnet stage).

### Responsible disclosure

- We ask reporters for **90 days** from acknowledgment (or until a fix ships — whichever is sooner) before any public disclosure.
- Critical/High issues affecting third-party components (e.g. Blend, Stellar/Stellar) should also be escalated to those parties by maintainers.

### Secrets policy

- `.env*` (except `.env.example`) and `*_keys.json` are git-ignored. **Never** force-add them.
- **Never commit** `testnet_keys.json` or any real funded-wallet mnemonic or private key.
- Rotate anything that ever slipped — including RPC service tokens and any key that was committed even once.
- Read secrets from the environment at run time, not from checked-in files. The root deploy scripts use `tsx --env-file=.env` which is fine for dev, not for CI.
- Never surface secrets in stack traces, errors, HAR exports, or the UI.
- Development uses **dedicated testnet-only keys** — never reuse a funded mainnet key.

### Responsibility for on-chain changes

You are responsible for the safety of anything you push on `contracts/` — the protocol moves user funds. Never run destructive epoch operations (archiving, settlements, test deploys) against a deployment others may rely on without coordinating with the maintainers first.

---

## Documentation Expectations

Every change that alters the behavior surface ships the docs update in the same PR:

| Doc | Update when… | Audience |
| :--- | :--- | :--- |
| **README.md** | commands, API table, tech stack, repo map change | new engineers, contributors, reviewers |
| [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) | the layered design, a flow, or a lifecycle changes | new hires, reviewers |
| [`docs/protocol/CONTRACTS.md`](docs/protocol/CONTRACTS.md) | a contract's behavior, functions, or storage changes | contract + reviewers |
| [`docs/PROTOCOL_INVARIANTS.md`](docs/PROTOCOL_INVARIANTS.md) | code that enforces or relaxes an invariant | the source of truth for all contract work |
| [`SECURITY.md`](SECURITY.md) | trust assumptions, threat responses, or the security model changes | contributors & security reporters |
| [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) | a referenced finding/remediation is addressed | maintainers, audit trails |

**Migration documentation:** if a DB shape or deployed-contract surface changes, add a migration/shortless fragment in the relevant doc so consumers can plan.

When a change adds config or constants that humans will reason about (fees, TTL policy, exchange-rate caps), document the accepted range in the README and the invariant doc alongside the code.

---

## CI/CD

### Current state

`.github/workflows/` is **empty today** — no automated CI pipeline exists in the repository yet. That means everything CI would enforce is enforced **locally**, by contributor, then checked **by reviewers** at merge time. The merge gates, in order, are:

1. `npm run lint` — ESLint (flat config `apps/web/eslint.config.mjs`).
2. `npm run build` — Prisma generate + Next.js build/typecheck for `apps/web`.
3. `cd contracts && cargo fmt --check && cargo clippy -- -D warnings && cargo test` — Rust formatting, lint-freedom, full unit/integration suite.
4. `npm run test:scripts` — vitest for `scripts/`.
5. `npm run verify:testnet` — live on-chain verification for any protocol-impacting change (manual, non-blocking at merge but required for release).
6. `npm run test:e2e -w web` — Playwright, where UI behavior changed.

### The CI we plan (and expect PRs to add)

The intended shape for `.github/workflows/` — and a great low-risk first PR — is a single `ci.yml`, blocking on every PR to `master`:

- `install` — `npm ci`
- `lint` — `npm run lint` (blocking)
- `web-build` — `npm run build` (blocking)
- `web-test` — `npm run test -w web` (blocking)
- `contracts-test` — `cd contracts && cargo fmt --check && cargo clippy -- -D warnings && cargo test` (blocking)
- `scripts-test` — `npm run test:scripts` (blocking)
- `e2e` — `npm run test:e2e -w web` (non-blocking, required for UI PRs)

`verify:testnet` must **not** run automatically from CI: it creates real testnet wallets and spends real funds. It is a manual step for maintainers / release runs. `npm run deploy` (which bootstraps liquidity inline) likewise runs manually with the appropriate `.env`.

Until a workflow exists, treat the local gates as blocking and reviewers should verify them against the PR diff before approving.

---

## Review Guidelines

Reviewers check the diff for more than style. For `contracts/`, a reviewer also runs through the [Protocol Safety](#protocol-safety) checklist.

- **Correctness** — does it do what the PR claims? Trace the actual flow, the auth paths, and the math on the real inputs.
- **Security** — auth boundaries, `checked_*` arithmetic, monotonicity/rate-limits, trust assumptions, and secrets handling.
- **Performance / gas** — new loops or storage reads; budget impact of a hot path; any raw `i128` multiply/divide warrants a `checked_*` question.
- **UX** — for UI: consistency with the design system, mobile behavior, color/text contrast across themes.
- **Architecture** — consistency with `docs/architecture` and the layer model; a change that reaches across layers is a red flag.
- **Tests** — do the **new** tests cover the failure mode, not just the happy path? Snapshot diffs regenerated and reviewed (not blindly committed)?
- **Documentation** — README / API / invariants updated, or an explicit note + follow-up issue for the gap.

Merging a large diff that changes direction mid-review should trigger a fresh review pass rather than a "rebased green" merge. `contracts/` merger is always two-eyes — a security second for anything touching user funds.

---

## Release Process

A release is a deployable, verifiable snapshot of `master` that exercises the epoch's full stack through testnet acceptance and security review.

### Pre-release checklist

- [ ] All tests green (workspace + `cargo test` + `npm run lint` + `npm run build`).
- [ ] **`npm run verify:testnet` passes** on the deployment to be released.
- [ ] Contracts compiled with the release profile; bindings regenerated and committed.
- [ ] Deployment executed: `npm run deploy` clean, `deployments.testnet.json` updated, inline liquidity bootstrap succeeded.
- [ ] [Deployment verification](SECURITY.md#deployment-verification-required-before-every-deploy) checklist enforced (Blend address verified against the registry).
- [ ] No Open Critical/High (P0/P1) findings scope the system exercising the epoch.
- [ ] Security review complete for every included contract change (two-reviewer sign-off).
- [ ] Documentation updated per [Documentation Expectations](#documentation-expectations).
- [ ] Release artifact generated (`cargo build --release` per contract + `npm run build`) and a smoke run recorded.
- [ ] The release is tagged and `CHANGELOG` updated to reflect the epoch/commit.

### After release

- Tag the release commit; record in `scripts/deployments.testnet.json` (already updated by `npm run deploy`).
- Anyone replaying the release should be able to do so from the tagged commit using README's "Deploying to Stellar Testnet".

---

## Code of Conduct

We expect every participant — maintainers and contributors alike — to behave so that collaboration stays productive:

- **Respectful.** Critique the code, not the person. Assume good intent.
- **Inclusive.** All skill levels welcome; contributions judged on technical merit alone.
- **Transparent.** Disclose conflicts of interest that might bias a review or a deployment decision.
- **Security-conscious.** Report destructive and security-sensitive issues through the [private channels](#security) first.

Zero tolerance for harassment, trolling, doxxing, or personal attacks. Report incidents directly to the maintainers.

---

## License

This repository is licensed under MIT — see [`LICENSE`](./LICENSE). Contributions are accepted under the same terms.

---

## Quick links

- [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) — protocol layers and lifecycles
- [`docs/protocol/CONTRACTS.md`](docs/protocol/CONTRACTS.md) — per-contract specification
- [`scripts/verify_testnet/README.md`](scripts/verify_testnet/README.md) — live protocol verification
- [`SECURITY.md`](SECURITY.md) and [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) — security and audit history