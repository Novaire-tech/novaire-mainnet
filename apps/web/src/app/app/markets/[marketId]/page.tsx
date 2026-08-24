import { PageContainer } from '@/components/ui/PageContainer';

export default async function MarketDetailPage({
  params,
}: {
  params: Promise<{ marketId: string }>;
}) {
  const { marketId } = await params;

  return (
    <PageContainer title={`Market: ${marketId}`} description="Market details, coming soon.">
      <p className="text-sm text-[#F5F5F2]/60">
        Detailed market information (PT/YT pricing, APY, maturity, liquidity) will appear here.
      </p>
    </PageContainer>
  );
}
