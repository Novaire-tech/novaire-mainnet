'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { DOCS_URL } from '@/lib/docsUrl';

export function HeroVideo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, ease: 'easeOut' }}
      className="relative w-full"
    >
      {/* Warm outer glow: soft, oversized, heavily blurred so the video reads as embedded rather than a floating card */}
      <div className="pointer-events-none absolute -inset-6 rounded-[40px] bg-[#e7e2ce] opacity-70 blur-3xl lg:-inset-10" />

      <div className="relative overflow-hidden rounded-[28px] shadow-[0_40px_90px_-24px_rgba(0,0,0,0.24),0_0_100px_-30px_rgba(190,183,167,0.45)] lg:rounded-[32px]">
        <div className="aspect-video w-full bg-[#d9d3ba] md:aspect-auto md:h-[78vh] lg:h-[82vh] xl:h-[85vh]">
          {shouldLoad && (
            <video
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              controls={false}
              className="h-full w-full object-cover [filter:contrast(0.92)_saturate(0.95)_brightness(1.05)]"
            >
              <source src="/videos/novaire-hero.mp4" type="video/mp4" />
            </video>
          )}

          {/* Warm color grade: barely-there taupe wash so the footage sits in the same palette as the page */}
          <div className="pointer-events-none absolute inset-0 bg-[#e7e2ce] opacity-[0.05] mix-blend-soft-light" />

          {/* Cinematic scrim: soft left-to-right darkening (10-15% opacity) so the overlay type reads as part of the shot */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.15)_0%,rgba(0,0,0,0.07)_36%,transparent_62%)]" />

          <div className="pointer-events-none absolute inset-0 flex items-start pt-[6%] pb-[4%] pl-[8%] pr-[6%] md:items-center md:pt-0">
            <div className="max-w-[860px] sm:-translate-x-[4px] md:-translate-x-[16px] md:translate-y-[140px] lg:-translate-x-[30px] lg:translate-y-[152px]">
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={shouldLoad ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className="font-editorial font-normal uppercase text-[30px] leading-[0.95] tracking-[-0.02em] text-[#beb7a7] [text-shadow:0_2px_20px_rgba(0,0,0,0.3)] sm:text-[51px] md:text-[66px] lg:text-[80px] xl:text-[88px]"
              >
                Unlock Your Yield.
              </motion.h1>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={shouldLoad ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.8, ease: 'easeOut', delay: 0.15 }}
                className="mt-3 max-w-[480px] sm:mt-1"
              >
                <p className="font-poppins text-[14px] font-medium leading-[1.3] text-[#f5f4f0] sm:text-[21px] sm:leading-[1.4] md:text-[22px] lg:text-[24px]">
                  Your yield wasn&apos;t meant to stay whole.
                </p>
                <p className="mt-1.5 font-poppins text-[11px] font-normal leading-[1.45] text-[rgba(245,244,240,0.82)] sm:mt-3 sm:text-[16px] sm:leading-[1.7] md:text-[17px] lg:text-[18px]">
                  Split principal from future returns.
                  <br />
                  Trade, hold, or earn your way. Welcome to Novaire.
                </p>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={shouldLoad ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.3 }}
                  className="mt-8 pointer-events-auto"
                >
                  <Link
                    href={DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Read more about Novaire"
                    className="group inline-flex h-[44px] items-center gap-2 rounded-full border border-[rgba(245,244,240,0.18)] bg-[rgba(245,244,240,0.08)] px-[26px] font-poppins text-[15px] font-medium text-[#f5f4f0] transition-all duration-[250ms] ease-out hover:-translate-y-[2px] hover:border-[rgba(245,244,240,0.3)] hover:bg-[rgba(245,244,240,0.14)] active:scale-[0.98]"
                  >
                    Read more
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="transition-transform duration-[250ms] ease-out group-hover:translate-x-1"
                    >
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </Link>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
