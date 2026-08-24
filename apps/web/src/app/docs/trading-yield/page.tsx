import React from 'react';
import DocsLayout from '@/components/docs/DocsLayout';
import SidebarNav from '@/components/docs/SidebarNav';
import TableOfContents from '@/components/docs/TableOfContents';
import DocsContentTradingYield from '@/components/docs/DocsContentTradingYield';
import DocsPagination from '@/components/docs/DocsPagination';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Trading & Yield | Novaire Docs',
  description: 'Understand investment strategies, market mechanics, and how to manage your portfolio.',
};

export default function TradingYieldPage() {
  return (
    <DocsLayout sidebarNav={<SidebarNav />} tableOfContents={<TableOfContents />}>
      <DocsContentTradingYield />
      <DocsPagination 
        prev={{ title: 'Getting Started', href: '/docs' }}
        next={{ title: 'Developers', href: '/docs/developers' }} 
      />
    </DocsLayout>
  );
}
