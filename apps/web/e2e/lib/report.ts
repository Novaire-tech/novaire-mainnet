// Accumulates results across the portfolio E2E suite and renders
// e2e-report.md at the end. Each spec calls recordResult() as it verifies a
// wallet; a Playwright globalTeardown (see playwright.config.ts) calls
// writeReport() once after the run.
import fs from 'fs';
import path from 'path';

export interface MetricComparison {
  metric: string;
  expected: number | string;
  actual: number | string;
  diff?: number;
  pass: boolean;
}

export interface WalletResult {
  label: string;
  publicKey: string;
  transactions: { action: string; hash?: string; status: string }[];
  comparisons: MetricComparison[];
  screenshots: string[];
  consoleErrors: string[];
  failedRequests: string[];
  pass: boolean;
  notes?: string;
}

const RESULTS_FILE = path.join(__dirname, '..', '.e2e-results.json');

export function recordResult(result: WalletResult): void {
  const existing: WalletResult[] = fs.existsSync(RESULTS_FILE)
    ? JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'))
    : [];
  existing.push(result);
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(existing, null, 2));
}

export function resetResults(): void {
  if (fs.existsSync(RESULTS_FILE)) fs.unlinkSync(RESULTS_FILE);
}

export function writeReport(outPath = path.join(__dirname, '..', '..', 'e2e-report.md')): void {
  const results: WalletResult[] = fs.existsSync(RESULTS_FILE)
    ? JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'))
    : [];

  const lines: string[] = [];
  lines.push('# Novaire Portfolio E2E Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Network: Stellar Testnet (${process.env.NEXT_PUBLIC_RPC_URL || 'https://soroban-testnet.stellar.org'})`);
  lines.push('');

  const overallPass = results.length > 0 && results.every((r) => r.pass);
  lines.push(`## Overall: ${overallPass ? 'PASS' : 'FAIL'}`);
  lines.push('');

  for (const r of results) {
    lines.push(`## ${r.label} — ${r.pass ? 'PASS' : 'FAIL'}`);
    lines.push('');
    lines.push(`**Wallet:** \`${r.publicKey}\``);
    lines.push('');
    if (r.notes) {
      lines.push(`**Notes:** ${r.notes}`);
      lines.push('');
    }

    if (r.transactions.length) {
      lines.push('### Transactions');
      lines.push('| Action | Hash | Status |');
      lines.push('|---|---|---|');
      for (const t of r.transactions) lines.push(`| ${t.action} | ${t.hash || '—'} | ${t.status} |`);
      lines.push('');
    }

    if (r.comparisons.length) {
      lines.push('### Metric Comparison (Expected vs Displayed)');
      lines.push('| Metric | Expected | Actual | Diff | Pass |');
      lines.push('|---|---|---|---|---|');
      for (const c of r.comparisons) {
        lines.push(`| ${c.metric} | ${c.expected} | ${c.actual} | ${c.diff ?? '—'} | ${c.pass ? '✓' : '✗'} |`);
      }
      lines.push('');
    }

    if (r.consoleErrors.length) {
      lines.push('### Console Errors');
      for (const e of r.consoleErrors) lines.push(`- \`${e}\``);
      lines.push('');
    }

    if (r.failedRequests.length) {
      lines.push('### Failed Network Requests');
      for (const f of r.failedRequests) lines.push(`- \`${f}\``);
      lines.push('');
    }

    if (r.screenshots.length) {
      lines.push('### Screenshots');
      for (const s of r.screenshots) lines.push(`- ${s}`);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('Playwright HTML report (traces, per-step screenshots, timings): `playwright-report/index.html`');
  lines.push('Raw trace files (view with `npx playwright show-trace <file>`): `test-results/**/trace.zip`');

  fs.writeFileSync(outPath, lines.join('\n'));
}
