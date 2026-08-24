import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Records page-load timing for a fixed set of routes against a running dev
 * server. Not a correctness check — routes are visited regardless of what
 * they render, so this stays useful even if a page needs a wallet/testnet
 * connection to show real data. Run via `npm run bench:perf` (project
 * `bench`, see playwright.config.ts). Writes JSON to
 * ../../../benchmarks/results/web-perf.json for the aggregate bench report.
 */

const ROUTES = ['/', '/app', '/app/markets', '/app/trade'];

type Timing = {
  route: string;
  ttfbMs: number;
  domContentLoadedMs: number;
  loadMs: number;
};

async function measure(page: Page, route: string): Promise<Timing> {
  await page.goto(route, { waitUntil: 'load' });
  const nav = await page.evaluate(() => {
    const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return {
      ttfbMs: entry.responseStart - entry.requestStart,
      domContentLoadedMs: entry.domContentLoadedEventEnd - entry.startTime,
      loadMs: entry.loadEventEnd - entry.startTime,
    };
  });
  return { route, ...nav };
}

test('records page-load timings for key routes', async ({ page }) => {
  const results: Timing[] = [];
  for (const route of ROUTES) {
    results.push(await measure(page, route));
  }

  const outDir = join(__dirname, '..', '..', '..', 'benchmarks', 'results');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'web-perf.json'), JSON.stringify(results, null, 2));

  // eslint-disable-next-line no-console
  console.table(results);
});
