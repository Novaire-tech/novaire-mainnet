'use client';

import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { PortfolioKPICards } from '@/components/portfolio/PortfolioKPICards';
import { WalletAssetsTable } from '@/components/portfolio/WalletAssetsTable';
import { YieldPositionsTable } from '@/components/portfolio/YieldPositionsTable';
import { VaultPositionsTable } from '@/components/portfolio/VaultPositionsTable';
import { AssetAllocation } from '@/components/dashboard/AssetAllocation';
import { RecentActivity } from '@/components/dashboard/RecentActivity';
import { PageContainer } from '@/components/ui/PageContainer';

export default function PortfolioPage() {
  return (
    <PageContainer
      title="Portfolio"
      description="Track your assets, yield positions, and protocol performance."
      actions={<DashboardHeader />}
    >
      <div className="flex flex-col gap-6">

        {/* SECTION 1: Portfolio Summary KPIs */}
        <PortfolioKPICards />

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-8 flex flex-col gap-6">
            {/* SECTION 2: Wallet Assets */}
            <WalletAssetsTable />

            {/* SECTION 3: Yield Positions */}
            <YieldPositionsTable />

            {/* SECTION 4: Vault Positions */}
            <VaultPositionsTable />
          </div>

          <div className="xl:col-span-4 flex flex-col gap-6">
            {/* SECTION 5: Portfolio Allocation */}
            <AssetAllocation />

            {/* SECTION 6: Recent Portfolio Activity */}
            <RecentActivity />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
