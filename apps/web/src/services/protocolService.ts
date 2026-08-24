import { PriceOracleService } from './priceOracleService';

export interface ProtocolState {
  tvlXlm: number;
  tvlUsd: number;
  /** True when the XLM/USD oracle could not be read. tvlUsd is meaningless (0) in this case — never display it as a real dollar value. */
  priceUnavailable: boolean;
  totalDepositsXlm: number;
  ptSupplyXlm: number;
  ytSupplyXlm: number;
  dexLiquidityXlm: number;
  impliedYieldApy: number;
  /** True when the on-chain TWAP checkpoint is stale (older than MAX_TWAP_AGE_LEDGERS). impliedYieldApy is 0 and must not be treated as real in this case. */
  twapStale: boolean;
  executableApy: number;
  ptPriceUnderlying: number;
}

export class ProtocolService {
  /**
   * Helper to unwrap Soroban Result types
   */
  private static unwrapResult(rawResult: unknown): unknown {
    if (rawResult !== undefined && typeof rawResult === 'object' && rawResult !== null) {
      const obj = rawResult as Record<string, unknown>;
      if (typeof obj.unwrap === 'function') return (obj.unwrap as () => unknown)();
      if ('ok' in obj) return obj.ok;
      if ('value' in obj) return obj.value;
    }
    return rawResult;
  }

  static async getProtocolState(): Promise<ProtocolState> {
    const defaultState: ProtocolState = {
      tvlXlm: 0,
      tvlUsd: 0,
      priceUnavailable: true,
      totalDepositsXlm: 0,
      ptSupplyXlm: 0,
      ytSupplyXlm: 0,
      dexLiquidityXlm: 0,
      impliedYieldApy: 0,
      twapStale: true,
      executableApy: 0,
      ptPriceUnderlying: 1.0,
    };

    try {
      // Dynamic imports to match portfolioService architecture
      const { Client: PtClient } = await import('../../../../packages/bindings/pt_token/src/index');
      const { Client: YtClient } = await import('../../../../packages/bindings/yt_token/src/index');
      const { Client: SyWrapperClient } = await import('../../../../packages/bindings/sy_wrapper/src/index');
      const { Client: AmmClient } = await import('../../../../packages/bindings/amm/src/index');
      const { CONTRACTS, RPC_URL, NETWORK_PASSPHRASE } = await import('../config/contracts');

      const clientOptions = {
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
      };

      const ptClient = new PtClient({ ...clientOptions, contractId: CONTRACTS.PT_TOKEN });
      const ytClient = new YtClient({ ...clientOptions, contractId: CONTRACTS.YT_TOKEN });
      const syWrapperClient = new SyWrapperClient({ ...clientOptions, contractId: CONTRACTS.SY_WRAPPER });
      const ammClient = new AmmClient({ ...clientOptions, contractId: CONTRACTS.AMM });

      // Fetch all state concurrently
      const [
        ptSupplyRes,
        ytSupplyRes,
        syTotalSupplyRes,
        reservePtRes,
        reserveSyRes,
        spotApyRes,
        twapApyRes
      ] = await Promise.allSettled([
        ptClient.total_supply(),
        ytClient.total_supply(),
        syWrapperClient.total_supply(),
        ammClient.reserve_pt(),
        ammClient.reserve_sy(),
        ammClient.spot_apy(),
        ammClient.twap_apy()
      ]);

      // Parse Results
      const ptSupplyXlm = ptSupplyRes.status === 'fulfilled' ? Number(this.unwrapResult(ptSupplyRes.value.result) || 0) / 1e7 : 0;
      const ytSupplyXlm = ytSupplyRes.status === 'fulfilled' ? Number(this.unwrapResult(ytSupplyRes.value.result) || 0) / 1e7 : 0;
      // SY shares ARE the deposit-tracking balance now — total SY supply stands in for the old vault total.
      const totalDepositsXlm = syTotalSupplyRes.status === 'fulfilled' ? Number(this.unwrapResult(syTotalSupplyRes.value.result) || 0) / 1e7 : 0;

      let dexLiquidityXlm = 0;
      if (reservePtRes.status === 'fulfilled' && reserveSyRes.status === 'fulfilled') {
        const reservePt = Number(this.unwrapResult(reservePtRes.value.result) || 0) / 1e7;
        const reserveSy = Number(this.unwrapResult(reserveSyRes.value.result) || 0) / 1e7;
        dexLiquidityXlm = reservePt + reserveSy;
      }

      let ptPriceUnderlying = 1.0;
      let impliedYieldApy = 0;
      let executableApy = 0;

      // amm.spot_apy() reports the executable APY directly, in basis points (bps, 1e4),
      // replacing the old price-to-APY derivation via calculateMarketImpliedApy off a raw PT price.
      const rawSpotApy = spotApyRes.status === 'fulfilled' ? Number(this.unwrapResult(spotApyRes.value.result)) : 0;

      // amm.twap_apy() has no documented "stale/reverts" behavior like the old
      // get_twap_rate_checked; treat any failure to reach the contract as stale and
      // never fabricate an implied APY from it.
      let rawTwapApy = 0;
      let twapStale = true;
      if (twapApyRes.status === 'fulfilled') {
        try {
          rawTwapApy = Number(this.unwrapResult(twapApyRes.value.result));
          twapStale = false;
        } catch {
          console.warn('TWAP APY is stale or unavailable (amm.twap_apy failed)');
        }
      }

      if (!isNaN(rawSpotApy) && rawSpotApy > 0) {
        executableApy = rawSpotApy / 100; // bps (1e4) -> percent
      }
      if (!twapStale && !isNaN(rawTwapApy) && rawTwapApy > 0) {
        impliedYieldApy = rawTwapApy / 100; // bps (1e4) -> percent
      } else {
        impliedYieldApy = 0;
      }

      // Spot PT price in underlying terms: quote 1 PT -> SY via the AMM, then convert
      // SY -> underlying via the SY Wrapper's exchange rate.
      try {
        const [ptQuoteRes, exchangeRateRes] = await Promise.allSettled([
          ammClient.quote_pt_for_sy({ pt_in: BigInt(1e7) }),
          syWrapperClient.exchange_rate()
        ]);
        if (ptQuoteRes.status === 'fulfilled' && exchangeRateRes.status === 'fulfilled') {
          const syOut = Number(this.unwrapResult(ptQuoteRes.value.result) || 0) / 1e7;
          const rate = Number(this.unwrapResult(exchangeRateRes.value.result) || 0) / 1e18; // WAD-scaled, underlying per SY share
          if (!isNaN(syOut) && !isNaN(rate) && rate > 0) {
            ptPriceUnderlying = syOut * rate;
          }
        }
      } catch {
        console.warn('Could not derive PT spot price from AMM/SY Wrapper');
      }

      // XLM Price for TVL calculation. Never fabricate a price: if the oracle is
      // unavailable, tvlUsd must be surfaced as unavailable, not computed from a guess.
      let xlmPriceUsd = 0;
      let priceUnavailable = true;
      try {
        const priceData = await PriceOracleService.getAssetPrice('XLM');
        if (priceData && priceData.priceUsd > 0) {
          xlmPriceUsd = priceData.priceUsd;
          priceUnavailable = false;
        }
      } catch {
        console.warn('Could not fetch XLM price: oracle unavailable');
      }

      // TVL = Total Deposits (SY Wrapper) + DEX Underlying Reserves
      const tvlXlm = totalDepositsXlm + (dexLiquidityXlm / 2);
      const tvlUsd = priceUnavailable ? 0 : tvlXlm * xlmPriceUsd;

      return {
        tvlXlm,
        tvlUsd,
        priceUnavailable,
        totalDepositsXlm,
        ptSupplyXlm,
        ytSupplyXlm,
        dexLiquidityXlm,
        impliedYieldApy,
        twapStale,
        executableApy,
        ptPriceUnderlying
      };
    } catch (e) {
      console.error('Failed to fetch protocol state:', e);
      return defaultState;
    }
  }
}
