'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { YieldService } from '@/services/yieldService';
import { ProtocolService, ProtocolState } from '@/services/protocolService';
import { Vault } from '@/types';
import { VaultGrid } from '@/components/vaults/VaultGrid';
import { VaultStatistics } from '@/components/vaults/VaultStatistics';
import { PageContainer } from '@/components/ui/PageContainer';

export default function MarketsPage() {
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [loading, setLoading] = useState(true);
  const [protocolState, setProtocolState] = useState<ProtocolState | null>(null);

  useEffect(() => {
    Promise.all([YieldService.getVaults(), ProtocolService.getProtocolState()])
      .then(([vaultData, pState]) => {
        setVaults(vaultData);
        setProtocolState(pState);
        setLoading(false);
      })
      .catch((error) => {
        console.error('Failed to load markets:', error);
        setLoading(false);
      });
  }, []);

  const createMarketAction = (
    <Link
      href="/app/markets/create"
      className="flex h-10 items-center justify-center gap-2 rounded-xl bg-[#BEB7A7] px-5 py-2 font-semibold text-black transition-all duration-200 hover:brightness-110 hover:-translate-y-[1px] shadow-sm active:scale-[0.98]"
    >
      <Plus className="h-4 w-4" />
      Create Market
    </Link>
  );

  return (
    <PageContainer
      title="Markets"
      description="Discover fixed-yield markets available on Novaire."
      actions={createMarketAction}
    >
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-2xl bg-[#111111] border border-white/10" />
          ))}
        </div>
      ) : vaults.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] py-24 text-center">
          <h2 className="text-lg font-medium text-[#F5F5F2]">No markets yet</h2>
          <p className="max-w-sm text-sm text-[#F5F5F2]/60">
            The first fixed-yield markets are being prepared.
          </p>
          {createMarketAction}
        </div>
      ) : (
        <>
          <VaultStatistics vaults={vaults} protocolState={protocolState} />
          <VaultGrid vaults={vaults} protocolState={protocolState} onDeposit={() => {}} />
        </>
      )}
    </PageContainer>
  );
}
