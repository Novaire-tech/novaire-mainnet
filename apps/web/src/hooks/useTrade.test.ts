import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('useTrade — Fixed APY sourcing (no local calculation)', () => {
  const source = readFileSync(new URL('./useTrade.ts', import.meta.url), 'utf-8');

  it('does not import or call the legacy local APY calculation', () => {
    expect(source).not.toContain('calculateMarketImpliedApy');
    expect(source).not.toContain("from '../utils/apy'");
    expect(source).not.toContain('getEpochStartIndex');
  });

  it('sources Fixed APY from amm.spot_apy(), converted bps -> percent via /100', () => {
    expect(source).toMatch(/ammClient\.spot_apy\(\)/);
    expect(source).toMatch(/fixedApy\s*=\s*Number\(unwrapResult\(spotApyTx\.result\)[^;]*\)\s*\/\s*100/);
  });

  it('sources TWAP APY from amm.twap_apy(), converted bps -> percent via /100', () => {
    expect(source).toMatch(/ammClient\.twap_apy\(\)/);
    expect(source).toMatch(/twap\s*=\s*Number\(unwrapResult\(twapTx\.result\)[^;]*\)\s*\/\s*100/);
  });

  it('never converts AMM APY bps via /1e16', () => {
    expect(source).not.toContain('/1e16');
    expect(source).not.toContain('/ 1e16');
  });
});

describe('AMM spot/TWAP APY divergence — bps to percent', () => {
  // Live testnet sanity-check values from the fix: spot_apy = 1490 bps, twap_apy = 1974 bps.
  const bpsToPercent = (bps: bigint) => Number(bps) / 100;

  it('spot and TWAP implied APY are independent and not forced equal', () => {
    const spot = bpsToPercent(1490n);
    const twap = bpsToPercent(1974n);

    expect(spot).toBeCloseTo(14.90, 2);
    expect(twap).toBeCloseTo(19.74, 2);
    expect(spot).not.toBeCloseTo(twap, 2);
  });
});
