import { motion } from 'framer-motion';
import { Vault } from '../../types';
import { ProtocolState } from '@/services/protocolService';
import { CardWaveDecoration } from '@/components/ui/CardWaveDecoration';

interface VaultGridProps {
  vaults: Vault[];
  protocolState: ProtocolState | null;
  onDeposit: (asset: string) => void;
}

export function VaultGrid({ vaults, protocolState, onDeposit }: VaultGridProps) {
  return (
    <div className="grid grid-cols-1 gap-6 h-full">
      {vaults.map((vault, i) => {
        const maturity = new Date(vault.maturityDate);
        const now = new Date();
        const diffTime = maturity.getTime() - now.getTime();
        const diffDays = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
        
        return (
          <motion.div
            key={vault.id}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.1 }}
            className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl relative overflow-hidden transition-all duration-200 hover:border-[#BEB7A7]/50 hover:shadow-[0_0_20px_rgba(62,207,142,0.15)] hover:-translate-y-[3px]"
          >
            {/* Decorative gradient to match TradeInterface */}
            <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-[#BEB7A7] opacity-[0.03] blur-[100px] rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none" />
            <CardWaveDecoration />

            <div className="z-10 relative">
              {/* Vault Name and Epoch */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5">
                    <span className="font-bold text-white">{vault.asset.charAt(0)}</span>
                  </div>
                  <div>
                    <h3 className="font-medium text-[#F5F5F2]">{vault.protocol} {vault.asset} Vault</h3>
                    <p className="text-xs text-[#F5F5F2]/60">Current Epoch</p>
                  </div>
                </div>
                <span className="rounded-full bg-[#BEB7A7]/10 px-2.5 py-1 text-xs font-medium text-[#BEB7A7]">
                  Active
                </span>
              </div>
              
              {/* APY and TVL */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <p className="text-xs text-[#F5F5F2]/60 mb-1">Fixed APY</p>
                  <p className="text-lg font-semibold text-[#BEB7A7]">
                    {vault.fixedApy.toFixed(2)}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#F5F5F2]/60 mb-1">TVL</p>
                  <p className="text-lg font-semibold text-[#F5F5F2]">
                    {protocolState ? `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(protocolState.tvlXlm)} XLM` : 'Loading...'}
                  </p>
                </div>
              </div>

              <div className="h-[1px] w-full bg-white/10 mb-6" />

              {/* Maturity */}
              <div className="flex flex-col gap-3 mb-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#F5F5F2]/60">Maturity Date</span>
                  <span className="font-medium text-[#F5F5F2]">
                    {maturity.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#F5F5F2]/60">Days Remaining</span>
                  <span className="font-medium text-[#F5F5F2]">{diffDays} days</span>
                </div>
              </div>

              <div className="h-[1px] w-full bg-white/10 mb-6" />
              
              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => onDeposit(vault.asset)}
                  className="flex items-center justify-center gap-2 rounded-xl bg-[#BEB7A7] py-4 text-base font-semibold text-black transition-all duration-200 hover:brightness-110 hover:-translate-y-[1px] shadow-sm active:scale-[0.98]"
                >
                  Deposit
                </button>
                <button 
                  className="rounded-xl border border-white/10 bg-transparent py-4 text-base font-medium text-[#F5F5F2] transition-colors hover:bg-white/5"
                >
                  View Details
                </button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
