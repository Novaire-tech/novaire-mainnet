import * as dotenv from 'dotenv';
dotenv.config();
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:55432/indexer_smoke';

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getOrCreateEpoch, getSyncState } from '../src/processor';
import { prisma } from '../src/db';

/**
 * Times the indexer's hot-path Prisma queries against a real Postgres
 * (same DATABASE_URL convention as src/smoke.e2e.test.ts). Run via
 * `npm run bench` (apps/indexer). Writes JSON to
 * ../../../benchmarks/results/indexer-db.json.
 */

const ITERATIONS = Number(process.env.BENCH_DB_ITERATIONS ?? 50);

const deployments = {
  tokenizer: `bench-db-tokenizer-${Date.now()}`,
  underlying_token: 'bench-db-underlying',
  sy_wrapper: 'bench-db-sy',
  pt_token: 'bench-db-pt',
  yt_token: 'bench-db-yt',
};

async function timeIterations(label: string, fn: () => Promise<unknown>) {
  const latenciesMs: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await fn();
    latenciesMs.push(performance.now() - start);
  }
  latenciesMs.sort((a, b) => a - b);
  const avg = latenciesMs.reduce((a, b) => a + b, 0) / latenciesMs.length;
  return {
    query: label,
    iterations: ITERATIONS,
    avgMs: Math.round(avg * 100) / 100,
    p50Ms: Math.round(latenciesMs[Math.floor(latenciesMs.length * 0.5)] * 100) / 100,
    p95Ms: Math.round(latenciesMs[Math.floor(latenciesMs.length * 0.95)] * 100) / 100,
  };
}

async function main() {
  // Warm the epoch row once so repeated getOrCreateEpoch calls exercise the
  // upsert's "already exists" path, matching steady-state production traffic.
  await getOrCreateEpoch(deployments);

  const results = [
    await timeIterations('getSyncState', () => getSyncState()),
    await timeIterations('getOrCreateEpoch (steady-state upsert)', () => getOrCreateEpoch(deployments)),
    await timeIterations('activity.count', () => prisma.activity.count()),
  ];

  console.table(results);

  const outDir = join(__dirname, '..', '..', '..', 'benchmarks', 'results');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'indexer-db.json'), JSON.stringify(results, null, 2));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
