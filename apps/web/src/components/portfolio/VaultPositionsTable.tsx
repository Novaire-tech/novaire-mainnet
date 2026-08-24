'use client';

import { useState, useEffect } from 'react';
import { usePortfolio } from '../../hooks/usePortfolio';
import { YieldService } from '../../services/yieldService';
import type { Vault } from '../../types';

import { DataTable } from '../ui/DataTable';
import { SectionCard } from '../ui/SectionCard';
import { Button } from '../ui/Button';

interface VaultPositionRow {
  vaultName: string;
  underlying: string;
  depositAmount: number;
  claimableYield: number;
  fixedApy: number;
  daysRemaining: number;
  maturityDate: string;
}

export function VaultPositionsTable() {
  const { portfolio, loading, error } = usePortfolio();
  const [vaults, setVaults] = useState<Vault[]>([]);

  useEffect(() => {
    YieldService.getVaults().then(setVaults).catch(console.error);
  }, []);

  const isDisconnected = error === 'Wallet not connected' || portfolio?.error === 'Wallet not connected';
  
  const vaultAssets = portfolio?.assets.filter(a => a.assetType === 'vault') || [];
  
  const positions = vaultAssets.map(asset => {
    // Attempt to extract underlying asset, e.g., "Novaire Vault (XLM)" -> "XLM"
    const match = asset.assetCode.match(/\((.*?)\)/);
    const underlying = match ? match[1] : 'Unknown';
    
    // Find matching vault config
    const activeVault = vaults.find(v => (Array.isArray(v.asset) ? v.asset.includes(underlying) : v.asset === underlying));
    
    let vaultName = asset.assetCode;
    let fixedApy = 0;
    let maturityDate = '--';
    let daysRemaining = 0;

    if (activeVault) {
      vaultName = `${activeVault.protocol} ${underlying} Vault`;
      fixedApy = activeVault.fixedApy;
      maturityDate = new Date(activeVault.maturityDate).toLocaleDateString();
      
      const timeDiff = new Date(activeVault.maturityDate).getTime() - new Date().getTime();
      daysRemaining = Math.max(0, Math.ceil(timeDiff / (1000 * 3600 * 24)));
    }

    const claimableYield = asset.claimableYield || 0;

    return {
      vaultName,
      underlying,
      depositAmount: asset.balance,
      claimableYield,
      fixedApy,
      daysRemaining,
      maturityDate
    };
  });

  const columns = [
    { header: 'Vault Name', accessor: (row: VaultPositionRow) => row.vaultName },
    { header: 'Underlying', accessor: (row: VaultPositionRow) => <span className="text-[#F5F5F2]/60">{row.underlying}</span> },
    { header: 'Deposit Amount', accessor: (row: VaultPositionRow) => row.depositAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }), align: 'right' as const },
    { header: 'Claimable Yield', accessor: (row: VaultPositionRow) => <span className="text-[#BEB7A7]">+{row.claimableYield.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>, align: 'right' as const },
    { header: 'Fixed APY', accessor: (row: VaultPositionRow) => `${row.fixedApy}%`, align: 'right' as const },
    { header: 'Days Remaining', accessor: (row: VaultPositionRow) => `${row.daysRemaining} days`, align: 'right' as const },
    { header: 'Maturity Date', accessor: (row: VaultPositionRow) => row.maturityDate },
    { header: 'Action', accessor: () => <Button variant="secondary" size="sm">Manage</Button>, align: 'right' as const },
  ];

  let emptyState = null;
  if (loading) emptyState = <div className="animate-pulse h-4 w-full bg-white/5 rounded"></div>;
  else if (isDisconnected) emptyState = "Connect Wallet to view vault positions";
  else if (positions.length === 0) emptyState = "No open vault positions.";

  return (
    <SectionCard className="p-0">
      <div className="border-b border-white/10 p-6 flex justify-between items-center">
        <h3 className="font-sans font-medium ">Vault Positions</h3>
      </div>
      <DataTable
        data={positions}
        columns={columns}
        keyExtractor={(row, index) => `${row.vaultName}-${index}`}
        emptyState={emptyState}
      />
    </SectionCard>
  );
}
