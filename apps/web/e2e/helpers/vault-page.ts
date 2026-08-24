import { expect, type Page, type Locator } from '@playwright/test';

// Opens the deposit modal and returns a locator scoped to it, so queries
// don't collide with identically-labelled elements on the page behind it.
export async function openDepositModal(page: Page): Promise<Locator> {
  await page.goto('/app/vaults');
  await page.getByRole('button', { name: 'Deposit' }).first().click();
  const heading = page.getByRole('heading', { name: 'Mint PT & YT' });
  await expect(heading).toBeVisible();
  return heading.locator('../..');
}
