// Two independent implementations of the portfolio math, run over the same
// on-chain reads, so a real bug in either one shows up as a mismatch rather
// than being silently agreed upon by a single implementation checking itself.
//
// computeIndependent() is a from-scratch derivation of the formulas.
// computeAppFormula() is a deliberately separate transcription of the exact
// arithmetic in apps/web/src/services/portfolioService.ts (kept here rather
// than imported, since that module pulls in browser-only WalletService/
// PriceOracleService dependencies this Node script cannot run) — so a
// regression introduced in the app's formula is caught by disagreeing with
// the independent implementation, not compared against itself.
import type { OnChainState } from './chain';

export interface PortfolioMetrics {
  totalInvestedUsd: number;
  totalValueUsd: number;
  totalClaimableYieldUsd: number;
  totalInvestedXlm: number;
  totalClaimableYieldXlm: number;
  allocationPercent: { assetCode: string; percent: number }[];
  activePositions: number;
}

export function calculateProjectedDailyYield(principal: number, apyPct: number): number {
  if (!isFinite(principal) || isNaN(principal) || principal <= 0) return 0;
  if (!isFinite(apyPct) || isNaN(apyPct) || apyPct <= 0) return 0;
  const d = (principal * (apyPct / 100)) / 365;
  return isFinite(d) && !isNaN(d) ? d : 0;
}

function toXlmSafe(usd: number, xlmPriceUsd: number): number {
  return xlmPriceUsd > 0 ? usd / xlmPriceUsd : 0;
}

export function computeIndependent(state: OnChainState, underlyingSpotUsd: number, xlmPriceUsd: number): PortfolioMetrics {
  const ptPriceUsd = state.ptPriceUnderlying * underlyingSpotUsd;
  const ytPriceUsd = Math.max(0, 1 - state.ptPriceUnderlying) * underlyingSpotUsd;

  const vaultLpValueUsd = state.vaultLp * underlyingSpotUsd;
  const ptValueUsd = state.ptBalance * ptPriceUsd;
  const ytValueUsd = state.ytBalance * ytPriceUsd;
  const claimableYieldUsd = state.claimableYield * underlyingSpotUsd;

  const hasTokenized = state.ptBalance > 0 || state.ytBalance > 0;
  const hasRawLp = state.vaultLp > 0;
  const tokenizedValueUsd = hasTokenized ? ptValueUsd + ytValueUsd : 0;

  let totalValueUsd = ptValueUsd + ytValueUsd + vaultLpValueUsd;
  if (claimableYieldUsd > 0) totalValueUsd += claimableYieldUsd;

  const totalInvestedUsd = (hasTokenized ? tokenizedValueUsd : 0) + (hasRawLp ? vaultLpValueUsd : 0);
  const activePositions = (hasTokenized ? 1 : 0) + (hasRawLp ? 1 : 0);

  const allocationPercent: { assetCode: string; percent: number }[] = [];
  const push = (assetCode: string, v: number) => {
    if (v <= 0) return;
    allocationPercent.push({ assetCode, percent: totalValueUsd > 0 ? (v / totalValueUsd) * 100 : 0 });
  };
  // PT + YT already ARE the tokenized position's value — no separate
  // "Vault (tokenized)" bucket here, or it would double-count against these
  // two and inflate the allocation sum past 100% (this is exactly the bug
  // this script found in the app's own totalValueUsd — see README).
  push('PT', ptValueUsd);
  push('YT', ytValueUsd);
  push('Vault LP (raw)', vaultLpValueUsd);

  return {
    totalInvestedUsd,
    totalValueUsd,
    totalClaimableYieldUsd: claimableYieldUsd,
    totalInvestedXlm: toXlmSafe(totalInvestedUsd, xlmPriceUsd),
    totalClaimableYieldXlm: toXlmSafe(claimableYieldUsd, xlmPriceUsd),
    allocationPercent,
    activePositions,
  };
}

/** Transcription of portfolioService.ts's actual aggregation logic (see file header). */
export function computeAppFormula(state: OnChainState, underlyingSpotUsd: number, xlmPriceUsd: number): PortfolioMetrics {
  const ptPriceUsd = state.ptPriceUnderlying * underlyingSpotUsd;
  const ytPriceUsd = Math.max(0, 1.0 - state.ptPriceUnderlying) * underlyingSpotUsd;

  const assets: { assetType: 'pt' | 'yt' | 'vault'; assetCode: string; valueUsd: number; hasClaimableYield: boolean }[] = [];
  let totalValueUsd = 0;

  const ptValueUsd = state.ptBalance * ptPriceUsd;
  const ytValueUsd = state.ytBalance * ytPriceUsd;
  if (state.ptBalance > 0) {
    assets.push({ assetType: 'pt', assetCode: 'PT-XLM', valueUsd: ptValueUsd, hasClaimableYield: false });
    totalValueUsd += ptValueUsd;
  }
  if (state.ytBalance > 0) {
    assets.push({ assetType: 'yt', assetCode: 'YT-XLM', valueUsd: ytValueUsd, hasClaimableYield: false });
    totalValueUsd += ytValueUsd;
  }
  const claimableYieldUsd = state.claimableYield * underlyingSpotUsd;
  if (state.ptBalance > 0 || state.ytBalance > 0) {
    // Not added to totalValueUsd — same money already counted above via
    // ptValueUsd/ytValueUsd. This is a display rollup (VaultPositionsTable),
    // not a third independent value bucket. (Fixed: previously double-counted.)
    const currentVaultValue = ptValueUsd + ytValueUsd;
    assets.push({ assetType: 'vault', assetCode: 'Novaire Vault (XLM)', valueUsd: currentVaultValue, hasClaimableYield: true });
  }
  const realVaultValueUsd = state.vaultLp * underlyingSpotUsd;
  if (state.vaultLp > 0) {
    totalValueUsd += realVaultValueUsd;
    assets.push({ assetType: 'vault', assetCode: 'Novaire Vault LP (XLM)', valueUsd: realVaultValueUsd, hasClaimableYield: false });
  }

  // The rollup entry (hasClaimableYield: true) is excluded from allocation —
  // it duplicates the PT/YT rows it summarizes and must not get its own share.
  const allocationPercent = assets
    .filter((a) => !(a.assetType === 'vault' && a.hasClaimableYield))
    .map((a) => ({
      assetCode: a.assetCode,
      percent: totalValueUsd > 0 ? (a.valueUsd / totalValueUsd) * 100 : 0,
    }));

  let totalClaimableYieldUsd = 0;
  for (const a of assets) if (a.assetType === 'vault' && a.hasClaimableYield) totalClaimableYieldUsd += claimableYieldUsd;
  if (totalClaimableYieldUsd > 0) totalValueUsd += totalClaimableYieldUsd;

  const totalInvestedUsd = assets.filter((a) => a.assetType === 'vault').reduce((s, a) => s + a.valueUsd, 0);
  const activePositions = assets.filter((a) => a.assetType === 'vault').length;

  return {
    totalInvestedUsd,
    totalValueUsd,
    totalClaimableYieldUsd,
    totalInvestedXlm: toXlmSafe(totalInvestedUsd, xlmPriceUsd),
    totalClaimableYieldXlm: toXlmSafe(totalClaimableYieldUsd, xlmPriceUsd),
    allocationPercent,
    activePositions,
  };
}

export const TOLERANCE = 0.000001;

export function withinTolerance(a: number, b: number, tolerance = TOLERANCE): boolean {
  return isFinite(a) && isFinite(b) && !isNaN(a) && !isNaN(b) && Math.abs(a - b) <= tolerance;
}

// Independent re-derivation (in BigInt, integer floor-division, matching
// Rust's `/` on i128) of contracts/blend-adapter/src/lib.rs's
// `assets_from_b_tokens` + `derived_exchange_rate`. Kept as a from-scratch
// transcription — not a call into the Rust code — so a regression in the
// deployed contract's math shows up as a mismatch against this
// independently-computed value, the same cross-check pattern as
// computeIndependent/computeAppFormula above.
export const BLEND_SCALAR_12 = 1_000_000_000_000n;
export const WAD = 1_000_000_000_000_000_000n;

/** `assets = b_tokens * b_rate / SCALAR_12`, floored. */
export function assetsFromBTokens(bTokens: bigint, bRate: bigint): bigint {
  return (bTokens * bRate) / BLEND_SCALAR_12;
}

/** `rate = aum * WAD / sy_supply`, floored; WAD (bootstrap) when no SY is outstanding. */
export function derivedExchangeRate(aum: bigint, sySupply: bigint): bigint {
  if (sySupply <= 0n) return WAD;
  return (aum * WAD) / sySupply;
}

/**
 * The full chain: real Blend reserve b_rate + real wrapper bToken position ->
 * expected SY exchange_rate, computed independently of the on-chain call.
 */
export function computeAdapterRate(bTokens: bigint, bRate: bigint, sySupply: bigint): bigint {
  const aum = assetsFromBTokens(bTokens, bRate);
  return derivedExchangeRate(aum, sySupply);
}

/** BigInt counterpart to withinTolerance, for WAD-scale (18-decimal) on-chain values. */
export function withinToleranceBigInt(a: bigint, b: bigint, toleranceWad = 1_000_000_000n): boolean {
  const diff = a > b ? a - b : b - a;
  return diff <= toleranceWad;
}
