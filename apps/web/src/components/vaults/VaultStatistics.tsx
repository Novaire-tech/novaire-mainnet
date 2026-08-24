import { Vault } from '../../types';
import { Layers, Shield, Zap, TrendingUp, HandCoins } from 'lucide-react';

import { ProtocolState } from '@/services/protocolService';
import { MetricCard } from '../ui/MetricCard';

interface VaultStatisticsProps {
  vaults: Vault[];
  protocolState: ProtocolState | null;
}

export function VaultStatistics({ vaults, protocolState }: VaultStatisticsProps) {
  // Aggregate stats from available vaults

  const formatNumber = (num: number, maximumFractionDigits = 2) => 
    new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(num);

  const avgFixedApy = vaults.length > 0 
    ? vaults.reduce((acc, vault) => acc + vault.fixedApy, 0) / vaults.length 
    : 0;

  const stats = [
    { label: 'Protocol TVL', value: protocolState ? `${formatNumber(protocolState.tvlXlm)} XLM` : 'Loading...', icon: Shield, color: 'text-blue-400' },
    { label: 'Protocol Deposits', value: protocolState ? `${formatNumber(protocolState.totalDepositsXlm)} XLM` : 'Loading...', icon: ArrowDownToLineIcon, color: 'text-emerald-400' },
    { label: 'PT Supply', value: protocolState ? `${formatNumber(protocolState.ptSupplyXlm)} PT` : 'Loading...', icon: HandCoins, color: 'text-purple-400' },
    { label: 'YT Supply', value: protocolState ? `${formatNumber(protocolState.ytSupplyXlm)} YT` : 'Loading...', icon: Layers, color: 'text-orange-400' },
    { label: 'DEX Liquidity', value: protocolState ? (protocolState.dexLiquidityXlm > 0 ? `${formatNumber(protocolState.dexLiquidityXlm)} XLM` : 'No Active Liquidity Pool') : 'Loading...', icon: Zap, color: 'text-cyan-400' },
    { label: 'Avg Fixed APY', value: `${avgFixedApy.toFixed(2)}%`, icon: TrendingUp, color: 'text-nova-accent' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {stats.map((stat, i) => {
        return (
          <MetricCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            icon={stat.icon}
            index={i}
          />
        );
      })}
    </div>
  );
}

// Temporary icon fallback if ArrowDownToLine isn't directly available without explicit import block above
const ArrowDownToLineIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 17V3" />
    <path d="m6 11 6 6 6-6" />
    <path d="M19 21H5" />
  </svg>
);
