import * as dotenv from 'dotenv';
dotenv.config();
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:55432/indexer_smoke';

import { Keypair, nativeToScVal } from '@stellar/stellar-sdk';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createBatch, planEvent, flushBatch, getOrCreateEpoch, runInTransaction } from '../src/processor';
import { prisma } from '../src/db';

/**
 * Throughput benchmark for the indexer's decode-plan-flush pipeline
 * (planEvent + flushBatch), timed against a real Postgres exactly like
 * src/smoke.e2e.test.ts -- requires a throwaway DB reachable at
 * DATABASE_URL/SMOKE_DATABASE_URL with the schema pushed
 * (`prisma db push`), never point this at a real deployment's DB.
 *
 * Run via `npm run bench` (apps/indexer). Writes JSON to
 * ../../../benchmarks/results/indexer-throughput.json.
 */

const EVENT_COUNT = Number(process.env.BENCH_EVENT_COUNT ?? 500);
const BATCH_SIZE = Number(process.env.BENCH_BATCH_SIZE ?? 50);

const deployments = {
  tokenizer: `bench-tokenizer-${Date.now()}`,
  underlying_token: 'bench-underlying',
  sy_wrapper: 'bench-sy',
  pt_token: 'bench-pt',
  yt_token: 'bench-yt',
};

function depositEvent(id: string, holder: string) {
  return {
    id,
    topic: [nativeToScVal('deposit', { type: 'symbol' }), nativeToScVal(holder, { type: 'address' })],
    value: nativeToScVal({ underlying_amount: BigInt(1_000_000) }),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const epochId = await getOrCreateEpoch(deployments);
  const holder = Keypair.random().publicKey();
  const runId = Date.now();

  const batchLatenciesMs: number[] = [];
  const start = performance.now();

  for (let batchStart = 0; batchStart < EVENT_COUNT; batchStart += BATCH_SIZE) {
    const batch = createBatch();
    const batchEnd = Math.min(batchStart + BATCH_SIZE, EVENT_COUNT);
    for (let i = batchStart; i < batchEnd; i++) {
      planEvent(batch, depositEvent(`bench-${runId}-${i}`, holder), 'bench-txhash', new Date(), 'sy_wrapper', epochId);
    }
    const batchStartedAt = performance.now();
    await runInTransaction((tx) => flushBatch(tx, batch));
    batchLatenciesMs.push(performance.now() - batchStartedAt);
  }

  const totalMs = performance.now() - start;
  batchLatenciesMs.sort((a, b) => a - b);

  const report = {
    eventCount: EVENT_COUNT,
    batchSize: BATCH_SIZE,
    totalMs: Math.round(totalMs),
    eventsPerSecond: Math.round((EVENT_COUNT / totalMs) * 1000),
    batchLatencyMsP50: Math.round(percentile(batchLatenciesMs, 50)),
    batchLatencyMsP95: Math.round(percentile(batchLatenciesMs, 95)),
  };

  console.table([report]);

  const outDir = join(__dirname, '..', '..', '..', 'benchmarks', 'results');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'indexer-throughput.json'), JSON.stringify(report, null, 2));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
