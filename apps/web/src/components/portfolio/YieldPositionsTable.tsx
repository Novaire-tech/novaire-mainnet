'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { usePortfolio } from '../../hooks/usePortfolio';
import { YieldService } from '../../services/yieldService';
import type { Vault } from '../../types';
import { MintModal } from '../modals/MintModal';

export function YieldPositionsTable() {
  const { portfolio, loading, error, refresh: refreshPortfolio } = usePortfolio();
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [isMintModalOpen, setIsMintModalOpen] = useState(false);

  useEffect(() => {
    YieldService.getVaults().then(setVaults).catch(console.error);
  }, []);

  const isDisconnected = error === 'Wallet not connected' || portfolio?.error === 'Wallet not connected';
  
  // A Yield Position is when a user holds PT or YT
  const yieldAssets = portfolio?.assets.filter(a => a.assetType === 'pt' || a.assetType === 'yt') || [];
  
  // Group PT and YT by underlying asset / issuer for rows
  const positionsMap = new Map();
  yieldAssets.forEach(asset => {
    // Determine underlying from assetCode like "PT-XLM"
    const isPT = asset.assetType === 'pt';
    const isYT = asset.assetType === 'yt';
    const underlying = asset.assetCode.split('-')[1] || 'Unknown';
    
    // Group by issuer/epochId if available, otherwise underlying
    const key = asset.issuer || underlying;
    
    if (!positionsMap.has(key)) {
      positionsMap.set(key, {
        vaultName: `Novaire ${underlying} Vault`,
        underlying,
        ptBalance: 0,
        ytBalance: 0,
        currentValueUsd: 0,
        issuer: asset.issuer
      });
    }
    
    const pos = positionsMap.get(key);
    if (isPT) pos.ptBalance += asset.balance;
    if (isYT) pos.ytBalance += asset.balance;
    pos.currentValueUsd += asset.valueUsd;
    
    // Attempt to match with active vault data to get APY and Maturity
    const activeVault = vaults.find(v => (Array.isArray(v.asset) ? v.asset.includes(underlying) : v.asset === underlying));
    if (activeVault) {
      pos.vaultName = `${activeVault.protocol} ${underlying} Vault`;
      pos.fixedApy = activeVault.fixedApy;
      pos.maturityDate = new Date(activeVault.maturityDate).toLocaleDateString();
      pos.status = new Date() > new Date(activeVault.maturityDate) ? 'Matured' : 'Active';
    } else {
      pos.fixedApy = 0;
      pos.maturityDate = '--';
      pos.status = 'Active';
    }
  });

  const positions = Array.from(positionsMap.values());
  const isEmpty = !loading && !isDisconnected && positions.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
      className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"
    >
      <div className="border-b border-white/10 p-6 flex justify-between items-center">
        <h3 className="font-sans font-medium ">Yield Positions</h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#050505]/50 text-xs text-[#F5F5F2]/60">
            <tr>
              <th className="px-6 py-4 font-medium">Vault Name</th>
              <th className="px-6 py-4 font-medium">Underlying</th>
              <th className="px-6 py-4 font-medium text-right">PT Balance</th>
              <th className="px-6 py-4 font-medium text-right">YT Balance</th>
              <th className="px-6 py-4 font-medium text-right">Fixed APY</th>
              <th className="px-6 py-4 font-medium">Maturity Date</th>
              <th className="px-6 py-4 font-medium text-right">Current Value</th>
              <th className="px-6 py-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center">
                  <div className="flex flex-col items-center justify-center space-y-4">
                    <div className="h-4 w-full max-w-lg animate-pulse rounded bg-white/5"></div>
                  </div>
                </td>
              </tr>
            )}

            {isDisconnected && (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center text-[#F5F5F2]/60">
                  Connect Wallet to view yield positions
                </td>
              </tr>
            )}

            {isEmpty && (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center">
                  <div className="flex flex-col items-center justify-center space-y-4">
                    <span className="text-[#F5F5F2]/60">No yield positions.<br/>Mint PT & YT to begin.</span>
                    <button
                      onClick={() => setIsMintModalOpen(true)}
                      className="rounded-xl bg-[#BEB7A7] px-5 py-2 text-sm font-semibold text-black transition-transform hover:scale-105 active:scale-95"
                    >
                      Mint PT & YT
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {!loading && !isDisconnected && !isEmpty && positions.map((pos, i) => (
              <motion.tr
                key={`${pos.issuer}-${i}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.2 + i * 0.05 }}
                className="group transition-colors hover:bg-white/5"
              >
                <td className="whitespace-nowrap px-6 py-4 font-medium text-[#F5F5F2]">
                  {pos.vaultName}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-[#F5F5F2]/60">
                  {pos.underlying}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right font-medium text-[#F5F5F2]">
                  {pos.ptBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right font-medium text-[#F5F5F2]">
                  {pos.ytBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right font-medium text-[#BEB7A7]">
                  {pos.fixedApy}%
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-[#F5F5F2]">
                  {pos.maturityDate}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right font-medium text-[#F5F5F2]">
                  ${pos.currentValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <span className={`inline-flex rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${pos.status === 'Active' ? 'bg-[#BEB7A7]/10 text-[#BEB7A7]' : 'bg-white/10 text-[#F5F5F2]/60'}`}>
                    {pos.status}
                  </span>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      <MintModal 
        isOpen={isMintModalOpen} 
        onClose={() => setIsMintModalOpen(false)}
        defaultAsset="XLM"
        onSuccess={refreshPortfolio}
      />
    </motion.div>
  );
}
