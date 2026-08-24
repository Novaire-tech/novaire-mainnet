import React from 'react';
import DocsLayout from '@/components/docs/DocsLayout';
import SidebarNav from '@/components/docs/SidebarNav';
import TableOfContents from '@/components/docs/TableOfContents';
import DocsContentDevelopers from '@/components/docs/DocsContentDevelopers';
import DocsPagination from '@/components/docs/DocsPagination';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Developers | Novaire Docs',
  description: 'Technical architecture, smart contracts, and integration guides.',
};

export default function DevelopersPage() {
  return (
    <DocsLayout sidebarNav={<SidebarNav />} tableOfContents={<TableOfContents />}>
      <DocsContentDevelopers />
      <DocsPagination 
        prev={{ title: 'Trading & Yield', href: '/docs/trading-yield' }}
      />
    </DocsLayout>
  );
}
