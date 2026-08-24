import { test, expect } from '@playwright/test';
import { rpc } from '@stellar/stellar-sdk';
import { assertNotMatured } from './lib/chain';
import { openDepositModal } from './helpers/vault-page';
import { createFundedTestnetAccount } from './fixtures/testnet-account';
import { launchWithFreighter } from './fixtures/freighter-extension';
import { onboardFreighter, approveConnection, approveSignature } from './fixtures/freighter-onboarding';

/**
 * Real-wallet, real-testnet coverage for the deposit flow: a fresh keypair is
 * generated and funded via Friendbot, imported into a genuine Freighter
 * extension, and used to sign and submit an actual on-chain deposit against
 * the currently deployed Intent Engine contract (see
 * apps/web/src/config/deployments.testnet.json).
 *
 * Opt-in only (`npm run test:e2e:real`) — unlike deposit.spec.ts this depends
 * on live testnet/Horizon/Friendbot availability and on the vendored
 * Freighter extension's UI (apps/web/e2e/vendor/README.md), so it must not
 * block ordinary PRs.
 */

const RPC_URL = 'https://soroban-testnet.stellar.org';

test.describe('Deposit flow (real Freighter wallet, live testnet)', () => {
  test('submits and confirms a deposit on-chain', async ({}, testInfo) => {
    testInfo.setTimeout(180_000);

    const server = new rpc.Server(RPC_URL, { allowHttp: true });
    let matured = false;
    try {
      await assertNotMatured(server);
    } catch {
      matured = true;
    }
    test.skip(matured, 'testnet fixture matured — redeploy contracts with a future maturity before running this test.');

    const account = await createFundedTestnetAccount();

    const context = await launchWithFreighter();
    try {
      await onboardFreighter(context, account);

      const page = await context.newPage();
      const modal = await openDepositModal(page);

      await approveConnection(context, async () => {
        await modal.getByRole('button', { name: 'Connect Wallet' }).click();
      });

      const amountInput = modal.getByPlaceholder('0.00');
      await amountInput.fill('10');

      let signedTxHash: string | undefined;
      page.on('response', async (response) => {
        if (!response.url().startsWith(RPC_URL)) return;
        const body = await response.json().catch(() => null);
        if (body?.result?.hash) signedTxHash = body.result.hash;
      });

      await approveSignature(context, async () => {
        await modal.getByRole('button', { name: 'Review Transaction' }).click();
      });

      // App-level success confirmation.
      await expect(modal.getByText(/success|confirmed/i)).toBeVisible({ timeout: 120_000 });

      // Independent, decoupled confirmation directly against the chain.
      expect(signedTxHash, 'expected a submitted transaction hash to be captured from RPC traffic').toBeTruthy();
      await expect
        .poll(
          async () => {
            const result = await server.getTransaction(signedTxHash!);
            return result.status;
          },
          { timeout: 120_000, message: 'transaction did not reach SUCCESS on testnet' },
        )
        .toBe('SUCCESS');
    } finally {
      await context.close();
    }
  });
});
