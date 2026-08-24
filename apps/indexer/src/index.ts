import { rpc, Contract } from '@stellar/stellar-sdk';
import { createBatch, planEvent, flushBatch, getSyncState, getOrCreateEpoch, runInTransaction } from './processor';
import { takeSnapshot } from './snapshotter';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK = process.env.NETWORK || 'testnet';
// apps/web's config/contracts.ts stores NETWORK uppercase (e.g. "TESTNET") and scopes
// history rows by that value — match it here so the two sides agree on scope identity.
const NETWORK_SCOPE = NETWORK.toUpperCase();
const server = new rpc.Server(RPC_URL);

async function loadDeployments() {
  try {
    const filePath = path.resolve(
      __dirname,
      `../../web/src/config/deployments.${NETWORK}.json`
    );
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load deployments:', e);
  }
  return {};
}

// The 5 contracts whose events processor.ts actually decodes. underlying_token (the
// mock/deposit-asset contract) is deliberately excluded — it emits no events we
// process, and Soroban's getEvents rejects more than 5 contract IDs per filter, so
// including it would silently break polling for a 6th, irrelevant contract.
const TRACKED_LABELS = ['sy_wrapper', 'pt_token', 'yt_token', 'tokenizer', 'amm'];

async function start() {
  const deployments = await loadDeployments();
  const contractLabelById = new Map<string, string>();
  for (const [label, id] of Object.entries(deployments)) {
    if (typeof id === 'string' && TRACKED_LABELS.includes(label)) contractLabelById.set(id, label);
  }
  const contractIds = [...contractLabelById.keys()];

  console.log(`Starting indexer, tracking ${contractIds.length} contracts...`);

  const epochId = await getOrCreateEpoch(deployments);

  let syncState = await getSyncState();
  let cursor = syncState.lastLedger;

  if (cursor === 0) {
    // If we have no state, start from the current ledger minus 10 to catch recent
    const latestLedger = await server.getLatestLedger();
    cursor = latestLedger.sequence - 10;
  }

  setInterval(async () => {
    try {
      const latestLedger = await server.getLatestLedger();
      const currentLedger = latestLedger.sequence;

      if (cursor < currentLedger) {
        console.log(`Fetching events from ledger ${cursor} to ${currentLedger}`);
        
        const eventsResponse = await server.getEvents({
          startLedger: cursor,
          filters: [
            {
              type: 'contract',
              contractIds: contractIds,
            }
          ],
          limit: 1000,
        });

        // All event writes + the cursor advance happen in one transaction, so a crash
        // mid-batch can never advance SyncState past events that weren't persisted.
        // Events are planned first (pure decode, no DB) so one malformed/unexpected
        // event (bad topic shape, missing address, ...) is caught and skipped here
        // rather than rethrown — otherwise it would abort the whole batch every poll,
        // wedging the cursor on the same bad event forever. The flush itself is a
        // handful of bulk statements, not 2+ queries per event.
        const batch = createBatch();
        if (eventsResponse.events) {
          for (const event of eventsResponse.events) {
            if (!event.contractId) continue;
            const contractId = event.contractId.toString();
            const contractLabel = contractLabelById.get(contractId) ?? 'unknown';
            try {
              planEvent(batch, event, event.txHash, new Date(), contractLabel, epochId);
            } catch (err) {
              console.error(`Skipping unprocessable event ${event.id} (contract ${contractLabel}):`, err);
            }
          }
        }
        await runInTransaction(async (tx) => {
          await flushBatch(tx, batch);
          await tx.syncState.update({ where: { id: 'singleton' }, data: { lastLedger: currentLedger + 1 } });
        });

        // currentLedger's events were just fully fetched (getEvents' startLedger is
        // inclusive) — advance past it so the next poll doesn't re-fetch and
        // re-process the same ledger's events every cycle.
        cursor = currentLedger + 1;
      }
    } catch (e) {
      console.error('Error polling events:', e);
    }
  }, 5000); // poll every 5 seconds

  // Protocol-level state snapshot (TVL/APY/prices) — separate, slower interval since
  // this is a handful of RPC reads, not something that needs 5s granularity, and is a
  // single server-side poll shared by all users (replaces the old N-clients-poll-RPC-
  // directly pattern from analyticsHistoryService.ts).
  setInterval(async () => {
    try {
      await takeSnapshot(deployments, NETWORK_SCOPE);
    } catch (e) {
      console.error('Error taking protocol snapshot:', e);
    }
  }, 60000); // snapshot every 60 seconds
  takeSnapshot(deployments, NETWORK_SCOPE).catch((e) => console.error('Error taking initial protocol snapshot:', e));
}

start().catch(console.error);
