'use client';

import { useState } from 'react';
import { BookOpen, ArrowUpRight, ArrowRight } from 'lucide-react';
import { DOCS_URL } from '@/lib/docsUrl';

const LINKS = [
  {
    label: 'X',
    showLabel: false,
    href: 'https://x.com/NovaireFi',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    label: 'Docs',
    showLabel: true,
    href: DOCS_URL,
    icon: <BookOpen className="h-5 w-5" strokeWidth={1.75} />,
  },
];

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function JoinIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email)) return;
    setSent(true);
  };

  return (
    <section className="w-full bg-[#e7e2ce] pb-[100px] pt-0 md:pb-[120px]">
      <div className="mx-auto w-full max-w-[1500px] px-6 md:px-10">
        <div className="flex flex-col gap-12 lg:flex-row lg:items-stretch lg:gap-0">
          {/* LEFT: Join In */}
          <div className="lg:flex lg:w-1/2 lg:flex-col lg:justify-center lg:pr-14">
            <h2 className="font-editorial font-normal uppercase text-[40px] leading-[1.05] tracking-[-0.01em] text-[#112a46] sm:text-[52px] md:text-[64px]">
              Join In
            </h2>

            <div className="mt-10 flex flex-col gap-6 sm:flex-row">
              {LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex h-[110px] w-full flex-none items-center justify-between gap-4 rounded-[20px] border border-[rgba(17,42,70,0.12)] bg-[rgba(17,42,70,0.02)] px-8 transition-colors duration-300 ease-out hover:border-[rgba(17,42,70,0.35)] sm:h-[120px] sm:w-auto sm:flex-1"
                >
                  <span className="flex items-center gap-3">
                    <span className="text-[#112a46]">{link.icon}</span>
                    {link.showLabel && (
                      <span className="font-poppins text-[15px] font-medium leading-[1.4] text-[#112a46] sm:text-[16px]">
                        {link.label}
                      </span>
                    )}
                  </span>

                  <ArrowUpRight className="h-5 w-5 flex-shrink-0 text-[#112a46] transition-transform duration-300 ease-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </a>
              ))}
            </div>
          </div>

          {/* Divider: vertical on lg, horizontal above right column when stacked */}
          <div className="hidden w-px flex-shrink-0 self-stretch bg-[rgba(17,42,70,0.15)] lg:block" />

          {/* RIGHT: Waitlist */}
          <div id="waitlist" className="scroll-mt-24 border-t border-[rgba(17,42,70,0.15)] pt-12 lg:flex lg:w-1/2 lg:flex-col lg:justify-center lg:border-t-0 lg:pl-14 lg:pt-0">
            <span className="font-poppins text-[12px] font-medium uppercase tracking-[0.14em] text-[rgba(17,42,70,0.55)]">
              Waitlist
            </span>

            <h3 className="mt-3 font-editorial font-normal uppercase text-[32px] leading-[1.08] tracking-[-0.01em] text-[#112a46] sm:text-[40px] md:text-[48px]">
              Get in before the yield moves.
            </h3>

            <p className="mt-4 max-w-[420px] font-poppins text-[16px] font-normal leading-[1.6] text-[rgba(17,42,70,0.75)] sm:text-[17px]">
              Be first to access Novaire and upcoming yield markets.
            </p>

            <div className="mt-8 max-w-[440px]">
              {sent ? (
                <div className="flex h-12 items-center border-b border-[rgba(17,42,70,0.2)]">
                  <span className="font-poppins text-[14px] font-semibold uppercase tracking-[0.14em] text-[#112a46]">
                    Sent
                  </span>
                </div>
              ) : (
                <form
                  onSubmit={handleSubmit}
                  className="group flex h-12 items-center justify-between gap-3 border-b border-[rgba(17,42,70,0.25)] transition-colors duration-300 ease-out focus-within:border-[#112a46]"
                >
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@domain.com"
                    required
                    className="w-full bg-transparent font-poppins text-[15px] text-[#112a46] placeholder:text-[rgba(17,42,70,0.4)] outline-none sm:text-[16px]"
                  />
                  <button
                    type="submit"
                    aria-label="Submit"
                    disabled={!isValidEmail(email)}
                    className="flex flex-shrink-0 items-center justify-center text-[#112a46] transition-transform duration-300 ease-out hover:translate-x-0.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-x-0"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
