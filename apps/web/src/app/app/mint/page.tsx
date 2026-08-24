'use client';

import { useRouter } from 'next/navigation';
import { PageContainer } from '@/components/ui/PageContainer';
import { MintModal } from '@/components/modals/MintModal';
import { usePortfolio } from '@/hooks/usePortfolio';

export default function MintPage() {
  const router = useRouter();
  const { refresh: refreshPortfolio } = usePortfolio();

  return (
    <PageContainer
      title="Mint"
      description="Deposit a yield-bearing underlying asset and receive PT + YT."
    >
      <MintModal
        isOpen
        variant="page"
        onClose={() => router.push('/app')}
        onSuccess={refreshPortfolio}
      />
    </PageContainer>
  );
}
