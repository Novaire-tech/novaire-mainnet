import React from 'react';
import DocsLayout from '@/components/docs/DocsLayout';
import SidebarNav from '@/components/docs/SidebarNav';
import TableOfContents from '@/components/docs/TableOfContents';
import DocsContentGettingStarted from '@/components/docs/DocsContentGettingStarted';
import DocsPagination from '@/components/docs/DocsPagination';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Getting Started | Novaire Docs',
  description: 'The single source of truth for the Novaire protocol.',
};

export default function DocsPage() {
  return (
    <DocsLayout sidebarNav={<SidebarNav />} tableOfContents={<TableOfContents />}>
      <DocsContentGettingStarted />
      <DocsPagination 
        next={{ title: 'Trading & Yield', href: '/docs/trading-yield' }} 
      />
    </DocsLayout>
  );
}
