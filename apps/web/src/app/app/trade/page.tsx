'use client';

import { PageContainer } from '@/components/ui/PageContainer';
import { TradeInterface } from '@/components/trade/TradeInterface';
import { ProtocolDashboard } from '@/components/trade/ProtocolDashboard';

export default function TradePage() {
  return (
    <PageContainer
      title="Trade"
      description="Swap fixed and variable yield tokens with minimal slippage."
    >
      <div className="flex w-full items-start gap-8 mt-4 flex-col lg:flex-row">
        {/* Main Trading Interface */}
        <div className="flex-1 w-full max-w-xl mx-auto lg:mx-0">
          <TradeInterface />
        </div>

        {/* Secondary Panel: Live Protocol Dashboard */}
        <ProtocolDashboard />
      </div>
    </PageContainer>
  );
}
