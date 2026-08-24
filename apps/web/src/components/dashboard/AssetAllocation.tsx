'use client';

import { motion } from 'framer-motion';
import { usePortfolio } from '../../hooks/usePortfolio';
import { CardWaveDecoration } from '../ui/CardWaveDecoration';

const PALETTE = ['#BEB7A7', '#F5F5F2', '#4A4A4A', '#8E8E8E', '#2A2A2A'];

export function AssetAllocation() {
  const { portfolio, loading, error } = usePortfolio();

  if (loading) {
    return (
      <div className="relative flex h-[320px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <CardWaveDecoration />
        <h3 className="relative z-10 font-sans font-medium ">Asset Allocation</h3>
        <div className="relative z-10 mt-6 flex flex-1 items-center justify-center">
          <div className="h-40 w-40 animate-pulse rounded-full border-4 border-white/10" />
        </div>
      </div>
    );
  }

  if (error === 'Wallet not connected' || portfolio?.error === 'Wallet not connected') {
    return (
      <div className="relative flex h-[320px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <CardWaveDecoration />
        <h3 className="relative z-10 font-sans font-medium ">Asset Allocation</h3>
        <div className="relative z-10 mt-6 flex flex-1 items-center justify-center text-[#F5F5F2]/60 text-sm">
          Connect Wallet
        </div>
      </div>
    );
  }

  const allocations = portfolio?.allocation || [];
  if (allocations.length === 0) {
    return (
      <div className="relative flex h-[320px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <CardWaveDecoration />
        <h3 className="relative z-10 font-sans font-medium ">Asset Allocation</h3>
        <div className="relative z-10 mt-6 flex flex-1 items-center justify-center text-[#F5F5F2]/60 text-sm text-center px-4">
          No holdings yet.<br/>Connect your wallet and deposit assets to view your allocation.
        </div>
      </div>
    );
  }

  const totalValue = portfolio?.totalValueUsd || 0;

  // Prepare drawing data
  const chartData = allocations.reduce<Array<typeof allocations[number] & { color: string; dashArray: string; dashOffset: number }>>((acc, alloc, idx) => {
    const percent = alloc.percentage;
    const offset = acc.length > 0 ? acc[acc.length - 1].dashOffset - acc[acc.length - 1].percentage : 0;
    acc.push({
      ...alloc,
      color: PALETTE[idx % PALETTE.length],
      dashArray: `${percent} ${100 - percent}`,
      dashOffset: offset
    });
    return acc;
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4, ease: 'easeOut' }}
      className="relative flex h-[320px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-[#BEB7A7]/50"
    >
      <CardWaveDecoration />
      <h3 className="relative z-10 font-sans font-medium ">Asset Allocation</h3>

      <div className="relative z-10 mt-6 flex flex-1 items-center justify-between">
        
        {/* Custom SVG Donut Chart */}
        <div className="relative h-40 w-40 shrink-0">
          <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
            {/* Background Ring */}
            <path
              className="text-white/5"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            />
            {/* Segments (Simulated via stroke-dasharray) */}
            {chartData.map((data, i) => (
              <motion.path
                key={data.assetCode}
                initial={{ strokeDasharray: '0 100', strokeDashoffset: data.dashOffset }}
                animate={{ strokeDasharray: data.dashArray, strokeDashoffset: data.dashOffset }}
                transition={{ duration: 1.5, ease: 'easeOut', delay: 0.5 + i * 0.1 }}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke={data.color}
                strokeWidth="3"
              />
            ))}
          </svg>
          {/* Inner Total */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] text-[#F5F5F2]/60 uppercase tracking-wider">Portfolio</span>
            <span className="font-serif text-[15px] text-[#F5F5F2] mt-0.5">
              ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-col gap-4 w-full pl-6 overflow-y-auto max-h-[160px] pr-2">
          {chartData.map((item, i) => (
            <motion.div
              key={item.assetCode}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.8 + i * 0.1 }}
              className="flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <div
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-xs text-[#F5F5F2]/60 truncate">{item.assetCode}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs font-medium text-[#F5F5F2]">
                  ${item.valueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="w-8 text-right text-[10px] text-[#F5F5F2]/60">{item.percentage.toFixed(0)}%</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
