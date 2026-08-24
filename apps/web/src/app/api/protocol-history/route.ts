import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { NETWORK, CONTRACTS } from '@/config/contracts';

export const dynamic = 'force-dynamic';

/**
 * Postgres-backed replacement for /api/history, populated by the indexer's
 * snapshotter (apps/indexer/src/snapshotter.ts) instead of history-store.json.
 *
 * Shape intentionally matches the subset of ProtocolHistoryEntry
 * (apps/web/src/lib/historyStore.ts) that existing consumers actually read —
 * timestamp/ptPrice/ytPrice/tvl/fixedApy/tradingVolume/syExchangeRate. Wallet
 * balance fields (ptBalance, xlmBalance, portfolioValue, ...) are deliberately
 * NOT included: that was per-user data wrongly conflated into protocol-level
 * history in the old file store, and callers already fall back to 0 when those
 * keys are absent (see analyticsHistoryService.ts's `Number(h.ptBalance) || 0`).
 */
export async function GET() {
  try {
    // select only the columns the shaped response uses — ptSupply/ytSupply are
    // stored strings this endpoint never returns.
    const history = await prisma.protocolHistory.findMany({
      where: { network: NETWORK, syWrapper: CONTRACTS.SY_WRAPPER },
      orderBy: { timestamp: 'asc' },
      take: 5000,
      select: {
        id: true,
        timestamp: true,
        network: true,
        syWrapper: true,
        ptPrice: true,
        ytPrice: true,
        tvl: true,
        fixedApy: true,
        tradingVolume: true,
        syExchangeRate: true,
        eventType: true,
        txHash: true,
      },
    });

    const shaped = history.map((h) => ({
      id: h.id,
      timestamp: h.timestamp.toISOString(),
      network: h.network,
      syWrapper: h.syWrapper,
      ptPrice: h.ptPrice,
      ytPrice: h.ytPrice,
      tvl: h.tvl,
      fixedApy: h.fixedApy,
      tradingVolume: h.tradingVolume,
      syExchangeRate: h.syExchangeRate ?? 0,
      eventType: h.eventType,
      txHash: h.txHash,
    }));

    return NextResponse.json(shaped, {
      // The indexer writes at most one snapshot per minute — let CDN/browser caches
      // serve that window instead of re-running a 5000-row query per visitor.
      headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    // Never return 500 — always return valid JSON, matching /api/history's contract.
    console.error('[/api/protocol-history] Unexpected error:', error);
    return NextResponse.json([]);
  }
}
