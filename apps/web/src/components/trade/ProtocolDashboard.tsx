import React from 'react';
import { useTrade } from '../../hooks/useTrade';
import { usePortfolio } from '../../hooks/usePortfolio';

import { SectionCard } from '../ui/SectionCard';

export function ProtocolDashboard() {
  const { marketData, isLoadingMarket } = useTrade();
  const { portfolio } = usePortfolio();

  if (isLoadingMarket) {
    return (
      <div className="hidden lg:flex w-[400px]">
        <SectionCard className="w-full h-[560px]">
          <h2 className="text-sm font-medium text-[#F5F5F2] mb-6">Market Overview</h2>
          <div className="flex-1 bg-white/5 rounded-xl animate-pulse h-full w-full"></div>
        </SectionCard>
      </div>
    );
  }

  if (!marketData) {
    return null;
  }

  const tvl = marketData.ptReserve + marketData.underlyingReserve;

  return (
    <div className="hidden lg:flex w-[400px]">
      <SectionCard className="w-full h-[560px] overflow-y-auto">
        <h2 className="font-sans font-medium text-[22px] text-[#F5F5F2] tracking-tight mb-6">Live Protocol Dashboard</h2>
        <div className="space-y-4">
          <div className="flex justify-between items-center p-3 rounded-xl bg-white/[0.03] border border-white/10">
            <span className="text-sm text-[#F5F5F2]/60">Current PT Price</span>
            <span className="text-xl font-serif text-white">{marketData.ptPrice.toFixed(4)} XLM</span>
          </div>
          
          <div className="flex justify-between items-center p-3 rounded-xl bg-white/[0.03] border border-white/10">
            <span className="text-sm text-[#F5F5F2]/60">Current YT Price</span>
            <span className="text-xl font-serif text-white">{marketData.ytPrice.toFixed(4)} XLM</span>
          </div>

          <div className="flex justify-between items-center p-3 rounded-xl bg-white/[0.03] border border-white/10">
            <span className="text-sm text-[#F5F5F2]/60">Current Fixed APY</span>
            <span className="text-xl font-serif text-[#BEB7A7]">{marketData.fixedApy.toFixed(2)}%</span>
          </div>

          <div className="flex justify-between items-center p-3 rounded-xl bg-white/[0.03] border border-white/10">
            <span className="text-sm text-[#F5F5F2]/60">Fixed APY (TWAP)</span>
            <span className="text-xl font-serif text-white">{marketData.twapStale ? 'Stale' : `${marketData.twap.toFixed(2)}%`}</span>
          </div>

          <div className="border-t border-white/10 my-2"></div>

          <div className="flex justify-between items-center p-3 rounded-xl bg-white/[0.03] border border-white/10">
            <span className="text-sm text-[#F5F5F2]/60">PT Reserve</span>
            <span className="text-sm font-medium text-white">{marketData.ptReserve.toLocaleString()} PT</span>
          </div>

          <div className="flex justify-between items-center p-3 rounded-xl bg-white/[0.03] border border-white/10">
            <span className="text-sm text-[#F5F5F2]/60">Underlying Reserve</span>
            <span className="text-sm font-medium text-white">{marketData.underlyingReserve.toLocaleString()} XLM</span>
          </div>

          <div className="flex justify-between items-center p-3 rounded-xl bg-white/[0.03] border border-white/10">
            <span className="text-sm text-[#F5F5F2]/60">TVL</span>
            <span className="text-xl font-serif text-white">{tvl.toLocaleString()} XLM</span>
          </div>

          <div className="border-t border-white/10 my-2"></div>

          <div className="flex justify-between items-center p-3 rounded-xl bg-white/[0.03] border border-white/10">
            <span className="text-sm text-[#F5F5F2]/60">Current Epoch</span>
            <span className="text-sm font-medium text-white">Epoch 17</span>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
