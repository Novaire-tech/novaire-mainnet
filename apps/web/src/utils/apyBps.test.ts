import { describe, it, expect } from 'vitest';

// AMM contract's spot_apy()/twap_apy() return basis points (bps, 1e4 = 100%).
// Every frontend/indexer consumer converts via bps / 100, never bps / 1e16 or /1e18.
const bpsToPercent = (bps: bigint | number) => Number(bps) / 100;

describe('AMM APY bps -> percent conversion', () => {
  it('1490 bps -> 14.90%', () => {
    expect(bpsToPercent(1490n)).toBeCloseTo(14.90, 2);
  });

  it('1974 bps -> 19.74%', () => {
    expect(bpsToPercent(1974n)).toBeCloseTo(19.74, 2);
  });

  it('100 bps -> 1.00%', () => {
    expect(bpsToPercent(100n)).toBeCloseTo(1.00, 2);
  });

  it('0 bps -> 0%', () => {
    expect(bpsToPercent(0n)).toBe(0);
  });
});
