import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowDownToLine, HandCoins, ArrowRightLeft, Layers, ExternalLink, ShieldCheck, PlusCircle } from 'lucide-react';
import { useWallet } from '../../hooks/useWallet';
import { ActivityService, UIActivity } from '../../services/activityService';
import { CardWaveDecoration } from '../ui/CardWaveDecoration';

function getActivityIcon(type: string) {
  const t = type.toLowerCase();
  if (t.includes('mint') || t.includes('pt') || t.includes('yt')) return PlusCircle;
  if (t.includes('swap') || t.includes('transfer')) return ArrowRightLeft;
  if (t.includes('deposit') || t.includes('liquidity')) return ArrowDownToLine;
  if (t.includes('yield') || t.includes('redeem') || t.includes('claim')) return HandCoins;
  if (t.includes('vault') || t.includes('protocol')) return ShieldCheck;
  return Layers;
}

export function RecentActivity() {
  const { address } = useWallet();
  const [activities, setActivities] = useState<UIActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!address) {
        setActivities([]);
        setLoading(false);
        return;
      }
      const data = await ActivityService.getActivityHistory(address);
      setActivities(data);
      setLoading(false);
    }
    load();
  }, [address]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.5, ease: 'easeOut' }}
      className="relative flex h-[320px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"
    >
      <CardWaveDecoration />
      <div className="relative z-10 border-b border-white/10 p-6">
        <h3 className="font-sans font-medium ">Recent Activity</h3>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto p-4 pr-2">
        {loading ? (
           <div className="flex justify-center py-10 text-[#F5F5F2]/60 text-sm">Loading activity...</div>
        ) : activities.length === 0 ? (
           <div className="flex justify-center py-10 text-[#F5F5F2]/60 text-sm text-center">No activity yet.<br/>Your transactions will appear here.</div>
        ) : (
          <div className="relative border-l border-white/10 ml-4 space-y-6 pb-2">
            {activities.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.6 + i * 0.1 }}
                className="relative pl-6 group"
              >
                {/* Timeline Dot/Icon */}
                <div className="absolute -left-[13px] top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.03] border border-white/10 text-[#F5F5F2]/60 transition-colors group-hover:text-[#BEB7A7] group-hover:border-[#BEB7A7]/30">
                  {(() => { const Icon = getActivityIcon(item.type); return <Icon className="h-3 w-3" />; })()}
                </div>
                
                <div className="flex flex-col w-full">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm font-medium text-[#F5F5F2]">{item.type}</div>
                      <div className="text-xs text-[#F5F5F2]/60 mt-0.5">{item.vault}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-[#F5F5F2]">{item.amount}</div>
                      <div className="flex items-center gap-1 justify-end mt-0.5">
                        <span className="text-xs text-[#F5F5F2]/60">{item.time}</span>
                        {item.explorerUrl && (
                          <a
                            href={item.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#BEB7A7] opacity-50 hover:opacity-100 transition-opacity"
                            title="View on Stellar Expert"
                          >
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {item.details && item.details.length > 0 && (
                    <div className="mt-3 pl-3 border-l-2 border-[#BEB7A7]/20 space-y-1.5">
                      {item.details.map((detail, idx) => (
                        <div key={idx} className="flex items-center text-xs text-[#F5F5F2]/60">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#BEB7A7]/40 mr-2"></div>
                          {detail}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
