'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Wallet, Plus } from 'lucide-react';
import { useWallet } from '../../hooks/useWallet';
import { MintModal } from '../modals/MintModal';
import { usePortfolio } from '../../hooks/usePortfolio';

export function DashboardHeader() {
  const { isConnected, address, connect, disconnect, error } = useWallet();
  const { refresh: refreshPortfolio } = usePortfolio();
  const [isMintModalOpen, setIsMintModalOpen] = useState(false);

  // If there's an error, we show an alert to the user.
  useEffect(() => {
    if (error && error !== 'Wallet not connected') {
      alert(`Wallet Connection Error: ${error}`);
    }
  }, [error]);

  const formattedAddress = address 
    ? `${address.slice(0, 4)}...${address.slice(-4)}`
    : '';

  return (
    <div className="flex items-center gap-3">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="flex items-center gap-3"
      >
        {/* Connected Status & Wallet */}
        {isConnected ? (
          <button 
            onClick={disconnect}
            title="Disconnect Wallet"
            className="flex h-10 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 transition-colors hover:border-red-500/30 group"
          >
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#BEB7A7] opacity-75 group-hover:hidden"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#BEB7A7] group-hover:bg-red-500"></span>
              </span>
              <span className="text-xs font-medium text-[#BEB7A7] group-hover:text-red-500 transition-colors">Connected</span>
            </div>
            <div className="h-4 w-[1px] bg-white/10 group-hover:bg-red-500/20 transition-colors" />
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-[#F5F5F2]/60 group-hover:text-red-500/80 transition-colors" />
              <span className="text-sm font-medium text-[#F5F5F2] group-hover:text-red-500/90 transition-colors">{formattedAddress}</span>
            </div>
          </button>
        ) : (
          <button 
            onClick={connect}
            className="flex h-10 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 transition-colors hover:border-[#BEB7A7]/50 group"
          >
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-[#F5F5F2]/60 group-hover:text-[#BEB7A7] transition-colors" />
              <span className="text-sm font-medium text-[#F5F5F2] group-hover:text-[#BEB7A7] transition-colors">Connect Wallet</span>
            </div>
          </button>
        )}

      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut', delay: 0.1 }}
      >
        <button
          onClick={() => setIsMintModalOpen(true)}
          className="flex h-10 items-center justify-center gap-2 rounded-xl bg-[#BEB7A7] px-5 py-2 font-semibold text-black transition-all duration-200 hover:brightness-110 hover:-translate-y-[1px] shadow-sm active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Mint PT & YT
        </button>
      </motion.div>

      <MintModal 
        isOpen={isMintModalOpen} 
        onClose={() => setIsMintModalOpen(false)}
        onSuccess={refreshPortfolio}
      />
    </div>
  );
}
