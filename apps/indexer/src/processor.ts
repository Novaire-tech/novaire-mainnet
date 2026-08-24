import { Prisma } from '@prisma/client';
import { scValToNative } from '@stellar/stellar-sdk';
import { prisma } from './db';

type Tx = Prisma.TransactionClient;

// i128 fields decode to bigint via scValToNative; Prisma amount columns are
// String, so every amount is stringified before use/persistence.
function stringifyAmounts(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = typeof value === 'bigint' ? value.toString() : String(value);
  }
  return out;
}

/**
 * Rows decoded from one poll batch. Events are planned into this buffer first
 * (pure CPU, no DB), then flushed as a handful of bulk statements inside the
 * batch transaction — the old per-event upserts cost 2-4 sequential round trips
 * per event (user upsert + record upsert; 2 legs for transfers), which on a
 * full 1000-event page meant thousands of serialized queries inside one tx.
 */
export interface EventBatch {
  /** Unique addresses referenced by this batch; inserted before child rows to satisfy FKs. */
  users: Set<string>;
  activities: Prisma.ActivityUncheckedCreateInput[];
  trades: Prisma.TradeUncheckedCreateInput[];
  yieldClaims: Prisma.YieldClaimUncheckedCreateInput[];
}

export function createBatch(): EventBatch {
  return { users: new Set(), activities: [], trades: [], yieldClaims: [] };
}

function requireAmount(data: Record<string, string>, field: string, topicName: string): string {
  const value = data[field];
  if (value === undefined) {
    // Match the old behavior where a malformed event failed its own insert and was
    // skipped by the caller — validate here so one bad event can't poison a bulk flush.
    throw new Error(`event ${topicName}: missing required field "${field}"`);
  }
  return value;
}

function requireHolder(topicFields: unknown[], topicName: string): string {
  const holder = topicFields[0];
  if (typeof holder !== 'string' || holder.length === 0) {
    throw new Error(`event ${topicName}: missing/invalid holder address (${JSON.stringify(holder)})`);
  }
  return holder;
}

/**
 * Decode one event into pending rows in `batch`. Throws on malformed events
 * (bad address shape, missing amount field) — callers catch and skip per event,
 * exactly like the old per-event upsert path did.
 * Returns true when the topic was handled, false for ignorable/unhandled topics.
 */
export function planEvent(
  batch: EventBatch,
  event: any,
  txHash: string,
  timestamp: Date,
  contractLabel: string,
  epochId: string
): boolean {
  const topicName = event.topic?.[0] !== undefined ? scValToNative(event.topic[0]) : undefined;
  if (typeof topicName !== 'string') return false;

  const topicFields = event.topic.slice(1).map((t: any) => scValToNative(t));
  const data = stringifyAmounts((scValToNative(event.value) as Record<string, unknown>) ?? {});

  // event.id is unique per (ledger, tx, operation, event-index) — used as the
  // idempotency key so a re-delivered event never double-writes (flushBatch relies
  // on createMany skipDuplicates for this).
  const eventId: string = event.id;
  const activityType = `${contractLabel}_${topicName}`;

  switch (topicName) {
    // sy-wrapper
    case 'deposit':
    case 'redeem': {
      const holder = requireHolder(topicFields, topicName);
      batch.users.add(holder);
      batch.activities.push({
        id: eventId,
        type: activityType,
        userId: holder,
        epochId,
        amount: requireAmount(data, 'underlying_amount', topicName),
        timestamp,
        txHash,
      });
      break;
    }
    // tokenizer
    case 'split': {
      const holder = requireHolder(topicFields, topicName);
      batch.users.add(holder);
      batch.activities.push({
        id: eventId,
        type: activityType,
        userId: holder,
        epochId,
        amount: requireAmount(data, 'face', topicName),
        timestamp,
        txHash,
      });
      break;
    }
    case 'recombine': {
      const holder = requireHolder(topicFields, topicName);
      batch.users.add(holder);
      batch.activities.push({
        id: eventId,
        type: activityType,
        userId: holder,
        epochId,
        amount: requireAmount(data, 'sy_out', topicName),
        timestamp,
        txHash,
      });
      break;
    }
    case 'redeem_at_maturity': {
      const holder = requireHolder(topicFields, topicName);
      batch.users.add(holder);
      batch.activities.push({
        id: eventId,
        type: activityType,
        userId: holder,
        epochId,
        amount: requireAmount(data, 'pt_amount', topicName),
        timestamp,
        txHash,
      });
      break;
    }
    case 'claim_yield': {
      const holder = requireHolder(topicFields, topicName);
      batch.users.add(holder);
      batch.yieldClaims.push({
        id: eventId,
        userId: holder,
        epochId,
        amount: requireAmount(data, 'sy_out', topicName),
        timestamp,
        txHash,
      });
      break;
    }
    // pt-token / yt-token (contractLabel disambiguates which token contract emitted this)
    case 'mint':
    case 'burn': {
      const holder = requireHolder(topicFields, topicName);
      batch.users.add(holder);
      batch.activities.push({
        id: eventId,
        type: activityType,
        userId: holder,
        epochId,
        amount: requireAmount(data, 'amount', topicName),
        timestamp,
        txHash,
      });
      break;
    }
    case 'transfer': {
      // Activity has no counterparty column, so a transfer is recorded as two legs
      // (sender/receiver) distinguished by an _out/_in suffix on the same eventId.
      const [from, to] = topicFields;
      if (typeof from !== 'string' || from.length === 0 || typeof to !== 'string' || to.length === 0) {
        throw new Error(`event ${topicName}: missing/invalid transfer parties (${JSON.stringify([from, to])})`);
      }
      const amount = requireAmount(data, 'amount', topicName);
      batch.users.add(from);
      batch.users.add(to);
      batch.activities.push({
        id: `${eventId}:out`,
        type: `${activityType}_out`,
        userId: from,
        epochId,
        amount,
        timestamp,
        txHash,
      });
      batch.activities.push({
        id: `${eventId}:in`,
        type: `${activityType}_in`,
        userId: to,
        epochId,
        amount,
        timestamp,
        txHash,
      });
      break;
    }
    // amm
    case 'swap': {
      const trader = requireHolder(topicFields, topicName);
      batch.users.add(trader);
      batch.trades.push({
        id: eventId,
        epochId,
        buyer: trader,
        amountIn: requireAmount(data, 'amount_in', topicName),
        amountOut: requireAmount(data, 'amount_out', topicName),
        // Not derivable from the Swap event alone (needs price/maturity context);
        // left as "0" until a rate-calculation source is implemented.
        impliedRate: '0',
        timestamp,
        txHash,
      });
      break;
    }
    case 'add_liquidity':
    case 'remove_liquidity': {
      const provider = requireHolder(topicFields, topicName);
      batch.users.add(provider);
      batch.activities.push({
        id: eventId,
        type: activityType,
        userId: provider,
        epochId,
        amount: requireAmount(data, topicName === 'add_liquidity' ? 'lp_out' : 'lp_in', topicName),
        timestamp,
        txHash,
      });
      break;
    }
    default:
      console.log(`Unhandled event topic: ${topicName} (contract ${contractLabel})`);
      return false;
  }
  return true;
}

/**
 * Flush planned rows as bulk INSERT .. ON CONFLICT DO NOTHING statements.
 * Users go first (FK parents); children run concurrently afterwards. Per-event
 * idempotency comes from the PKs + skipDuplicates, matching the old upserts'
 * "insert if absent, else no-op" semantics.
 */
export async function flushBatch(tx: Tx, batch: EventBatch): Promise<void> {
  if (batch.users.size > 0) {
    await tx.user.createMany({
      data: [...batch.users].map((id) => ({ id })),
      skipDuplicates: true,
    });
  }
  await Promise.all([
    batch.activities.length > 0 ? tx.activity.createMany({ data: batch.activities, skipDuplicates: true }) : null,
    batch.trades.length > 0 ? tx.trade.createMany({ data: batch.trades, skipDuplicates: true }) : null,
    batch.yieldClaims.length > 0
      ? tx.yieldClaim.createMany({ data: batch.yieldClaims, skipDuplicates: true })
      : null,
  ]);
}

/**
 * The protocol currently has no epoch-rotation mechanism (single deployment per
 * network), so we upsert one Epoch row keyed by the tokenizer contract address
 * to satisfy Activity/Position/YieldClaim's required epoch relation.
 * maturityLedger is a placeholder (0) until real epoch tracking exists (see
 * plan Task 5) — do not rely on it for maturity logic yet.
 */
export async function getOrCreateEpoch(deployments: Record<string, string>) {
  const { tokenizer, underlying_token, sy_wrapper, pt_token, yt_token } = deployments;
  if (!tokenizer) throw new Error('deployments missing tokenizer address');
  const epoch = await prisma.epoch.upsert({
    where: { id: tokenizer },
    create: {
      id: tokenizer,
      maturityLedger: 0,
      underlyingAsset: underlying_token ?? '',
      syAsset: sy_wrapper ?? '',
      ptAsset: pt_token ?? '',
      ytAsset: yt_token ?? '',
    },
    update: {},
  });
  return epoch.id;
}

export async function getSyncState() {
  let state = await prisma.syncState.findUnique({ where: { id: 'singleton' } });
  if (!state) {
    state = await prisma.syncState.create({
      data: { id: 'singleton', lastLedger: 0 },
    });
  }
  return state;
}

// Prisma's interactive-transaction defaults (maxWait 2s / timeout 5s) are sized for
// short single-row work; a full poll batch must plan, bulk-flush and advance the
// cursor inside this window, so give it explicit headroom instead of failing with
// P2028 once batches grow.
const TX_OPTIONS = { maxWait: 5_000, timeout: 30_000 } as const;

export async function runInTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, TX_OPTIONS);
}
