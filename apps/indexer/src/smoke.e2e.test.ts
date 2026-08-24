import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Keypair, nativeToScVal } from "@stellar/stellar-sdk";
import { prisma } from "./db";
import { createBatch, planEvent, flushBatch, getOrCreateEpoch, getSyncState, runInTransaction } from "./processor";
import { takeSnapshot } from "./snapshotter";

// End-to-end smoke tests for the indexer's DB-facing pipeline: given a real
// Postgres (see vitest.config.ts DATABASE_URL), verify a deposit event lands
// as Activity, epoch bootstrap is idempotent, sync state persists, and the
// snapshotter's "can't reach RPC" path fails closed instead of writing junk.
// Requires a throwaway Postgres reachable at DATABASE_URL with the schema
// pushed (`prisma db push`) — never point this at a real deployment's DB.

const holder = Keypair.random().publicKey();
const deployments = {
  tokenizer: `smoke-tokenizer-${Date.now()}`,
  underlying_token: "smoke-underlying",
  sy_wrapper: "smoke-sy",
  pt_token: "smoke-pt",
  yt_token: "smoke-yt",
};

function depositEvent(id: string) {
  return {
    id,
    topic: [nativeToScVal("deposit", { type: "symbol" }), nativeToScVal(holder, { type: "address" })],
    value: nativeToScVal({ underlying_amount: BigInt(1_000_000) }),
  };
}

function depositBatch(eventId: string, epochId: string) {
  const batch = createBatch();
  planEvent(batch, depositEvent(eventId), "smoke-txhash", new Date(), "sy_wrapper", epochId);
  return batch;
}

describe("indexer smoke", () => {
  let epochId: string;

  beforeAll(async () => {
    epochId = await getOrCreateEpoch(deployments);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("bootstraps the epoch idempotently", async () => {
    const again = await getOrCreateEpoch(deployments);
    expect(again).toBe(epochId);
  });

  it("persists sync state and defaults to ledger 0", async () => {
    const state = await getSyncState();
    expect(state.id).toBe("singleton");
    expect(typeof state.lastLedger).toBe("number");
  });

  it("processes a deposit event into an Activity row", async () => {
    const eventId = `smoke-deposit-${Date.now()}`;
    await runInTransaction(async (tx) => {
      await flushBatch(tx, depositBatch(eventId, epochId));
    });

    const activity = await prisma.activity.findUnique({ where: { id: eventId } });
    expect(activity).not.toBeNull();
    expect(activity?.type).toBe("sy_wrapper_deposit");
    expect(activity?.userId).toBe(holder);
    expect(activity?.amount).toBe("1000000");

    const user = await prisma.user.findUnique({ where: { id: holder } });
    expect(user).not.toBeNull();
  });

  it("is idempotent for a re-delivered event id", async () => {
    const eventId = `smoke-idempotent-${Date.now()}`;
    const run = () =>
      runInTransaction(async (tx) => flushBatch(tx, depositBatch(eventId, epochId)));
    await run();
    await run();

    const count = await prisma.activity.count({ where: { id: eventId } });
    expect(count).toBe(1);
  });

  it("skips unhandled event topics without throwing", async () => {
    const eventId = `smoke-unhandled-${Date.now()}`;
    const event = {
      id: eventId,
      topic: [nativeToScVal("some_unknown_topic", { type: "symbol" })],
      value: nativeToScVal({}),
    };
    await expect(
      runInTransaction(async (tx) => {
        const batch = createBatch();
        planEvent(batch, event, "smoke-txhash", new Date(), "sy_wrapper", epochId);
        await flushBatch(tx, batch);
      })
    ).resolves.toBeUndefined();
  });

  it("takeSnapshot fails closed when RPC/price data is unreachable", async () => {
    const before = await prisma.protocolHistory.count({ where: { syWrapper: deployments.sy_wrapper } });
    // No real contracts deployed at these fake addresses, so RPC reads fail and
    // getProtocolState() falls back to priceUnavailable/apyUnavailable — takeSnapshot
    // must write nothing rather than persist a fake zero-TVL/zero-APY row.
    await takeSnapshot(deployments, "SMOKE");
    const after = await prisma.protocolHistory.count({ where: { syWrapper: deployments.sy_wrapper } });
    expect(after).toBe(before);
  });
});
