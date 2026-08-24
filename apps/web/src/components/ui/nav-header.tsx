"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { scrollToWaitlist } from "@/lib/scrollToWaitlist";
import { DOCS_URL } from "@/lib/docsUrl";

export default function NavHeader() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <>
      <nav className="absolute top-0 left-0 z-50 w-full font-poppins bg-transparent border-b border-transparent">
        <div className="max-w-[1440px] mx-auto h-[88px] px-8 md:px-12 xl:px-16 flex items-center justify-between">

          {/* Left: Logo */}
          <Link
            href="/"
            className="flex items-center z-50 transition-opacity hover:opacity-80 -ml-7 md:-ml-8"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <span
              role="img"
              aria-label="Novaire"
              className="block h-[34px] w-[152px] bg-[#112a46] [mask-image:url('/images/logos-v2.png')] [mask-repeat:no-repeat] [mask-size:contain] [mask-position:left_center] [-webkit-mask-image:url('/images/logos-v2.png')] [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:contain] [-webkit-mask-position:left_center] md:h-[38px] md:w-[170px]"
            />
          </Link>

          {/* Right: Navigation + CTA cluster */}
          <div className="hidden md:flex items-center gap-5 z-50 -mr-5 md:-mr-6">
            <ul className="flex items-center gap-6">
              <Tab href="https://stellar.org/" external>
                Ecosystem
              </Tab>
              <Tab href={DOCS_URL} external>
                Docs
              </Tab>
              <Tab href="/app">
                Product
              </Tab>
            </ul>

            <Link
              href="/#waitlist"
              onClick={scrollToWaitlist}
              style={{ color: '#112a46' }}
              className="inline-flex items-center justify-center px-6 py-2 rounded-full border border-[rgba(17,42,70,0.15)] bg-transparent text-[16px] font-medium tracking-[0.01em] transition-all duration-[250ms] ease-out hover:bg-[rgba(17,42,70,0.06)] hover:border-[rgba(17,42,70,0.3)] whitespace-nowrap"
            >
              <span style={{ color: '#112a46' }}>Get Early Access</span>
              <span style={{ color: '#112a46' }} className="ml-2">↗</span>
            </Link>
          </div>

          {/* Hamburger Toggle */}
          <button
            style={{ color: '#112a46' }}
            className="md:hidden focus:outline-none transition-transform active:scale-95 p-2"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle mobile menu"
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu Fullscreen Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="fixed inset-0 z-40 bg-nova-bg flex flex-col pt-[100px] px-8 pb-12 font-poppins"
          >
            <div className="flex flex-col gap-6 items-start flex-1 overflow-y-auto">
              {[
                { label: 'Ecosystem', href: 'https://stellar.org/', external: true },
                { label: 'Docs', href: DOCS_URL, external: true },
                { label: 'Product', href: '/app' }
              ].map((item, idx) => (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 + 0.1, duration: 0.3 }}
                  key={item.label}
                  className="w-full"
                >
                  {item.href ? (
                    item.external ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#112a46' }}
                        className="text-[24px] font-medium tracking-[0.01em] transition-colors duration-200 block py-2 hover:text-[#0c2035]"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        {item.label}
                      </a>
                    ) : (
                      <Link
                        href={item.href}
                        style={{ color: '#112a46' }}
                        className="text-[24px] font-medium tracking-[0.01em] transition-colors duration-200 block py-2 hover:text-[#0c2035]"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        {item.label}
                      </Link>
                    )
                  ) : (
                    <Link
                      href="#"
                      style={{ color: '#112a46' }}
                      className="text-[24px] font-medium tracking-[0.01em] transition-colors duration-200 block py-2 hover:text-[#0c2035]"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      {item.label}
                    </Link>
                  )}
                </motion.div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.3 }}
              className="w-full mt-auto"
            >
              <Link
                href="/#waitlist"
                style={{ color: '#112a46' }}
                className="flex items-center justify-center w-full px-6 py-3 rounded-full border border-[rgba(17,42,70,0.15)] bg-transparent text-[16px] font-medium tracking-[0.01em] transition-all duration-[250ms] ease-out hover:bg-[rgba(17,42,70,0.06)] hover:border-[rgba(17,42,70,0.3)] whitespace-nowrap"
                onClick={(e) => {
                  setIsMobileMenuOpen(false);
                  scrollToWaitlist(e);
                }}
              >
                <span style={{ color: '#112a46' }}>Get Early Access</span>
                <span style={{ color: '#112a46' }} className="ml-2">↗</span>
              </Link>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const Tab = ({
  children,
  isActive,
  onClick,
  href,
  external
}: {
  children: React.ReactNode;
  isActive?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  href?: string;
  external?: boolean;
}) => {
  const innerContent = <span className="relative z-10" style={{ color: 'inherit' }}>{children}</span>;

  const className = `relative group block cursor-pointer px-[6px] py-[10px] text-[16px] font-medium tracking-[0.01em] transition-colors duration-[250ms] ease-out hover:!text-[#0c2035]`;
  const color = isActive ? '#0c2035' : '#112a46';

  if (href) {
    if (external) {
      return (
        <li className="list-none">
          <a href={href} target="_blank" rel="noopener noreferrer" onClick={onClick} className={className} style={{ color }}>
            {innerContent}
          </a>
        </li>
      );
    }
    return (
      <li className="list-none">
        <Link href={href} onClick={onClick} className={className} style={{ color }}>
          {innerContent}
        </Link>
      </li>
    );
  }

  return (
    <li onClick={onClick} className={className} style={{ color }}>
      {innerContent}
    </li>
  );
};
