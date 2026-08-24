import { prisma } from './db';

// Minimal reimplementation of protocolService.ts's getProtocolState() + the CoinDCX
// price lookup used by /api/history/sync — trimmed to only what a periodic protocol-
// level snapshot needs. Deliberately does NOT carry wallet-balance fields (ptBalance,
// xlmBalance, portfolioValue, ...): those are per-user and were wrongly conflated with
// protocol history in the old history-store.json design. Wallet state stays a live
// on-chain read (portfolioService.ts), not something the indexer snapshots.

interface ProtocolStateSnapshot {
  ptPriceUnderlying: number;
  tvlXlm: number;
  tvlUsd: number;
  priceUnavailable: boolean;
  impliedYieldApy: number;
  apyUnavailable: boolean;
  ptSupplyXlm: number;
  ytSupplyXlm: number;
  /** Raw SY wrapper exchange rate at this instant; null when the read failed/was invalid. */
  syExchangeRate: number | null;
}

function unwrapResult(rawResult: unknown): unknown {
  if (rawResult !== undefined && typeof rawResult === 'object' && rawResult !== null) {
    const obj = rawResult as Record<string, unknown>;
    if (typeof obj.unwrap === 'function') return (obj.unwrap as () => unknown)();
    if ('ok' in obj) return obj.ok;
    if ('value' in obj) return obj.value;
  }
  return rawResult;
}

async function fetchXlmPriceUsd(): Promise<number | null> {
  try {
    const res = await fetch('https://api.coindcx.com/exchange/ticker', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const tickers: Array<{ market: string; last_price: string }> = await res.json();
    const ticker = tickers.find((t) => t.market === 'XLMUSDT');
    const price = ticker ? parseFloat(ticker.last_price) : NaN;
    return isNaN(price) || price <= 0 ? null : price;
  } catch (e) {
    console.warn('[snapshotter] Could not fetch XLM price:', e);
    return null;
  }
}

async function getProtocolState(deployments: Record<string, string>): Promise<ProtocolStateSnapshot> {
  const defaultState: ProtocolStateSnapshot = {
    ptPriceUnderlying: 1.0,
    tvlXlm: 0,
    tvlUsd: 0,
    priceUnavailable: true,
    impliedYieldApy: 0,
    apyUnavailable: true,
    ptSupplyXlm: 0,
    ytSupplyXlm: 0,
    syExchangeRate: null,
  };

  try {
    const { Client: PtClient } = await import('../../../packages/bindings/pt_token/src/index');
    const { Client: YtClient } = await import('../../../packages/bindings/yt_token/src/index');
    const { Client: SyWrapperClient } = await import('../../../packages/bindings/sy_wrapper/src/index');
    const { Client: AmmClient } = await import('../../../packages/bindings/amm/src/index');

    const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
    const NETWORK_PASSPHRASE =
      process.env.NETWORK_PASSPHRASE ||
      (process.env.NETWORK === 'mainnet'
        ? 'Public Global Stellar Network ; September 2015'
        : 'Test SDF Network ; September 2015');

    const clientOptions = { rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE };

    const ptClient = new PtClient({ ...clientOptions, contractId: deployments.pt_token });
    const ytClient = new YtClient({ ...clientOptions, contractId: deployments.yt_token });
    const syWrapperClient = new SyWrapperClient({ ...clientOptions, contractId: deployments.sy_wrapper });
    const ammClient = new AmmClient({ ...clientOptions, contractId: deployments.amm });

    // One parallel round of all RPC + price reads — the XLM price used to be awaited
    // serially afterwards, adding a full HTTP round trip to every snapshot tick.
    const [ptSupplyRes, ytSupplyRes, syTotalSupplyRes, twapApyRes, ptQuoteRes, exchangeRateRes, xlmPriceRes] =
      await Promise.allSettled([
        ptClient.total_supply(),
        ytClient.total_supply(),
        syWrapperClient.total_supply(),
        ammClient.twap_apy(),
        ammClient.quote_pt_for_sy({ pt_in: BigInt(1e7) }),
        syWrapperClient.exchange_rate(),
        fetchXlmPriceUsd(),
      ]);

    const ptSupplyXlm =
      ptSupplyRes.status === 'fulfilled' ? Number(unwrapResult(ptSupplyRes.value.result) || 0) / 1e7 : 0;
    const ytSupplyXlm =
      ytSupplyRes.status === 'fulfilled' ? Number(unwrapResult(ytSupplyRes.value.result) || 0) / 1e7 : 0;
    const totalDepositsXlm =
      syTotalSupplyRes.status === 'fulfilled' ? Number(unwrapResult(syTotalSupplyRes.value.result) || 0) / 1e7 : 0;

    let impliedYieldApy = 0;
    // Distinguish "the RPC call failed / returned garbage" (apyUnavailable) from a
    // genuine non-positive APY reading — both used to collapse into a silent 0,
    // which was indistinguishable from real 0% APY once persisted.
    let apyUnavailable = true;
    if (twapApyRes.status === 'fulfilled') {
      const rawTwapApy = Number(unwrapResult(twapApyRes.value.result));
      if (!isNaN(rawTwapApy)) {
        apyUnavailable = false;
        if (rawTwapApy > 0) impliedYieldApy = rawTwapApy / 100; // bps (1e4) -> percent
      }
    }

    let ptPriceUnderlying = 1.0;
    if (ptQuoteRes.status === 'fulfilled' && exchangeRateRes.status === 'fulfilled') {
      const syOut = Number(unwrapResult(ptQuoteRes.value.result) || 0) / 1e7;
      const rate = Number(unwrapResult(exchangeRateRes.value.result) || 0) / 1e18;
      if (!isNaN(syOut) && !isNaN(rate) && rate > 0) ptPriceUnderlying = syOut * rate;
    }

    // Reuse the exchange_rate read already fetched above for the persisted field.
    // This used to be a second RPC call with a freshly-imported client on every
    // snapshot tick. Kept at raw scale (no /1e18) to stay comparable with
    // syExchangeRate values already in ProtocolHistory — only the jump-ratio sanity
    // check and downstream charts consume it, both of which are scale-relative.
    let syExchangeRate: number | null = null;
    if (exchangeRateRes.status === 'fulfilled') {
      const raw = Number(unwrapResult(exchangeRateRes.value.result));
      syExchangeRate = !isNaN(raw) && raw > 0 ? raw : null;
    }

    const xlmPriceUsd = xlmPriceRes.status === 'fulfilled' ? xlmPriceRes.value : null;
    const priceUnavailable = xlmPriceUsd === null;
    const tvlXlm = totalDepositsXlm; // dexLiquidityXlm omitted — not needed for this snapshot's fields
    const tvlUsd = priceUnavailable ? 0 : tvlXlm * (xlmPriceUsd as number);

    return {
      ptPriceUnderlying,
      tvlXlm,
      tvlUsd,
      priceUnavailable,
      impliedYieldApy,
      apyUnavailable,
      ptSupplyXlm,
      ytSupplyXlm,
      syExchangeRate,
    };
  } catch (e) {
    console.error('[snapshotter] Failed to fetch protocol state:', e);
    return defaultState;
  }
}

/**
 * Takes one protocol-level snapshot and writes it to ProtocolHistory + TvlSnapshot.
 * Mirrors the sanity checks history-store.json's HistoryStore.addHistoryEntry() used
 * to apply (reject implausible >2x/<0.5x syExchangeRate jumps) so the same
 * data-integrity property carries over to the Postgres-backed replacement.
 */
export async function takeSnapshot(deployments: Record<string, string>, network: string) {
  const syWrapper = deployments.sy_wrapper;
  if (!syWrapper) return;

  const state = await getProtocolState(deployments);

  // A failed RPC/price read produces a well-formed but fake zero-TVL/zero-APY
  // state (see defaultState above) — write nothing rather than let a transient
  // outage silently corrupt history with data indistinguishable from the real thing.
  if (state.priceUnavailable || state.apyUnavailable) {
    console.warn('[snapshotter] Protocol state unavailable (price or APY read failed), skipping snapshot.');
    return;
  }

  const ptPrice = state.ptPriceUnderlying;
  const ytPrice = Math.max(0, 1.0 - ptPrice);
  const tvl = state.tvlUsd;
  const fixedApy = state.impliedYieldApy;

  if (!isFinite(ptPrice) || isNaN(ptPrice) || !isFinite(tvl) || isNaN(tvl) || !isFinite(fixedApy) || isNaN(fixedApy)) {
    console.warn('[snapshotter] Protocol state returned invalid values, skipping snapshot.');
    return;
  }

  const syExchangeRate = state.syExchangeRate;

  if (syExchangeRate !== null) {
    const last = await prisma.protocolHistory.findFirst({
      where: { network, syWrapper, syExchangeRate: { not: null } },
      orderBy: { timestamp: 'desc' },
    });
    if (last?.syExchangeRate) {
      const ratio = syExchangeRate / last.syExchangeRate;
      if (ratio > 2 || ratio < 0.5) {
        console.warn(
          `[snapshotter] syExchangeRate jumped implausibly (${last.syExchangeRate} -> ${syExchangeRate}), skipping snapshot.`
        );
        return;
      }
    }
  }

  // ptSupply/ytSupply live here rather than in a separate TvlSnapshot row — that model
  // otherwise duplicated `tvl` (as `totalValue`) with no reader anywhere in the repo.
  // TvlSnapshot itself is left in the schema (unpopulated) rather than deleted, per the
  // "don't remove a model just because it's currently unused" rule from the audit.
  await prisma.protocolHistory.create({
    data: {
      network,
      syWrapper,
      ptPrice,
      ytPrice,
      tvl,
      fixedApy,
      tradingVolume: 0,
      syExchangeRate,
      ptSupply: state.ptSupplyXlm.toString(),
      ytSupply: state.ytSupplyXlm.toString(),
      eventType: 'sync',
      txHash: null,
    },
  });
}
