import { describe, it, expect } from 'vitest';
import { calculateProjectedDailyYield } from './yield';

describe('calculateProjectedDailyYield', () => {
  it('computes principal * apy / 100 / 365', () => {
    expect(calculateProjectedDailyYield(36500, 10)).toBeCloseTo(10, 6);
  });

  it('returns 0 for zero principal', () => {
    expect(calculateProjectedDailyYield(0, 10)).toBe(0);
  });

  it('returns 0 for zero APY', () => {
    expect(calculateProjectedDailyYield(1000, 0)).toBe(0);
  });

  it('returns 0 for NaN principal', () => {
    expect(calculateProjectedDailyYield(NaN, 10)).toBe(0);
  });

  it('returns 0 for NaN APY', () => {
    expect(calculateProjectedDailyYield(1000, NaN)).toBe(0);
  });

  it('returns 0 for negative principal', () => {
    expect(calculateProjectedDailyYield(-1000, 10)).toBe(0);
  });

  it('returns 0 for negative APY', () => {
    expect(calculateProjectedDailyYield(1000, -5)).toBe(0);
  });

  it('returns 0 for non-finite inputs', () => {
    expect(calculateProjectedDailyYield(Infinity, 10)).toBe(0);
    expect(calculateProjectedDailyYield(1000, Infinity)).toBe(0);
  });
});
