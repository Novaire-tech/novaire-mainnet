// Independently computes expected portfolio metrics for a wallet, reading
// balances straight from contracts (never from the app/frontend code) and
// re-deriving the same formulas portfolioService.ts uses, so the app's
// output can be checked against a second, independent implementation.
//
// Scope note on price: USD/XLM pricing itself is not re-sourced from a
// second market-data API here (that would test CoinDCX's uptime, not the
// protocol) — the test reads the live price the app is using at assertion
// time and treats it as a given input, then independently verifies the
// *arithmetic* (allocation %, invested totals, XLM conversion, daily yield)
// against on-chain balances read directly from contracts.
import { readOnChainState } from './chain';

export interface ExpectedPortfolio {
  vaultLp: number;
  ptBalance: number;
  ytBalance: number;
  claimableYieldNative: number;
  ptPriceUnderlying: number;
  totalInvestedUsd: number;
  totalValueUsd: number;
  totalClaimableYieldUsd: number;
  allocationPercent: { assetCode: string; percent: number }[];
  activePositions: number;
}

export function calculateProjectedDailyYield(principal: number, apyPct: number): number {
  if (!isFinite(principal) || isNaN(principal) || principal <= 0) return 0;
  if (!isFinite(apyPct) || isNaN(apyPct) || apyPct <= 0) return 0;
  const d = (principal * (apyPct / 100)) / 365;
  return isFinite(d) && !isNaN(d) ? d : 0;
}

export async function computeExpectedPortfolio(publicKey: string, underlyingSpotUsd: number): Promise<ExpectedPortfolio> {
  const state = await readOnChainState(publicKey);
  const ptPriceUsd = state.ptPriceUnderlying * underlyingSpotUsd;
  const ytPriceUsd = Math.max(0, 1 - state.ptPriceUnderlying) * underlyingSpotUsd;

  const vaultLpValueUsd = state.vaultLp * underlyingSpotUsd;
  const ptValueUsd = state.ptBalance * ptPriceUsd;
  const ytValueUsd = state.ytBalance * ytPriceUsd;
  const claimableYieldUsd = state.claimableYield * underlyingSpotUsd;

  const hasTokenizedPosition = state.ptBalance > 0 || state.ytBalance > 0;
  const hasRawLp = state.vaultLp > 0;

  const tokenizedVaultValueUsd = hasTokenizedPosition ? ptValueUsd + ytValueUsd : 0;

  let totalValueUsd = ptValueUsd + ytValueUsd + vaultLpValueUsd;
  if (claimableYieldUsd > 0) totalValueUsd += claimableYieldUsd;

  const totalInvestedUsd = (hasTokenizedPosition ? tokenizedVaultValueUsd : 0) + (hasRawLp ? vaultLpValueUsd : 0);
  const activePositions = (hasTokenizedPosition ? 1 : 0) + (hasRawLp ? 1 : 0);

  const allocationPercent: { assetCode: string; percent: number }[] = [];
  const push = (assetCode: string, valueUsd: number) => {
    if (valueUsd <= 0) return;
    allocationPercent.push({ assetCode, percent: totalValueUsd > 0 ? (valueUsd / totalValueUsd) * 100 : 0 });
  };
  push('PT', ptValueUsd);
  push('YT', ytValueUsd);
  push('Vault (tokenized)', tokenizedVaultValueUsd);
  push('Vault LP (raw)', vaultLpValueUsd);

  return {
    vaultLp: state.vaultLp,
    ptBalance: state.ptBalance,
    ytBalance: state.ytBalance,
    claimableYieldNative: state.claimableYield,
    ptPriceUnderlying: state.ptPriceUnderlying,
    totalInvestedUsd,
    totalValueUsd,
    totalClaimableYieldUsd: claimableYieldUsd,
    allocationPercent,
    activePositions,
  };
}

export const TOLERANCE = 0.000001;

export function withinTolerance(expected: number, actual: number, tolerance = TOLERANCE): boolean {
  return Math.abs(expected - actual) <= tolerance;
}
