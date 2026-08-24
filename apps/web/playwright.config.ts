import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Default (1 worker per CPU) oversubscribes a single Next.js dev server:
  // every worker's first page.goto to a distinct route competes for the same
  // dev-server compile queue, so more workers made runs slower, not faster,
  // and produced spurious timeouts. Capping this is a resource fix, not a
  // timeout workaround -- the underlying tests are correct.
  workers: process.env.CI ? undefined : 3,
  forbidOnly: !!process.env.CI,
  // A single retry locally absorbs first-compile contention when several
  // workers hit distinct, not-yet-compiled Next.js dev routes at once --
  // the route is warm on any retry, so this isn't masking a real flake.
  retries: process.env.CI ? 2 : 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
    // Default (30s) is too tight for a cold Next.js dev-server compile under
    // fullyParallel contention; bump navigation specifically rather than the
    // whole per-test timeout.
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: [/.*\.real-wallet\.spec\.ts/, /.*\.e2e\.spec\.ts/, /.*\.bench\.spec\.ts/],
      use: { ...devices['Desktop Chrome'] },
      // Default 30s leaves too little headroom after a cold-compile page.goto
      // under fullyParallel contention -- raising navigationTimeout alone
      // doesn't help since the overall per-test budget was still the limit.
      timeout: 60_000,
    },
    {
      // Opt-in only: drives a real Freighter extension against live testnet.
      // Run via `npm run test:e2e:real`, not part of the default `chromium` project.
      name: 'real-wallet',
      testMatch: /.*\.real-wallet\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Opt-in only: records page-load timings for a fixed set of routes.
      // Run via `npm run bench:perf`. Not part of the default `chromium`
      // project since it measures timing, not correctness.
      name: 'bench',
      testMatch: /.*\.bench\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Opt-in only: full portfolio verification suite against real Stellar
      // Testnet contracts + a real Freighter extension. Run via
      // `npm run test:e2e:portfolio`. Always-on tracing since this is a
      // deliberately slow, infrequent suite where a failure's trace matters.
      name: 'portfolio-e2e',
      testMatch: /.*\.e2e\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], trace: 'on', screenshot: 'on' },
      timeout: 240_000,
    },
  ],
  webServer: {
    command: 'npm run dev -- -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
