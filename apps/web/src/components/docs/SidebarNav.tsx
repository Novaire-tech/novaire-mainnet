'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function SidebarNav() {
  const pathname = usePathname();

  const navLinks = [
    { title: 'Getting Started', href: '/docs' },
    { title: 'Trading & Yield', href: '/docs/trading-yield' },
    { title: 'Developers', href: '/docs/developers' },
  ];

  return (
    <nav className="text-sm pb-10">
      <ul role="list" className="space-y-4">
        {navLinks.map((link, idx) => {
          const isActive = pathname === link.href;

          return (
            <li key={idx}>
              <Link 
                href={link.href} 
                className={`group relative inline-block font-semibold transition-colors ${isActive ? 'text-[#BEB7A7]' : 'text-white'}`}
              >
                {link.title}
                {!isActive && (
                  <span className="absolute left-0 -bottom-1 h-[2px] w-0 bg-[#BEB7A7] transition-all duration-200 ease-in-out md:group-hover:w-full" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
