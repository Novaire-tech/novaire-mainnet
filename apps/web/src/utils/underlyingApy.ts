/**
 * Underlying (Blend-backed) APY — derived from growth of the SY exchange rate
 * over time, NOT from PT market price.
 *
 * Source of truth: SY Wrapper's `get_exchange_rate()`. This is the correct
 * metric (over Blend's raw b_rate) because the wrapper already converts
 * b_rate + pool reserve state into a single per-share value representing the
 * actual worth of the underlying Blend position — recomputing that from
 * b_rate client-side would duplicate contract logic and risk drifting from
 * it. get_exchange_rate is already exposed by the deployed contract.
 */

export interface UnderlyingYieldObservation {
  rate: number;
  timestampMs: number;
}

/** Two observations closer together than this produce unreliable annualized figures. */
export const MIN_OBSERVATION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export type UnderlyingApyResult =
  | { status: 'ok'; apy: number }
  | { status: 'unavailable'; reason: string };

/**
 * Annualizes the growth between two SY exchange-rate observations.
 * growth = rate_new / rate_old; APY = (growth ^ (YEAR_MS / elapsed) - 1) * 100
 *
 * Never clamps a loss to 0 — a shrinking exchange rate is a real negative
 * result and must be reported as such, not hidden.
 */
export function calculateUnderlyingApy(
  oldObs: UnderlyingYieldObservation,
  newObs: UnderlyingYieldObservation
): UnderlyingApyResult {
  if (!oldObs || !newObs) return { status: 'unavailable', reason: 'insufficient observation history' };

  if (isNaN(oldObs.rate) || oldObs.rate <= 0) return { status: 'unavailable', reason: 'invalid old rate' };
  if (isNaN(newObs.rate) || newObs.rate <= 0) return { status: 'unavailable', reason: 'invalid new rate' };

  const elapsedMs = newObs.timestampMs - oldObs.timestampMs;
  if (isNaN(elapsedMs) || elapsedMs <= 0) return { status: 'unavailable', reason: 'non-positive elapsed time' };
  if (elapsedMs < MIN_OBSERVATION_INTERVAL_MS) {
    return { status: 'unavailable', reason: 'observations too close together to annualize safely' };
  }

  const growth = newObs.rate / oldObs.rate;
  const apyDecimal = Math.pow(growth, YEAR_MS / elapsedMs) - 1;
  if (isNaN(apyDecimal) || !isFinite(apyDecimal)) return { status: 'unavailable', reason: 'non-finite APY result' };

  return { status: 'ok', apy: apyDecimal * 100 };
}
