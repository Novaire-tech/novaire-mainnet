import { describe, it, expect } from 'vitest';
import { calculateUnderlyingApy, MIN_OBSERVATION_INTERVAL_MS, YEAR_MS } from './underlyingApy';

const day = 24 * 60 * 60 * 1000;

describe('calculateUnderlyingApy', () => {
  it('reports unavailable with no observation history', () => {
    // @ts-expect-error deliberately missing observation
    const result = calculateUnderlyingApy(undefined, { rate: 1, timestampMs: 0 });
    expect(result.status).toBe('unavailable');
  });

  it('returns ~0% APY for an unchanged rate', () => {
    const old = { rate: 1.0, timestampMs: 0 };
    const now = { rate: 1.0, timestampMs: 365 * day };
    const result = calculateUnderlyingApy(old, now);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.apy).toBeCloseTo(0, 6);
  });

  it('returns positive APY when rate increases', () => {
    const old = { rate: 1.0, timestampMs: 0 };
    const now = { rate: 1.04, timestampMs: 365 * day };
    const result = calculateUnderlyingApy(old, now);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.apy).toBeCloseTo(4, 1);
  });

  it('returns negative APY when rate decreases (does not clamp to 0)', () => {
    const old = { rate: 1.0, timestampMs: 0 };
    const now = { rate: 0.95, timestampMs: 365 * day };
    const result = calculateUnderlyingApy(old, now);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.apy).toBeLessThan(0);
  });

  it('is unavailable for a zero old rate', () => {
    const old = { rate: 0, timestampMs: 0 };
    const now = { rate: 1.0, timestampMs: 365 * day };
    expect(calculateUnderlyingApy(old, now).status).toBe('unavailable');
  });

  it('is unavailable for zero elapsed time', () => {
    const old = { rate: 1.0, timestampMs: 1000 };
    const now = { rate: 1.0, timestampMs: 1000 };
    expect(calculateUnderlyingApy(old, now).status).toBe('unavailable');
  });

  it('is unavailable for negative elapsed time', () => {
    const old = { rate: 1.0, timestampMs: 2000 };
    const now = { rate: 1.0, timestampMs: 1000 };
    expect(calculateUnderlyingApy(old, now).status).toBe('unavailable');
  });

  it('rejects intervals shorter than MIN_OBSERVATION_INTERVAL_MS', () => {
    const old = { rate: 1.0, timestampMs: 0 };
    const now = { rate: 1.0001, timestampMs: MIN_OBSERVATION_INTERVAL_MS - 1 };
    expect(calculateUnderlyingApy(old, now).status).toBe('unavailable');
  });

  it('accepts an interval exactly at MIN_OBSERVATION_INTERVAL_MS', () => {
    const old = { rate: 1.0, timestampMs: 0 };
    const now = { rate: 1.0001, timestampMs: MIN_OBSERVATION_INTERVAL_MS };
    expect(calculateUnderlyingApy(old, now).status).toBe('ok');
  });

  it('matches known example: 1.00 -> 1.04 over 365 days ~= 4%', () => {
    const old = { rate: 1.0, timestampMs: 0 };
    const now = { rate: 1.04, timestampMs: 0 + 365 * day };
    const result = calculateUnderlyingApy(old, now);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.apy).toBeCloseTo(4, 1);
  });

  it('matches known example: 1.00 -> 1.08 over 180 days annualizes above 8%', () => {
    const old = { rate: 1.0, timestampMs: 0 };
    const now = { rate: 1.08, timestampMs: 180 * day };
    const result = calculateUnderlyingApy(old, now);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      const expected = (Math.pow(1.08, YEAR_MS / (180 * day)) - 1) * 100;
      expect(result.apy).toBeCloseTo(expected, 6);
      expect(result.apy).toBeGreaterThan(8);
    }
  });
});
