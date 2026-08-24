'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { DocsSearch } from './DocsSearch';

interface DocsLayoutProps {
  children: React.ReactNode;
  sidebarNav: React.ReactNode;
  tableOfContents?: React.ReactNode;
}

export default function DocsLayout({ children, sidebarNav, tableOfContents }: DocsLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-black text-white selection:bg-nova-accent/30">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 w-full border-b border-nova-border bg-black/80 backdrop-blur-md">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8 max-w-screen-2xl mx-auto">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <Image 
                src="/images/logos-v2.png" 
                alt="Novaire Logo" 
                width={120} 
                height={32} 
                className="h-8 w-auto object-contain"
              />
            </Link>
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-nova-accent border border-nova-accent/20 hidden sm:block">
              Docs
            </span>
          </div>

          <div className="flex flex-1 items-center justify-end md:justify-center px-4 max-w-md ml-auto md:ml-8">
            <DocsSearch />
          </div>

          <div className="flex items-center gap-4 ml-4">
            <Link 
              href="/app" 
              className="hidden md:inline-flex items-center justify-center rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 transition-colors"
            >
              Launch App
            </Link>
            <button
              type="button"
              className="md:hidden -m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-gray-400 hover:text-white transition-colors"
              onClick={() => setMobileMenuOpen(true)}
            >
              <span className="sr-only">Open main menu</span>
              <Menu className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row">
          
          {/* Left Sidebar (Desktop) */}
          <aside className="hidden md:block w-64 shrink-0 py-10 pr-8 overflow-y-auto sticky top-16" style={{ height: 'calc(100vh - 4rem)' }}>
            {sidebarNav}
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0 py-10 md:px-8 lg:px-12">
            <article className="prose prose-invert max-w-4xl mx-auto prose-a:text-nova-accent prose-a:no-underline hover:prose-a:underline prose-headings:scroll-mt-24">
              {children}
            </article>
          </main>

          {/* Right Sidebar (Table of Contents) */}
          <aside className="hidden xl:block w-64 shrink-0 py-10 pl-8 overflow-y-auto sticky top-16" style={{ height: 'calc(100vh - 4rem)' }}>
            {tableOfContents}
          </aside>

        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm md:hidden"
          >
            <div className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-gray-900 px-6 py-6 sm:max-w-sm border-l border-nova-border shadow-2xl">
              <div className="flex items-center justify-between">
                <Link href="/" className="-m-1.5 p-1.5 flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}>
                  <Image 
                    src="/images/logos-v2.png" 
                    alt="Novaire Logo" 
                    width={120} 
                    height={32} 
                    className="h-8 w-auto object-contain"
                  />
                </Link>
                <button
                  type="button"
                  className="-m-2.5 rounded-md p-2.5 text-gray-400 hover:text-white"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span className="sr-only">Close menu</span>
                  <X className="h-6 w-6" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-8 flow-root">
                <div onClick={() => setMobileMenuOpen(false)}>
                  {sidebarNav}
                </div>
                <div className="mt-8 pt-8 border-t border-nova-border">
                  <Link
                    href="/app"
                    className="block rounded-lg px-3 py-2 text-base font-semibold leading-7 text-white hover:bg-white/10 text-center bg-nova-accent hover:bg-nova-accent/90 transition-colors"
                  >
                    Launch App
                  </Link>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
