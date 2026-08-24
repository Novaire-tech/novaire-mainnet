import path from 'path';
import fs from 'fs';
import { chromium, type BrowserContext } from '@playwright/test';

// Populated by `apps/web/e2e/vendor/download-freighter.sh` (run via the
// `pretest:e2e:real` npm script) — never checked into git, see
// apps/web/e2e/vendor/README.md for the pinned version/checksum.
export const FREIGHTER_EXTENSION_PATH = path.resolve(__dirname, '../vendor/freighter-extension');

export function assertFreighterExtensionVendored(): void {
  if (!fs.existsSync(path.join(FREIGHTER_EXTENSION_PATH, 'manifest.json'))) {
    throw new Error(
      `Freighter extension not found at ${FREIGHTER_EXTENSION_PATH}. ` +
        'Run `npm run vendor:freighter` (apps/web/e2e/vendor/download-freighter.sh) first.',
    );
  }
}

// Freighter's MV3 background service worker only starts in a real (non-headless)
// Chromium session with the extension loaded via --load-extension, so the
// real-wallet spec needs its own persistent context rather than the shared
// `chromium` Playwright project.
// Overridable so CI/other machines can point at wherever Brave is installed.
const BRAVE_EXECUTABLE_PATH = process.env.BRAVE_EXECUTABLE_PATH || '/usr/bin/brave-browser';

export async function launchWithFreighter(): Promise<BrowserContext> {
  assertFreighterExtensionVendored();
  return chromium.launchPersistentContext('', {
    headless: false,
    executablePath: BRAVE_EXECUTABLE_PATH,
    args: [
      `--disable-extensions-except=${FREIGHTER_EXTENSION_PATH}`,
      `--load-extension=${FREIGHTER_EXTENSION_PATH}`,
    ],
  });
}

// The extension id is only stable if the vendored manifest pins a `key`; treat
// it as dynamic and discover it from the running context instead of hardcoding it.
export async function getFreighterExtensionId(context: BrowserContext): Promise<string> {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  }
  const url = new URL(worker.url());
  return url.host;
}
