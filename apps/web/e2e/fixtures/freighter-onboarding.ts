import { type BrowserContext, type Page } from '@playwright/test';
import { getFreighterExtensionId } from './freighter-extension';

/**
 * Drives Freighter's real extension UI. These selectors target the extension's
 * own onboarding/popup screens, which this repo does not control — re-verify
 * them whenever the vendored Freighter version (apps/web/e2e/vendor/README.md)
 * is bumped.
 */

const EPHEMERAL_PASSWORD = 'E2eTestOnly-Password-1!';

// Confirmed against a live Freighter 5.44.0 build (see
// apps/web/e2e/vendor/README.md for the pinned version): the "welcome"
// screen's "I already have a wallet" leads straight to a password-creation
// step (#/recover-account with no fields yet), *then* to the actual
// 12-word mnemonic entry (still under #/recover-account) — Freighter only
// accepts a mnemonic here, never a raw secret key. On success it navigates
// to #/recover-account-success.
export async function onboardFreighter(
  context: BrowserContext,
  account: { mnemonic: string },
): Promise<void> {
  const extensionId = await getFreighterExtensionId(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);

  await page.getByText('I already have a wallet').click();
  await page.locator('#new-password-input').fill(EPHEMERAL_PASSWORD);
  await page.locator('#confirm-password-input').fill(EPHEMERAL_PASSWORD);
  // Freighter's terms checkbox is a custom SVG control whose visible label
  // intercepts plain clicks; force-checking the underlying input is reliable.
  await page.locator('#termsOfUse-input').check({ force: true });
  await page.getByTestId('account-creator-submit').click();

  const words = account.mnemonic.split(' ');
  for (let i = 0; i < words.length; i++) {
    await page.locator(`#MnemonicPhrase-${i + 1}`).fill(words[i]);
  }
  await page.getByRole('button', { name: 'Import' }).click();
  await page.waitForURL(/#\/recover-account-success/, { timeout: 20_000 });

  // TODO(unverified): confirm the exact selector for switching the active
  // network to Testnet once this runs against a live app connection — the
  // network toggle lives behind the account header's globe icon, but the
  // click target wasn't pinned down before this fixture was written. If the
  // vendored build already defaults to Testnet this may be a no-op; verify
  // and delete this comment once confirmed.

  await page.close();
}

// Handles the popup Freighter opens when the dApp calls requestAccess().
export async function approveConnection(context: BrowserContext, trigger: () => Promise<void>): Promise<void> {
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    trigger(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  await popup.getByRole('button', { name: /connect|approve/i }).click();
}

// Handles the popup Freighter opens when the dApp calls signTransaction().
export async function approveSignature(context: BrowserContext, trigger: () => Promise<void>): Promise<void> {
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    trigger(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  await popup.getByRole('button', { name: /sign|confirm|approve/i }).click();
}

export type { Page };
