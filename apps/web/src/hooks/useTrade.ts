import { useState, useCallback, useEffect } from 'react';
import { WalletService } from '../services/walletService';
import { NotificationService } from '../services/notificationService';
import { CONTRACTS, RPC_URL, NETWORK_PASSPHRASE } from '../config/contracts';
import { applySlippage } from '../utils/slippage';
import { Errors } from '../../../../packages/bindings/amm/src/index';

export type TradeAsset = 'PT' | 'YT';
export type TradeAction = 'Buy' | 'Sell';

export interface MarketData {
  ptPrice: number;
  ytPrice: number;
  twap: number;
  /** True when amm.twap_apy() failed/reverted (checkpoint stale or unavailable). twap is 0 and must not be displayed as real market data. */
  twapStale: boolean;
  ptReserve: number;
  ytReserve: number;
  underlyingReserve: number;
  /** Current Fixed APY — AMM's canonical spot implied PT yield (amm.spot_apy()). Not derived locally. */
  fixedApy: number;
  /** Raw YT/PT price ratio, expressed as a percentage. NOT an APY — not annualized, not maturity-aware. */
  ytPtRatio: number;
}

export interface TradeQuote {
  expectedOutput: number;
  minimumReceived: number;
  priceImpact: number;
  slippage: number;
  /** Set when trade size is large relative to thin YT depth (near-par pool or early-epoch small pool). Non-blocking. */
  warning?: string;
  /**
   * Underlying the swap will ACTUALLY spend, which can be less than the amount
   * entered. The AMM's exact-in solver is bounded by the curve, so past a
   * saturation point extra input buys nothing — the contract charges only the
   * curve cost and leaves the remainder with the trader. Buy routes only;
   * undefined on sells, where the full input is always consumed.
   */
  actualSpend?: number;
  /**
   * True when `actualSpend` is materially below the requested amount, i.e. the
   * market cannot absorb this size. The trade is safe to submit (the surplus is
   * simply not charged) but the user is not getting the trade they asked for.
   */
  partialFill?: boolean;
}

// Mirrors contracts/amm/src/lib.rs Error enum / packages/bindings/amm/src/index.ts Errors map.
const AMM_ERROR_MESSAGES: Record<string, string> = {
  AlreadyInitialized: 'Market already initialized.',
  NotInitialized: 'Market not initialized.',
  InvalidMaturity: 'Invalid maturity.',
  InvalidAmount: 'Invalid trade amount.',
  InvalidScalarRoot: 'Invalid market parameters.',
  InvalidAnchor: 'Invalid market parameters.',
  InvalidFee: 'Invalid fee configuration.',
  InvalidTwapWindow: 'Invalid TWAP window.',
  MarketNotSeeded: 'This market has not been seeded with liquidity yet.',
  MarketMatured: 'This market has matured.',
  SlippageExceeded: 'Price moved beyond your slippage tolerance.',
  InsufficientLiquidity: 'Pool liquidity is too low for this trade size.',
  MathOverflow: 'Trade amount is too large — calculation overflow.',
  MarketProportionTooHigh: 'Trade would push the pool too far out of balance. Try a smaller amount.',
  ExchangeRateBelowOne: 'Exchange rate is below the allowed minimum for this trade.',
  UnsupportedRoute: 'Unsupported trade route.',
  TradeNotFound: 'Trade not found.',
  InputOutOfBounds: 'Trade input is out of bounds for this market.',
  InvalidSyRate: 'Invalid yield-bearing asset rate — try again shortly.',
};

function parseTradeError(e: unknown): string {
  const msg = (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : null) || String(e);

  // Soroban contract errors surface as e.g. "Error(Contract, #14)" — map the numeric
  // code through the generated Errors enum before falling back to text sniffing.
  const codeMatch = msg.match(/Error\(Contract,\s*#(\d+)\)/) || msg.match(/#(\d+)\)/);
  if (codeMatch) {
    const code = Number(codeMatch[1]);
    const entry = (Errors as Record<number, { message: string }>)[code];
    const friendly = entry && AMM_ERROR_MESSAGES[entry.message];
    if (friendly) return friendly;
  }

  // Fallback: not a recognized AMM contract error — sniff wallet/network/generic text.
  if (msg.includes('Insufficient balance') || (msg.includes('HostError') && (msg.includes('balance') || msg.includes('transfer') || msg.includes('underfunded')))) return 'Insufficient balance.';
  if (msg.includes('timeout') || msg.includes('Network error') || msg.includes('fetch') || msg.includes('Failed to fetch') || msg.includes('Simulation failed')) return 'Network error.';
  if (msg.includes('User rejected') || msg.includes('UserRejected') || msg.includes('User declined')) return 'Transaction cancelled.';
  if (msg.includes('liquidity') || msg.includes('Liquidity')) return 'Pool liquidity is too low for this trade size.';
  if (msg.includes('slippage') || msg.includes('Slippage') || msg.includes('MinOut')) return 'Price moved beyond your slippage tolerance.';
  if (msg.includes('matured') || msg.includes('Matured')) return 'This market has matured.';

  return 'Unexpected protocol error.';
}

/**
 * Unwraps a contract method returning `Result<(i128, i128)>` into a bigint pair.
 * Used by the `quote_*_cost` entrypoints, which return `(amount_out, sy_used)`.
 */
function unwrapPair(result: unknown): [bigint, bigint] {
  let value: unknown = result;
  if (value && typeof value === 'object' && typeof (value as { unwrap?: unknown }).unwrap === 'function') {
    value = ((value as { unwrap: () => unknown }).unwrap)();
  }
  if (Array.isArray(value) && value.length === 2) {
    return [BigInt(value[0] as string | number | bigint), BigInt(value[1] as string | number | bigint)];
  }
  return [0n, 0n];
}

function unwrapResult(result: unknown): bigint | null {
  if (result === undefined || result === null) return null;
  if (typeof result === 'bigint' || typeof result === 'number') return BigInt(result);
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (typeof obj.unwrap === 'function') {
      const unwrapped = (obj.unwrap as () => unknown)();
      return typeof unwrapped === 'bigint' ? unwrapped : BigInt(unwrapped as string | number | bigint);
    }
  }
  return null;
}

export function useTrade() {
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [isLoadingMarket, setIsLoadingMarket] = useState(true);
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const STROOP_SCALE = 10000000;
  const WAD_SCALE = 1e18;

  const fetchMarketData = useCallback(async () => {
    try {
      const { Client: AmmClient } = await import('../../../../packages/bindings/amm/src/index');
      const { Client: SyWrapperClient } = await import('../../../../packages/bindings/sy_wrapper/src/index');
      // A real, funded account is required here even for read-only simulation
      // (rpc.Server.getAccountEntry looks it up to build the envelope). Falls
      // back to the deployer address written by the deploy script, which is
      // always a real funded testnet/mainnet account.
      const address = await WalletService.getWalletAddress() || process.env.NEXT_PUBLIC_SIMULATION_SOURCE_ADDRESS || '';

      const clientOptions = { rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE, publicKey: address };
      const ammClient = new AmmClient({ ...clientOptions, contractId: CONTRACTS.AMM });
      const syWrapperClient = new SyWrapperClient({ ...clientOptions, contractId: CONTRACTS.SY_WRAPPER });

      // PT/YT prices in underlying terms: quote 1 PT/YT -> SY via the AMM, then convert
      // SY -> underlying via the SY Wrapper's exchange rate (the AMM only trades SY<->PT/YT).
      const [ptQuoteTx, ytQuoteTx, exchangeRateTx] = await Promise.all([
        ammClient.quote_pt_for_sy({ pt_in: BigInt(STROOP_SCALE) }),
        ammClient.quote_yt_for_sy({ yt_in: BigInt(STROOP_SCALE) }),
        syWrapperClient.exchange_rate(),
      ]);

      const rate = Number(unwrapResult(exchangeRateTx.result) || 0n) / WAD_SCALE;
      const ptSyOut = Number(unwrapResult(ptQuoteTx.result) || 0n) / STROOP_SCALE;
      const ytSyOut = Number(unwrapResult(ytQuoteTx.result) || 0n) / STROOP_SCALE;
      const ptPrice = rate > 0 ? ptSyOut * rate : 0;
      const ytPrice = rate > 0 ? ytSyOut * rate : 0;

      // amm.twap_apy() has no documented "stale/reverts" behavior like the old
      // get_twap_rate_checked; treat any failure to reach the contract as stale.
      let twap = 0;
      let twapStale = true;
      try {
        const twapTx = await ammClient.twap_apy();
        twap = Number(unwrapResult(twapTx.result) || 0n) / 100; // bps (1e4) -> percent
        twapStale = false;
      } catch {
        console.warn('TWAP APY is stale or unavailable (amm.twap_apy failed)');
      }

      // Current Fixed APY comes from the AMM's canonical spot implied rate, not a
      // locally recomputed PT-price/maturity formula. Blend is the yield source
      // (via the SY exchange rate above); the AMM only prices PT/SY and exposes the
      // market-implied fixed rate that pricing implies.
      let fixedApy = 0;
      try {
        const spotApyTx = await ammClient.spot_apy();
        fixedApy = Number(unwrapResult(spotApyTx.result) || 0n) / 100; // bps (1e4) -> percent
      } catch (e) {
        console.warn('Failed to fetch AMM spot APY', e);
      }

      let ptRes = 0, ytRes = 0, undRes = 0;
      try {
        const [reservePtTx, reserveSyTx] = await Promise.all([
          ammClient.reserve_pt(),
          ammClient.reserve_sy(),
        ]);
        ptRes = Number(unwrapResult(reservePtTx.result) || 0n) / STROOP_SCALE;
        undRes = Number(unwrapResult(reserveSyTx.result) || 0n) / STROOP_SCALE;
        // The AMM pools SY<->PT; there is no separate YT reserve leg to read directly.
        ytRes = 0;
      } catch (e) {
        console.warn('Failed to fetch AMM reserves', e);
      }

      const ytPtRatio = ptPrice > 0 ? (ytPrice / ptPrice) * 100 : 0;

      setMarketData({
        ptPrice: isNaN(ptPrice) ? 0 : ptPrice,
        ytPrice: isNaN(ytPrice) ? 0 : ytPrice,
        twap: isNaN(twap) ? 0 : twap,
        twapStale,
        ptReserve: ptRes,
        ytReserve: ytRes,
        underlyingReserve: undRes,
        fixedApy: isNaN(fixedApy) ? 0 : fixedApy,
        ytPtRatio: isNaN(ytPtRatio) ? 0 : ytPtRatio,
      });
    } catch (e) {
      console.error('Failed to fetch market data', e);
    } finally {
      setIsLoadingMarket(false);
    }
  }, []);

  const getQuote = useCallback(async (action: TradeAction, asset: TradeAsset, amountIn: number, slippagePercent: number) => {
    if (!amountIn || amountIn <= 0) {
      setQuote(null);
      setQuoteError(null);
      return;
    }

    setIsQuoting(true);
    setQuoteError(null);

    try {
      const address = await WalletService.getWalletAddress();
      if (!address) throw new Error('Wallet not connected');

      const { Client: AmmClient } = await import('../../../../packages/bindings/amm/src/index');
      const { Client: SyWrapperClient } = await import('../../../../packages/bindings/sy_wrapper/src/index');
      const clientOptions = { rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE, publicKey: address };
      const ammClient = new AmmClient({ ...clientOptions, contractId: CONTRACTS.AMM });
      const syWrapperClient = new SyWrapperClient({ ...clientOptions, contractId: CONTRACTS.SY_WRAPPER });

      const amountInStroops = BigInt(Math.floor(amountIn * STROOP_SCALE));

      // There is no direct underlying<->PT/YT swap anymore. Buying/selling PT or YT
      // routes underlying through SY first: deposit() to mint SY, then swap SY<->PT/YT.
      // We can't simulate deposit() + swap in one read-only round trip, so approximate
      // the underlying-denominated quote using the live SY exchange rate for the
      // deposit leg, and the AMM's read-only quote_* for the swap leg.
      const exchangeRateTx = await syWrapperClient.exchange_rate();
      const rate = Number(unwrapResult(exchangeRateTx.result) || 0n) / WAD_SCALE;
      if (!(rate > 0)) throw new Error('SY exchange rate unavailable');

      let outStroops = 0n;
      // SY the swap will actually consume on a buy. The AMM returns this
      // alongside the output because its exact-in solver is curve-bounded: past
      // the saturation point, more input buys nothing and is not charged. Left
      // null on sells, where the whole input is always consumed.
      let syUsedStroops: bigint | null = null;
      let syInStroops = 0n;

      if (action === 'Buy' && asset === 'PT') {
        syInStroops = BigInt(Math.floor(Number(amountInStroops) / rate));
        const tx = await ammClient.quote_sy_for_pt_cost({ sy_in: syInStroops });
        const [ptOut, syUsed] = unwrapPair(tx.result);
        outStroops = ptOut;
        syUsedStroops = syUsed;
      } else if (action === 'Sell' && asset === 'PT') {
        const tx = await ammClient.quote_pt_for_sy({ pt_in: amountInStroops });
        const syOut = unwrapResult(tx.result) || 0n;
        outStroops = BigInt(Math.floor(Number(syOut) * rate));
      } else if (action === 'Buy' && asset === 'YT') {
        syInStroops = BigInt(Math.floor(Number(amountInStroops) / rate));
        const tx = await ammClient.quote_sy_for_yt_cost({ sy_in: syInStroops });
        const [ytOut, syUsed] = unwrapPair(tx.result);
        outStroops = ytOut;
        syUsedStroops = syUsed;
      } else if (action === 'Sell' && asset === 'YT') {
        const tx = await ammClient.quote_yt_for_sy({ yt_in: amountInStroops });
        const syOut = unwrapResult(tx.result) || 0n;
        outStroops = BigInt(Math.floor(Number(syOut) * rate));
      }

      if (outStroops === 0n) {
        throw new Error('InsufficientLiquidity');
      }

      const expectedOutput = Number(outStroops) / STROOP_SCALE;
      const minimumReceived = expectedOutput * (1 - slippagePercent / 100);

      // Calculate price impact (rough estimation)
      let priceImpact = 0;
      let largeTradeWarning: string | undefined;
      if (marketData) {
        if (action === 'Buy' && asset === 'PT') {
          const expectedPrice = amountIn / expectedOutput;
          // Buy: worse price is higher, so market - expected will be negative
          priceImpact = ((marketData.ptPrice - expectedPrice) / marketData.ptPrice) * 100;
        } else if (action === 'Sell' && asset === 'PT') {
          const expectedPrice = expectedOutput / amountIn;
          // Sell: worse price is lower, so expected - market will be negative
          priceImpact = ((expectedPrice - marketData.ptPrice) / marketData.ptPrice) * 100;
        } else if (action === 'Buy' && asset === 'YT') {
          const expectedPrice = amountIn / expectedOutput;
          priceImpact = marketData.ytPrice > 0 ? ((marketData.ytPrice - expectedPrice) / marketData.ytPrice) * 100 : 0;
        } else if (action === 'Sell' && asset === 'YT') {
          const expectedPrice = expectedOutput / amountIn;
          priceImpact = marketData.ytPrice > 0 ? ((expectedPrice - marketData.ytPrice) / marketData.ytPrice) * 100 : 0;
        }

        // Thin YT depth (near-par pools, or a small/young pool near its MINIMUM_LIQUIDITY
        // floor) makes large-relative-size YT trades genuinely fragile — this is correct
        // AMM behavior, not a bug, but worth flagging before the user submits.
        if (asset === 'YT' && Math.abs(priceImpact) > 10) {
          largeTradeWarning = 'Large price impact for this trade size — YT liquidity is thin right now. Consider a smaller amount.';
        }
      }

      // Translate the SY the contract will actually charge back into underlying
      // for display. A materially short spend means the curve saturated: the
      // trade is safe to submit (the surplus is simply never charged) but the
      // user is not getting the size they asked for, and must be told so before
      // they sign rather than discovering it in their balance afterwards.
      let actualSpend: number | undefined;
      let partialFill = false;
      if (syUsedStroops !== null && syInStroops > 0n) {
        actualSpend = (Number(syUsedStroops) * rate) / STROOP_SCALE;
        // 0.5% tolerance absorbs the deposit-leg rate estimate and the
        // solver's one-unit rounding gap; anything beyond that is real.
        partialFill = Number(syUsedStroops) < Number(syInStroops) * 0.995;
        if (partialFill) {
          const pct = Math.round((1 - Number(syUsedStroops) / Number(syInStroops)) * 100);
          largeTradeWarning =
            `This market can only absorb about ${actualSpend.toFixed(4)} of the ${amountIn.toFixed(4)} you entered ` +
            `(${pct}% would go unspent). You will only be charged for the filled portion — ` +
            `reduce the amount to see the full quote.`;
        }
      }

      setQuote({
        expectedOutput,
        minimumReceived,
        priceImpact,
        slippage: slippagePercent,
        warning: largeTradeWarning,
        actualSpend,
        partialFill,
      });
    } catch (e) {
      setQuote(null);
      setQuoteError(parseTradeError(e));
    } finally {
      setIsQuoting(false);
    }
  }, [marketData]);

  const executeTrade = useCallback(async (action: TradeAction, asset: TradeAsset, amountIn: number, slippagePercent: number) => {
    setIsExecuting(true);
    try {
      const address = await WalletService.getWalletAddress();
      if (!address) throw new Error('Wallet not connected');

      const { signTransaction } = await import('@stellar/freighter-api');
      const { Client: AmmClient } = await import('../../../../packages/bindings/amm/src/index');
      const { Client: SyWrapperClient } = await import('../../../../packages/bindings/sy_wrapper/src/index');

      const clientOptions = { rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE, publicKey: address };
      const ammClient = new AmmClient({ ...clientOptions, contractId: CONTRACTS.AMM });
      const syWrapperClient = new SyWrapperClient({ ...clientOptions, contractId: CONTRACTS.SY_WRAPPER });

      const amountInStroops = BigInt(Math.floor(amountIn * STROOP_SCALE));

      if (!quote) throw new Error('No valid quote available');

      let result: unknown;

      if (action === 'Buy' && (asset === 'PT' || asset === 'YT')) {
        // Buying PT/YT with underlying: first deposit underlying into the SY Wrapper to
        // mint SY, then swap SY for PT/YT on the AMM. Two on-chain transactions.
        const depositTx = await syWrapperClient.deposit({ from: address, amount: amountInStroops });
        const depositResult = await depositTx.signAndSend({ signTransaction });
        const syMinted = unwrapResult(depositTx.result) || 0n;

        // Resimulate against the actually-minted SY amount and current pool state
        // immediately before signing — quote.minimumReceived may be stale (built from
        // a debounced quote seconds/minutes old, no freshness check on it).
        const freshQuoteTx = asset === 'PT'
          ? await ammClient.quote_sy_for_pt_cost({ sy_in: syMinted })
          : await ammClient.quote_sy_for_yt_cost({ sy_in: syMinted });
        const [freshOut, freshSyUsed] = unwrapPair(freshQuoteTx.result);
        const minOutStroops = applySlippage(freshOut, slippagePercent);

        // The AMM charges only `freshSyUsed` and leaves the rest of `syMinted`
        // with the trader as SY. That is safe, but it silently converts a
        // "swap all my underlying" intent into a partial fill plus a leftover
        // SY balance the portfolio UI does not surface, so warn loudly.
        if (freshSyUsed > 0n && Number(freshSyUsed) < Number(syMinted) * 0.995) {
          const leftover = Number(syMinted - freshSyUsed) / STROOP_SCALE;
          NotificationService.addNotification(
            'transaction',
            'Partial fill',
            `The market could only absorb part of this trade. About ${leftover.toFixed(4)} SY was not spent ` +
            `and remains in your wallet — you can swap or redeem it separately.`,
          );
        }

        const swapTx = asset === 'PT'
          ? await ammClient.swap_sy_for_pt({ from: address, sy_in: syMinted, min_pt_out: minOutStroops })
          : await ammClient.swap_sy_for_yt({ from: address, sy_in: syMinted, min_yt_out: minOutStroops });
        result = await swapTx.signAndSend({ signTransaction });
        if (!depositResult) throw new Error('SY deposit failed on-chain');
      } else if (action === 'Sell' && (asset === 'PT' || asset === 'YT')) {
        // Selling PT/YT for underlying: first swap PT/YT for SY on the AMM, then redeem
        // the SY for underlying via the SY Wrapper. Two on-chain transactions.

        // Resimulate immediately before signing rather than trusting the debounced
        // quote's minimumReceived (was previously hardcoded to 1n — no real protection).
        const freshQuoteTx = asset === 'PT'
          ? await ammClient.quote_pt_for_sy({ pt_in: amountInStroops })
          : await ammClient.quote_yt_for_sy({ yt_in: amountInStroops });
        const freshSyOut = unwrapResult(freshQuoteTx.result) || 0n;
        const minSyOutStroops = applySlippage(freshSyOut, slippagePercent);

        const swapTx = asset === 'PT'
          ? await ammClient.swap_pt_for_sy({ from: address, pt_in: amountInStroops, min_sy_out: minSyOutStroops })
          : await ammClient.swap_yt_for_sy({ from: address, yt_in: amountInStroops, min_sy_out: minSyOutStroops });
        const swapResult = await swapTx.signAndSend({ signTransaction });
        const syReceived = unwrapResult(swapTx.result) || 0n;

        const redeemTx = await syWrapperClient.redeem({ from: address, sy_amount: syReceived });
        result = await redeemTx.signAndSend({ signTransaction });
        if (!swapResult) throw new Error('AMM swap failed on-chain');
      }

      if (!result) throw new Error('Transaction assembly failed');

      return result;
    } catch (e) {
      console.error('Trade execution failed', e);
      throw new Error(parseTradeError(e));
    } finally {
      setIsExecuting(false);
    }
  }, [quote]);

  useEffect(() => {
    queueMicrotask(() => { fetchMarketData(); });
    const interval = setInterval(fetchMarketData, 15000); // 15s refresh
    return () => clearInterval(interval);
  }, [fetchMarketData]);

  return {
    marketData,
    isLoadingMarket,
    quote,
    isQuoting,
    quoteError,
    isExecuting,
    getQuote,
    executeTrade,
    refreshMarket: fetchMarketData
  };
}
