import { test, expect, type Page, devices } from '@playwright/test';

/**
 * Fast, deterministic UI-behavior coverage for the dashboard KPI tooltip and
 * layout — the parts of the RC "UI Verification" checklist that don't need a
 * live wallet/testnet (that part is e2e/portfolio.e2e.spec.ts). Wallet +
 * Soroban RPC are mocked the same way deposit.spec.ts does it, so this runs
 * in the default `chromium` project on every PR.
 */

const RPC_URL = 'https://soroban-testnet.stellar.org';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const MOCK_ADDRESS = 'GBDTV2XZIDNAIBJBADA5QMVRMY5RVPQ7IFKVOWY2BKFDXCDWLPIPRT7I';

async function mockFreighterWallet(page: Page) {
  await page.addInitScript((address) => {
    (window as unknown as { freighter: boolean }).freighter = true;
    window.addEventListener('message', (event) => {
      const data = (event as MessageEvent).data;
      if (!data || data.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return;
      const respond = (payload: Record<string, unknown>) => {
        window.postMessage({ source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId: data.messageId, ...payload }, window.location.origin);
      };
      switch (data.type) {
        case 'REQUEST_CONNECTION_STATUS':
          return respond({ isConnected: true });
        case 'REQUEST_PUBLIC_KEY':
        case 'REQUEST_ACCESS':
          return respond({ publicKey: address });
        case 'REQUEST_NETWORK':
          return respond({ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' });
        case 'REQUEST_ALLOWED_STATUS':
          return respond({ isAllowed: true });
        default:
          return respond({});
      }
    });
  }, MOCK_ADDRESS);
}

async function mockHorizonBalance(page: Page) {
  await page.route(`${HORIZON_URL}/accounts/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balances: [{ asset_type: 'native', balance: '1000.0000000' }] }) }),
  );
}

function mockSorobanRpc(page: Page) {
  return page.route(RPC_URL, (route) => {
    const body = route.request().postDataJSON();
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'mocked RPC: no live network in e2e test' } }),
    });
  });
}

test.describe('Dashboard KPI UI', () => {
  test.beforeEach(async ({ page }) => {
    await mockFreighterWallet(page);
    await mockHorizonBalance(page);
    await mockSorobanRpc(page);
  });

  test('loads with no console errors, no failed requests, and the correct KPI label', async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(err.message));
    page.on('requestfailed', (req) => failedRequests.push(`${req.url()} — ${req.failure()?.errorText}`));

    await page.goto('/app');
    await expect(page.getByText('Est. Daily Yield')).toBeVisible();

    expect(consoleErrors, `unexpected console errors: ${JSON.stringify(consoleErrors)}`).toEqual([]);
    expect(failedRequests, `unexpected failed requests: ${JSON.stringify(failedRequests)}`).toEqual([]);
  });

  test('never renders NaN, Infinity, undefined, or null literals', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByText('Est. Daily Yield')).toBeVisible();
    const bodyText = await page.locator('body').innerText();
    for (const bad of ['NaN', 'Infinity', 'undefined', 'null']) {
      expect(bodyText).not.toContain(bad);
    }
  });

  test('Est. Daily Yield tooltip opens on hover (desktop)', async ({ page }) => {
    await page.goto('/app');
    const label = page.getByText('Est. Daily Yield');
    await expect(label).toBeVisible();
    const trigger = label.locator('..').getByRole('button', { name: /more info/i });
    await trigger.hover();
    await expect(page.getByRole('tooltip')).toBeVisible();
  });

  test('Est. Daily Yield tooltip opens on tap (mobile viewport)', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await context.newPage();
    await mockFreighterWallet(page);
    await mockHorizonBalance(page);
    await mockSorobanRpc(page);

    await page.goto('/app');
    const label = page.getByText('Est. Daily Yield');
    await expect(label).toBeVisible();
    const trigger = label.locator('..').getByRole('button', { name: /more info/i });
    // Touch devices don't hover — the button must open the tooltip on tap/click.
    await trigger.click();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await context.close();
  });

  test('Est. Daily Yield tooltip is keyboard-accessible', async ({ page }) => {
    await page.goto('/app');
    const label = page.getByText('Est. Daily Yield');
    await expect(label).toBeVisible();
    const trigger = label.locator('..').getByRole('button', { name: /more info/i });

    await trigger.focus();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('tooltip')).toBeVisible();

    const describedBy = await trigger.getAttribute('aria-describedby');
    const tooltipId = await page.getByRole('tooltip').getAttribute('id');
    expect(describedBy).toBe(tooltipId);
  });

  test('KPI grid does not shift layout after data loads (no CLS from skeleton -> value swap)', async ({ page }) => {
    await page.goto('/app');
    const grid = page.locator('.grid').first();
    const before = await grid.boundingBox();
    await expect(page.getByText('Est. Daily Yield')).toBeVisible();
    await page.waitForTimeout(500);
    const after = await grid.boundingBox();
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    // Height must not grow/shrink once the KPI row is present — skeletons and
    // real values share `min-h` sizing (see MetricCard.tsx) precisely to
    // prevent this.
    expect(Math.abs((after!.height ?? 0) - (before!.height ?? 0))).toBeLessThanOrEqual(6);
  });

  test('dashboard renders at mobile viewport width without horizontal overflow', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await context.newPage();
    await mockFreighterWallet(page);
    await mockHorizonBalance(page);
    await mockSorobanRpc(page);

    await page.goto('/app');
    await expect(page.getByText('Est. Daily Yield')).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, 'page must not overflow horizontally at mobile width').toBeLessThanOrEqual(clientWidth + 1);
    await context.close();
  });
});
