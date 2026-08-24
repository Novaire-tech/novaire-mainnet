'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Info, Loader2, Settings2, Wallet, X } from 'lucide-react';
import { useTrade, TradeAsset, TradeAction } from '../../hooks/useTrade';
import { useWallet } from '../../hooks/useWallet';
import { NotificationService } from '../../services/notificationService';

export function TradeInterface() {
  const { isConnected, connect, balances, refreshBalances } = useWallet();
  const { marketData, isLoadingMarket, quote, isQuoting, quoteError, isExecuting, getQuote, executeTrade, refreshMarket } = useTrade();

  const [asset, setAsset] = useState<TradeAsset>('PT');
  const [action, setAction] = useState<TradeAction>('Buy');
  const [amount, setAmount] = useState<string>('');
  const [slippage, setSlippage] = useState<number>(0.5);

  const [showSlippageSettings, setShowSlippageSettings] = useState(false);
  const [showMarketInfo, setShowMarketInfo] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setMounted(true));
  }, []);

  const STROOP_SCALE = 10000000;

  // Handle amount change and quoting
  useEffect(() => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      getQuote(action, asset, 0, slippage);
      return;
    }
    const timer = setTimeout(() => {
      getQuote(action, asset, numAmount, slippage);
    }, 400); // Debounce
    return () => clearTimeout(timer);
  }, [amount, action, asset, slippage, getQuote]);

  // Determine which balance to show
  const balanceToDisplay = () => {
    if (action === 'Buy') {
      const b = balances.find(b => b.isNative || b.assetCode === 'XLM');
      return b ? parseFloat(b.amount) : 0;
    } else {
      // Selling PT or YT
      const b = balances.find(b => b.assetCode === asset || b.assetCode.includes(asset));
      // For now, if exact code not found, assume 0
      return b ? parseFloat(b.amount) : 0;
    }
  };

  const currentBalance = balanceToDisplay();

  const handleMax = () => {
    // Leave some XLM for fees if buying
    if (action === 'Buy' && currentBalance > 2) {
      setAmount((currentBalance - 1).toFixed(4));
    } else {
      setAmount(currentBalance.toString());
    }
  };

  const handleSwapExecute = async () => {
    try {
      const rawResult = await executeTrade(action, asset, parseFloat(amount), slippage);
      const result = rawResult as { hash?: string; id?: string; status?: string } | undefined;

      console.log('--- Transaction Post-Submission ---');
      console.log('Object returned by signAndSend:', result);
      console.log('Transaction hash:', result?.hash || result?.id || 'Unknown');
      console.log('RPC response:', result);
      console.log('Transaction status:', result?.status || 'Unknown');

      if (result && result.status && result.status !== 'SUCCESS') {
        console.error('Contract error:', result);
        NotificationService.addNotification('network', 'Trade Failed', `Trade transaction failed on-chain. Status: ${result.status}`);
        return;
      }
      
      // Success flow
      refreshBalances();
      refreshMarket();
      
      // Dispatch global event for Portfolio & Recent Activity to refresh
      window.dispatchEvent(new CustomEvent('nova:refresh'));
      
      NotificationService.addNotification('transaction', 'Trade Successful', `Successfully executed ${action} for ${amount} ${action === 'Buy' ? 'XLM' : asset}.`);
      setAmount('');
    } catch (e) {
      console.error('Swap Execution Exception:', e);
      NotificationService.addNotification('transaction', 'Trade Failed', e instanceof Error ? e.message : 'Failed to execute trade.');
    }
  };

  return (
    <div className="flex flex-col w-full h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl relative overflow-hidden transition-all duration-200 hover:border-[#BEB7A7]/50 hover:shadow-[0_0_20px_rgba(62,207,142,0.15)] hover:-translate-y-[3px]">
      {/* Decorative gradient */}
      <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-[#BEB7A7] opacity-[0.03] blur-[100px] rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none" />

      {/* Header Tabs */}
      <div className="flex items-center justify-between mb-6 relative z-50">
        <div className="flex bg-white/[0.03] border border-white/10 p-1 rounded-xl">
          <button
            onClick={() => setAction('Buy')}
            className={`px-6 py-2 text-sm font-medium rounded-lg transition-all ${
              action === 'Buy'
                ? 'bg-white/[0.06] text-[#F5F5F2] shadow-sm'
                : 'text-[#F5F5F2]/60 hover:text-[#F5F5F2]'
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => setAction('Sell')}
            className={`px-6 py-2 text-sm font-medium rounded-lg transition-all ${
              action === 'Sell'
                ? 'bg-white/[0.06] text-[#F5F5F2] shadow-sm'
                : 'text-[#F5F5F2]/60 hover:text-[#F5F5F2]'
            }`}
          >
            Sell
          </button>
        </div>
        
        <div className="relative flex items-center gap-1">
          <button 
            onClick={() => setShowMarketInfo(true)}
            className="p-2 transition-colors rounded-xl text-[#F5F5F2]/60 hover:text-[#F5F5F2] hover:bg-white/5"
          >
            <Info className="w-5 h-5" />
          </button>
          <div className="relative z-50">
            <button 
              onClick={() => setShowSlippageSettings(!showSlippageSettings)}
              className={`p-2 transition-colors rounded-xl relative z-50 ${showSlippageSettings ? 'bg-white/10 text-[#F5F5F2]' : 'text-[#F5F5F2]/60 hover:text-[#F5F5F2] hover:bg-white/5'}`}
            >
              <Settings2 className="w-5 h-5" />
            </button>
            
            {/* Local Slippage Dropdown */}
            <AnimatePresence>
              {showSlippageSettings && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowSlippageSettings(false)} />
                  <motion.div 
                    initial={{ opacity: 0, y: -5, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -5, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-12 z-50 w-[280px] rounded-xl border border-white/10 bg-[#111111]/95 backdrop-blur-xl p-4 shadow-2xl"
                  >
                    <h3 className="mb-3 text-sm font-medium text-white">Slippage Tolerance</h3>
                    <div className="flex gap-2 mb-3">
                      {[0.1, 0.5, 1.0].map(val => (
                        <button
                          key={val}
                          onClick={() => { setSlippage(val); setShowSlippageSettings(false); }}
                          className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
                            slippage === val ? 'bg-[#BEB7A7]/20 text-[#BEB7A7] border border-[#BEB7A7]/30' : 'bg-white/5 text-white/70 hover:bg-white/10 border border-transparent'
                          }`}
                        >
                          {val}%
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-[#F5F5F2]/60 font-medium">Custom (%)</span>
                      <input 
                        type="number" 
                        placeholder="0.0"
                        value={[0.1, 0.5, 1.0].includes(slippage) ? '' : slippage}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val) && val >= 0) setSlippage(val);
                        }}
                        className="w-20 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white text-right focus:outline-none focus:border-[#BEB7A7]/50 transition-colors"
                      />
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Input Section */}
      <div className="flex flex-col gap-1 z-10 relative">
        <div className="flex justify-between text-sm text-[#F5F5F2]/60 mb-1 px-1">
          <span>{action === 'Buy' ? 'You pay' : 'You sell'}</span>
          <span className="flex items-center gap-1 cursor-pointer hover:text-[#F5F5F2] transition-colors" onClick={handleMax}>
            <Wallet className="w-3 h-3" />
            {currentBalance.toFixed(4)} {action === 'Buy' ? 'XLM' : asset}
          </span>
        </div>
        
        <div className="flex items-center bg-white/[0.03] border border-white/10 rounded-2xl p-4 focus-within:border-[#BEB7A7]/50 transition-colors">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="bg-transparent text-3xl text-[#F5F5F2] font-semibold outline-none w-full placeholder:text-white/20"
          />
          <div className="flex items-center gap-2">
            <button onClick={handleMax} className="text-[10px] uppercase font-bold tracking-wider text-[#BEB7A7] bg-[#BEB7A7]/10 px-2 py-1 rounded-md">
              Max
            </button>
            <div className="flex items-center gap-2 bg-white/[0.06] border border-white/10 px-3 py-1.5 rounded-xl ml-2">
              <span className="text-sm font-medium text-[#F5F5F2]">{action === 'Buy' ? 'XLM' : asset}</span>
            </div>
          </div>
        </div>
      </div>



      {/* Output Section */}
      <div className="flex flex-col gap-1 z-10 relative">
        <div className="flex justify-between text-sm text-[#F5F5F2]/60 mb-1 px-1">
          <span>You receive</span>
        </div>
        
        <div className="flex items-center bg-white/[0.03] border border-white/10 rounded-2xl p-4 opacity-70">
          <div className="text-3xl text-[#F5F5F2] font-semibold w-full overflow-hidden text-ellipsis">
            {isQuoting ? (
              <Loader2 className="w-6 h-6 animate-spin text-[#F5F5F2]/60 mt-2" />
            ) : quote ? (
              quote.expectedOutput.toFixed(4)
            ) : (
              '0.0'
            )}
          </div>
          
          <div className="flex bg-white/[0.06] border border-white/10 p-1 rounded-xl shrink-0">
            <button
              onClick={() => setAsset('PT')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                asset === 'PT' && action === 'Buy'
                  ? 'bg-[#BEB7A7]/20 text-[#BEB7A7]'
                  : (asset === 'PT' ? 'bg-white/10 text-[#F5F5F2]' : 'text-[#F5F5F2]/60 hover:text-[#F5F5F2]')
              }`}
            >
              PT
            </button>
            <button
              onClick={() => setAsset('YT')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                asset === 'YT' && action === 'Buy'
                  ? 'bg-[#BEB7A7]/20 text-[#BEB7A7]'
                  : (asset === 'YT' ? 'bg-white/10 text-[#F5F5F2]' : 'text-[#F5F5F2]/60 hover:text-[#F5F5F2]')
              }`}
            >
              YT
            </button>
          </div>
        </div>
      </div>

      {quoteError && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
          {quoteError}
        </div>
      )}

      {!quoteError && quote?.warning && (
        <div
          className={
            quote.partialFill
              ? 'mt-4 p-3 bg-amber-500/15 border border-amber-500/40 rounded-xl text-amber-300 text-sm'
              : 'mt-4 p-3 bg-orange-500/10 border border-orange-500/20 rounded-xl text-orange-400 text-sm'
          }
        >
          {quote.partialFill && <div className="font-semibold mb-1">Market cannot absorb this size</div>}
          {quote.warning}
        </div>
      )}

      {/* Trade Info / Slippage */}
      <div className="mt-6 flex flex-col gap-3 px-2 z-10 relative">
        <div className="flex justify-between items-center text-sm">
          <span className="text-[#F5F5F2]/60 flex items-center gap-1">Price Impact <Info className="w-3 h-3" /></span>
          <span className={`font-medium ${quote && Math.abs(quote.priceImpact) > 2 ? 'text-orange-400' : 'text-[#F5F5F2]'}`}>
            {quote ? `${quote.priceImpact.toFixed(2)}%` : '---'}
          </span>
        </div>
        {quote?.actualSpend !== undefined && quote.partialFill && (
          <div className="flex justify-between items-center text-sm">
            <span className="text-[#F5F5F2]/60 flex items-center gap-1">You Will Spend <Info className="w-3 h-3" /></span>
            <span className="font-medium text-amber-300">
              {`${quote.actualSpend.toFixed(4)} of ${parseFloat(amount || '0').toFixed(4)} XLM`}
            </span>
          </div>
        )}
        <div className="flex justify-between items-center text-sm">
          <span className="text-[#F5F5F2]/60 flex items-center gap-1">Minimum Received <Info className="w-3 h-3" /></span>
          <span className="font-medium text-[#F5F5F2]">
            {quote ? `${quote.minimumReceived.toFixed(4)} ${action === 'Buy' ? asset : 'XLM'}` : '---'}
          </span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-[#F5F5F2]/60 flex items-center gap-1">Executable APY <Info className="w-3 h-3" /></span>
          <span className="font-medium text-[#BEB7A7]">
            {marketData ? `${marketData.fixedApy.toFixed(2)}%` : '---'}
          </span>
        </div>
      </div>

      <button
        onClick={!isConnected ? connect : handleSwapExecute}
        disabled={isExecuting || (isConnected && (!quote || !!quoteError))}
        className={`mt-6 w-full flex items-center justify-center gap-2 py-4 rounded-xl font-semibold text-lg transition-all duration-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${
          !isConnected 
            ? 'bg-white/[0.03] text-[#F5F5F2] border border-white/10 hover:bg-white/[0.06] hover:-translate-y-[1px]' 
            : 'bg-[#BEB7A7] text-black hover:brightness-110 hover:-translate-y-[1px] active:scale-[0.98]'
        }`}
      >
        {!isConnected ? (
          'Connect Wallet'
        ) : isExecuting ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Confirming...
          </span>
        ) : (
          `${action} ${asset}`
        )}
      </button>

      {/* Market Info Modal via Portal */}
      {mounted && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showMarketInfo && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md" onClick={() => setShowMarketInfo(false)}>
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.2 }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === 'Escape') setShowMarketInfo(false); }}
                tabIndex={-1}
                ref={(el) => { if (el) el.focus(); }}
                className="w-full max-w-2xl bg-white/[0.03] border border-white/10 rounded-2xl shadow-2xl overflow-hidden relative flex flex-col max-h-[70vh] outline-none"
              >
                {/* Header */}
                <div className="flex items-center justify-between p-4 md:p-5 border-b border-white/5 bg-[#0a0a0a]">
                  <div>
                    <h2 className="text-lg font-bold text-white">Market Information</h2>
                    <p className="text-xs text-[#F5F5F2]/60 font-medium">Live on-chain marketplace data</p>
                  </div>
                  <button onClick={() => setShowMarketInfo(false)} className="p-1.5 text-[#F5F5F2]/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="p-4 md:p-5 overflow-y-auto space-y-5 bg-[#111111] flex-1">
                  
                  {/* 1. Market Status */}
                  <div>
                    {(() => {
                      let status = { label: '🟢 Market Healthy', color: 'text-[#BEB7A7]', bg: 'bg-[#BEB7A7]/10', border: 'border-[#BEB7A7]/20', desc: 'The marketplace is operating normally with sufficient liquidity and active trading.' };
                      if (marketData) {
                        if (marketData.twapStale) {
                          status = { label: '⚪ Stale Market Data', color: 'text-[#F5F5F2]/60', bg: 'bg-white/5', border: 'border-white/10', desc: 'The on-chain TWAP checkpoint is stale. Yield estimates based on TWAP are unavailable until it refreshes.' };
                        } else if (marketData.twap >= 1.0) {
                          status = { label: '🔴 YT Trading Unavailable', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20', desc: 'PT TWAP has reached or exceeded 1.0. Yield Tokens (YT) currently have zero market value.' };
                        } else if (marketData.ptPrice > 1.0) {
                          status = { label: '🟠 High PT Premium', color: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/20', desc: 'Principal Tokens (PT) are trading at a premium above face value (1.0). YT market value may be temporarily zero.' };
                        } else if (marketData.ptReserve < 100 || marketData.ytReserve < 100 || marketData.underlyingReserve < 100) {
                          status = { label: '🟡 Thin Liquidity', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20', desc: 'Market reserves are low. Trades may experience higher slippage than usual.' };
                        }
                      }
                      return (
                        <div className={`p-3 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${status.bg} ${status.border}`}>
                          <span className={`text-sm font-bold whitespace-nowrap ${status.color}`}>{status.label}</span>
                          <span className="text-xs text-white/70">{status.desc}</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* 2. Live Prices */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/[0.06] border border-white/10 rounded-lg p-3 flex flex-col justify-center relative overflow-hidden group">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-[#BEB7A7] opacity-[0.02] rounded-full translate-x-1/3 -translate-y-1/3 group-hover:opacity-[0.05] transition-opacity" />
                      <h3 className="text-xs font-medium text-[#F5F5F2]/60 mb-1">PT Price</h3>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold text-white">{marketData ? marketData.ptPrice.toFixed(4) : '0.0000'}</span>
                        <span className="text-sm text-[#F5F5F2]/60 font-medium">XLM</span>
                      </div>
                    </div>
                    <div className="bg-white/[0.06] border border-white/10 rounded-lg p-3 flex flex-col justify-center relative overflow-hidden group">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500 opacity-[0.02] rounded-full translate-x-1/3 -translate-y-1/3 group-hover:opacity-[0.05] transition-opacity" />
                      <h3 className="text-xs font-medium text-[#F5F5F2]/60 mb-1">YT Price</h3>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold text-white">{marketData ? marketData.ytPrice.toFixed(4) : '0.0000'}</span>
                        <span className="text-sm text-[#F5F5F2]/60 font-medium">XLM</span>
                      </div>
                    </div>
                  </div>

                  {/* 3. Oracle */}
                  <div>
                    <h3 className="text-xs font-semibold text-[#F5F5F2]/60 uppercase tracking-wider mb-2">Oracle</h3>
                    <div className="bg-white/[0.03] border border-white/10 rounded-lg p-3 flex flex-row items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-[#F5F5F2]/60">TWAP:</span>
                        <span className="font-bold text-white">{!marketData ? '0.00000' : (marketData.twapStale ? 'Stale' : marketData.twap.toFixed(5))}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[#F5F5F2]/60">Spot:</span>
                        <span className="font-bold text-white">{marketData ? marketData.ptPrice.toFixed(5) : '0.00000'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-medium">
                        <span className="w-2 h-2 rounded-full bg-[#BEB7A7] animate-pulse" />
                        Real-time
                      </div>
                    </div>
                  </div>

                  {/* 4. Market Liquidity */}
                  <div>
                    <h3 className="text-xs font-semibold text-[#F5F5F2]/60 uppercase tracking-wider mb-2">Market Liquidity</h3>
                    <div className="bg-white/[0.03] border border-white/10 rounded-lg p-3 flex flex-row items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-[#F5F5F2]/60">PT:</span>
                        <span className="font-bold text-white">{marketData ? marketData.ptReserve.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[#F5F5F2]/60">YT:</span>
                        <span className="font-bold text-white">{marketData ? marketData.ytReserve.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[#F5F5F2]/60">XLM:</span>
                        <span className="font-bold text-white">{marketData ? marketData.underlyingReserve.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}</span>
                      </div>
                    </div>
                  </div>

                  {/* 5. Protocol Explanation */}
                  <div className="bg-white/5 border border-white/10 rounded-lg p-4 text-xs text-[#F5F5F2]/60 space-y-1.5">
                    <p>• PT price comes from the live marketplace.</p>
                    <p>• YT price = max(0, 1 − PT).</p>
                    <p>• Liquidity represents pool reserves, not your wallet balances.</p>
                  </div>

                </div>
                
                {/* 6. Footer */}
                <div className="p-3 border-t border-white/5 bg-[#0a0a0a] flex items-center justify-between text-[10px] text-[#F5F5F2]/60 font-medium">
                  <span className="flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5" /> Source: Live Soroban Marketplace Contract
                  </span>
                  <span className="flex items-center gap-1.5">
                    Updates every 15 seconds <span className="w-1.5 h-1.5 rounded-full bg-[#BEB7A7] animate-pulse" />
                  </span>
                </div>
                
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
