import { calculateUnderlyingApy, MIN_OBSERVATION_INTERVAL_MS, UnderlyingApyResult } from '../utils/underlyingApy';

/**
 * Reads the SY Wrapper's on-chain exchange rate. Works from both server
 * (API routes) and browser — same dynamic-import pattern as ProtocolService.
 * Returns 0 on any failure; callers must treat 0 as "unavailable", not a real rate.
 */
export async function fetchSyExchangeRate(): Promise<number> {
  try {
    const { Client: SyWrapperClient } = await import('../../../../packages/bindings/sy_wrapper/src/index');
    const { CONTRACTS, RPC_URL, NETWORK_PASSPHRASE } = await import('../config/contracts');

    if (!CONTRACTS.SY_WRAPPER) return 0;

    const client = new SyWrapperClient({
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      contractId: CONTRACTS.SY_WRAPPER,
    });

    const res = await client.exchange_rate();
    const rate = Number(res.result);
    return isNaN(rate) || rate <= 0 ? 0 : rate;
  } catch (e) {
    console.warn('[underlyingYieldService] Could not fetch SY exchange rate:', e);
    return 0;
  }
}

export interface ProtocolHistoryLikeEntry {
  timestamp: string;
  syExchangeRate: number;
}

/**
 * Derives the underlying (Blend-backed) APY from stored SY exchange-rate
 * observations. Picks the oldest valid observation at least
 * MIN_OBSERVATION_INTERVAL_MS before the newest valid one — never the two
 * most recent entries, which may be milliseconds apart.
 */
export function deriveUnderlyingApyFromHistory(history: ProtocolHistoryLikeEntry[]): UnderlyingApyResult {
  const valid = history
    .map((e) => ({ rate: e.syExchangeRate, timestampMs: new Date(e.timestamp).getTime() }))
    .filter((o) => o.rate > 0 && !isNaN(o.timestampMs));

  if (valid.length < 2) {
    return { status: 'unavailable', reason: 'insufficient observation history' };
  }

  const newest = valid[valid.length - 1];
  const oldest = valid.find((o) => newest.timestampMs - o.timestampMs >= MIN_OBSERVATION_INTERVAL_MS);

  if (!oldest) {
    return { status: 'unavailable', reason: 'observations do not yet span the minimum interval' };
  }

  return calculateUnderlyingApy(oldest, newest);
}

/** Client-side entry point: fetch history and derive underlying APY from it. */
export async function getUnderlyingApy(): Promise<UnderlyingApyResult> {
  try {
    // Postgres-backed, populated by the indexer's snapshotter — replaces
    // history-store.json for this protocol-level-only read (syExchangeRate has no
    // wallet-balance dependency, so no need to stay on the file store here).
    const res = await fetch('/api/protocol-history');
    if (!res.ok) return { status: 'unavailable', reason: 'history unavailable' };
    const history = await res.json();
    if (!Array.isArray(history)) return { status: 'unavailable', reason: 'history unavailable' };
    return deriveUnderlyingApyFromHistory(history);
  } catch {
    return { status: 'unavailable', reason: 'history unavailable' };
  }
}
