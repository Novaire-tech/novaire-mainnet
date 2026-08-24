'use client';

import { motion } from 'framer-motion';
import { usePortfolio } from '../../hooks/usePortfolio';

export function WalletAssetsTable() {
  const { portfolio, loading, error } = usePortfolio();
  const isDisconnected = error === 'Wallet not connected' || portfolio?.error === 'Wallet not connected';
  
  // Filter only wallet assets
  const walletAssets = portfolio?.assets.filter(a => a.assetType === 'wallet') || [];
  const isEmpty = !loading && !isDisconnected && walletAssets.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
      className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"
    >
      <div className="border-b border-white/10 p-6">
        <h3 className="font-sans font-medium ">Wallet Assets</h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#050505]/50 text-xs text-[#F5F5F2]/60">
            <tr>
              <th className="px-6 py-4 font-medium">Asset</th>
              <th className="px-6 py-4 font-medium text-right">Balance</th>
              <th className="px-6 py-4 font-medium text-right">Current Price</th>
              <th className="px-6 py-4 font-medium text-right">USD Value</th>
              <th className="px-6 py-4 font-medium text-right">Allocation %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center">
                  <div className="flex flex-col items-center justify-center space-y-4">
                    <div className="h-4 w-full max-w-lg animate-pulse rounded bg-white/5"></div>
                    <div className="h-4 w-full max-w-md animate-pulse rounded bg-white/5"></div>
                  </div>
                </td>
              </tr>
            )}

            {isDisconnected && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-[#F5F5F2]/60">
                  Connect Wallet to view assets
                </td>
              </tr>
            )}

            {isEmpty && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-[#F5F5F2]/60">
                  No assets found in wallet.
                </td>
              </tr>
            )}

            {!loading && !isDisconnected && !isEmpty && walletAssets.map((asset, i) => (
              <motion.tr
                key={`${asset.assetCode}-${i}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.2 + i * 0.05 }}
                className="group transition-colors hover:bg-white/5"
              >
                <td className="whitespace-nowrap px-6 py-4 font-medium text-[#F5F5F2]">
                  {asset.assetCode}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right font-medium text-[#F5F5F2]">
                  {asset.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right font-medium text-[#F5F5F2]/60">
                  ${asset.priceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right font-medium text-[#F5F5F2]">
                  ${asset.valueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right font-medium text-[#BEB7A7]">
                  {asset.allocationPercent.toFixed(1)}%
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
