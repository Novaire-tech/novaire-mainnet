# Testnet Portfolio Verification

A local, on-demand developer tool that verifies Novaire's portfolio math
against **real Stellar Testnet contracts** — no mocks, no CI, nothing runs
automatically. You run it, it does real things on Testnet, and it prints a
PASS/FAIL report.

```
npm run verify:testnet
```

## What it actually does

1. Creates 5 fresh (or deterministic, see below) Testnet keypairs.
2. Funds each via Friendbot, waiting until the Soroban RPC node itself (not
   just Horizon) can see the account — the two are independently-indexed
   backends and Horizon settles first, which caused real "Account not
   found" failures during development of this tool.
3. Signs and submits real transactions against the deployed contracts
   (`scripts/deployments.testnet.json`): `vault.deposit`,
   `tokenizer.mint_pt_yt`, `marketplace.swap_underlying_for_pt`.
4. Waits for each transaction to reach `SUCCESS` via `getTransaction`.
5. Reads every balance directly from the contracts (`vault.balance_of`,
   `pt_token.balance`, `yt_token.balance`, `yt_token.claimable_yield`,
   `marketplace.get_pt_price`) — never from the frontend.
6. Computes expected portfolio metrics **two independent ways** — a
   from-scratch derivation (`computeIndependent`) and a separate
   transcription of the app's actual formula
   (`computeAppFormula`, mirroring `apps/web/src/services/portfolioService.ts`)
   — and compares them to each other, and to the raw on-chain numbers, with
   a `0.000001` tolerance.
7. Prints every check as `[PASS]`/`[FAIL]` with the transaction hashes,
   wallet addresses, and expected-vs-actual values, and exits non-zero if
   anything failed.

## The 5 scenarios

| # | Scenario | Proves |
|---|---|---|
| A | Empty wallet | No positions → Total Invested = 0, Est. Daily Yield = 0, everything finite |
| B | Vault deposit only | Raw Vault LP balance, invested total, allocation = 100%, daily yield |
| C | PT purchase via protocol (deposit + `mint_pt_yt`) | PT balance, portfolio value |
| D | Vault LP + secondary-market PT purchase | Both positions coexist, are additive, no overwrite, no duplicate counting, allocation sums to exactly 100% |
| E | Claimable yield | The `xlmPriceUsd > 0 ? usd / xlmPriceUsd : 0` guard never produces `Infinity`/`NaN` |

## Known, deliberate scope limits (not bugs in this tool)

- **Scenario D** depends on the Marketplace AMM having liquidity seeded for
  the current epoch. If `swap_underlying_for_pt` reverts with no liquidity,
  the scenario prints `SKIPPED` with the reason — it does not fake a pass.
- **Scenario E** cannot manufacture real accrued yield: `yt_token` has no
  user-callable claim/accrual transaction in the currently deployed
  contract version — accrual is driven by admin/epoch calls
  (`add_accrued_yield`, `update_yield_index`), not by a wallet's own
  actions. The scenario always verifies the safe-math guard; to also verify
  the nonzero-conversion path, point it at a wallet that already has
  accrued yield:
  ```
  VERIFY_YIELD_WALLET_SECRET=S... npm run verify:testnet
  ```

## A real bug this tool found (fixed)

Running it against live Testnet surfaced a genuine, previously-undetected
issue in `apps/web/src/services/portfolioService.ts`: **`totalValueUsd`
("Portfolio Value") double-counted tokenized positions.** PT/YT value was
added once as standalone `pt`/`yt` asset entries, then added *again* via the
synthetic `vault` entry that represents the same underlying value
(`currentVaultValue = ptValueUsd + ytValueUsd`, also summed into
`totalValueUsd`) — Scenario C failed with an exact 2x mismatch. Fixed by no
longer adding `currentVaultValue` to `totalValueUsd` (that money is already
counted via the PT/YT entries) and excluding that rollup entry from the
allocation-percentage loop (it's a display summary for
`VaultPositionsTable`, not an independent value bucket) so allocation still
sums to exactly 100%. `computeAppFormula` in `expected.ts` was updated to
match. All 5 scenarios now pass live against Testnet.

## Options

- `--deterministic` — derive the 5 wallets from fixed seed strings instead
  of `Keypair.random()`, so repeat runs reuse the same addresses (useful for
  watching a wallet build up state across runs, or debugging with a block
  explorer). Positions accumulate across runs since nothing is ever reset
  on-chain — expect growing balances, not identical numbers, run to run.
- `VERIFY_YIELD_WALLET_SECRET=<secret>` — see Scenario E above.

## Files

- `scripts/verify-testnet.ts` — orchestrator; run this.
- `scripts/verify_testnet/chain.ts` — wallet/funding/transaction helpers
  (`createWallet`, `deterministicWallet`, `fundWallet`, `waitForTransaction`,
  `depositVault`, `mintPTYT`, `buyPT`, `readOnChainState`,
  `readClaimableYield`, `withRetry`, `settleAfterConfirmation`).
- `scripts/verify_testnet/expected.ts` — the two independent formula
  implementations and the tolerance-based comparator.

## Requirements

- Network access to `soroban-testnet.stellar.org`, `horizon-testnet.stellar.org`,
  and `friendbot.stellar.org`.
- The deployed fixture (`scripts/deployments.testnet.json`) must not have
  matured — the script checks this and fails fast with a clear message if
  it has (redeploy via `npm run deploy:epoch` first).
- Takes a few minutes: each scenario funds a wallet, submits 1-2
  transactions, and waits for ledger confirmation.

## Explicitly NOT part of this

Per the scope this was built to: **no GitHub Actions, no CI configuration,
no deployment changes, no automatic execution.** It only runs when you type
`npm run verify:testnet`. (A separate opt-in Playwright-based suite exists
at `apps/web/e2e/portfolio.e2e.spec.ts` / `npm run test:e2e:portfolio` for
browser/UI-level verification with a real Freighter wallet — this tool is
the protocol-level counterpart and doesn't touch a browser at all.)
