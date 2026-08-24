'use client';

import { Briefcase, HandCoins, Activity, ShieldCheck } from 'lucide-react';
import { usePortfolio } from '../../hooks/usePortfolio';
import { useState, useEffect } from 'react';
import { YieldService } from '../../services/yieldService';
import type { Vault } from '../../types';
import { MetricCard } from '../ui/MetricCard';

export function PortfolioKPICards() {
  const { portfolio, loading, error } = usePortfolio();
  const [vaults, setVaults] = useState<Vault[]>([]);

  useEffect(() => {
    YieldService.getVaults().then(setVaults).catch(console.error);
  }, []);

  const formatUsd = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

  const getPortfolioValue = () => {
    if (loading) return <div className="h-7 w-32 animate-pulse rounded bg-white/10" />;
    if (error === 'Wallet not connected' || portfolio?.error === 'Wallet not connected') return 'Connect Wallet';
    if (!portfolio || isNaN(portfolio.totalValueUsd)) return '$0.00';
    return formatUsd(portfolio.totalValueUsd);
  };

  const yieldAssets = portfolio?.assets?.filter(a => a.assetType === 'pt' || a.assetType === 'yt') || [];
  const totalYieldPositions = yieldAssets.length;
  const activeVaultsCount = new Set(yieldAssets.map(a => a.issuer)).size;
  const claimableYield = portfolio?.metrics?.totalClaimableYieldUsd || 0;

  const getClaimableYield = () => {
    if (loading) return <div className="h-7 w-32 animate-pulse rounded bg-white/10" />;
    if (error === 'Wallet not connected' || portfolio?.error === 'Wallet not connected') return 'Connect Wallet';
    return formatUsd(claimableYield);
  };

  const getCount = (value: number) => {
    if (loading) return <div className="h-7 w-16 animate-pulse rounded bg-white/10" />;
    if (error === 'Wallet not connected' || portfolio?.error === 'Wallet not connected') return '-';
    return value.toString();
  };

  const kpis = [
    {
      id: 'portfolio',
      label: 'Total Portfolio Value',
      value: getPortfolioValue(),
      change: undefined,
      isPositive: true,
      icon: Briefcase,
      sparkline: 'M0,15 Q5,5 10,12 T20,10 T30,18 T40,5 T50,8',
    },
    {
      id: 'positions',
      label: 'Yield Positions',
      value: getCount(totalYieldPositions),
      change: totalYieldPositions > 0 ? 'Active' : undefined,
      isPositive: true,
      icon: Activity,
      sparkline: 'M0,15 Q10,5 20,12 T30,4 T40,15 T50,8',
    },
    {
      id: 'claimable',
      label: 'Claimable Yield',
      value: getClaimableYield(),
      change: claimableYield > 0 ? 'Ready to Claim' : undefined,
      isPositive: true,
      icon: HandCoins,
      sparkline: 'M0,10 Q10,15 20,10 T30,12 T40,8 T50,5',
      tooltip: claimableYield === 0 && !loading && error !== 'Wallet not connected' && portfolio?.error !== 'Wallet not connected' ? "Yield begins accruing once the vault exchange rate increases." : undefined,
    },
    {
      id: 'vaults',
      label: 'Active Vaults',
      value: getCount(activeVaultsCount),
      change: activeVaultsCount > 0 ? 'Stable' : undefined,
      isPositive: true,
      icon: ShieldCheck,
      sparkline: 'M0,18 Q15,8 25,12 T40,5 T50,0',
    },
  ];

  const hasYieldPositions = totalYieldPositions > 0;
  const isClaimableZero = claimableYield === 0;
  const showYieldCallout = !loading && !error && portfolio && portfolio.error !== 'Wallet not connected' && hasYieldPositions && isClaimableZero;

  const ClaimableYieldCallout = () => (
    <div className="flex flex-col mt-0.5">
      <span className="text-[11px] font-medium tracking-wide text-nova-accent-hover font-sans">
        No yield has accrued yet.
      </span>
      <span className="text-[10px] leading-tight text-white/70 font-sans mt-0.5">
        Yield becomes claimable after the protocol harvests yield and the SY exchange rate increases.
      </span>
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      {kpis.map((kpi, i) => (
        <MetricCard
          key={kpi.id}
          label={kpi.label}
          value={kpi.value}
          change={kpi.change}
          isPositive={kpi.isPositive}
          icon={kpi.icon}
          sparkline={kpi.sparkline}
          tooltip={kpi.tooltip}
          index={i}
          callout={kpi.id === 'claimable' && showYieldCallout ? <ClaimableYieldCallout /> : undefined}
        />
      ))}
    </div>
  );
}
