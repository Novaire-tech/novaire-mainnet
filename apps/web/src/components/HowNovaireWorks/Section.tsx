'use client';

import Image from 'next/image';
import { motion, useReducedMotion } from 'framer-motion';
import { Lock, TrendingUp, Landmark, Waves } from 'lucide-react';
import { BentoCard, BentoGrid } from '@/components/ui/bento-grid';

const FEATURES = [
  {
    icon: Lock,
    title: 'Fixed Yield with Principal Tokens',
    description: 'Hold PT to maturity for a locked-in, fixed return.',
    span: 'sm:col-span-1',
    image: '/images/bento/coins-stack.png',
  },
  {
    icon: TrendingUp,
    title: 'Trade the Yield with Yield Tokens',
    description: 'YT lets you speculate on or hedge future yield, separate from principal.',
    span: 'sm:col-span-2',
    image: '/images/bento/coins-falling.png',
  },
  {
    icon: Landmark,
    title: 'Backed by Real, On-Chain Yield',
    description: "Rate derived live from Blend Capital's on-chain b_rate — no admin lever.",
    span: 'sm:col-span-2',
    image: '/images/bento/growth-accepted.png',
  },
  {
    icon: Waves,
    title: 'Time-Decay AMM',
    description: 'PT trades against SY on a time-decay, implied-rate curve.',
    span: 'sm:col-span-1',
    image: '/images/bento/coins-flow.png',
  },
];

export function HowNovaireWorks() {
  const prefersReducedMotion = useReducedMotion();

  return (
    <section className="w-full bg-[#e7e2ce] pt-[68px] pb-[140px]">
      <div className="mx-auto w-full max-w-[1500px] px-6 md:px-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.8, ease: 'easeOut' }}
          className="text-left"
        >
          <h2 className="font-editorial font-normal uppercase text-[40px] leading-[1.05] tracking-[-0.01em] text-[#112a46] sm:text-[52px] md:text-[64px] lg:text-[72px]">
            How Novaire Works
          </h2>
          <p className="mt-5 max-w-[500px] font-poppins text-[17px] font-normal leading-[1.6] text-[rgba(17,42,70,0.75)] sm:text-[19px] md:text-[20px]">
            Understand how Novaire transforms yield into flexible financial positions.
          </p>
        </motion.div>

        <BentoGrid className="mt-12 md:mt-14">
          {FEATURES.map(({ icon: Icon, title, description, span, image }) => (
            <BentoCard key={title} className={span}>
              {image && (
                <div className="absolute inset-0 overflow-hidden opacity-0 transition-opacity duration-500 ease-out group-hover:opacity-100">
                  <Image
                    src={image}
                    alt=""
                    fill
                    sizes="(min-width: 640px) 33vw, 100vw"
                    className="scale-100 object-cover transition-transform duration-500 ease-out group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#112a46]/85 via-[#112a46]/10 to-transparent" />
                </div>
              )}
              <div className="relative flex h-full flex-col justify-between p-8 md:p-9">
                <div
                  className={
                    image
                      ? 'flex h-12 w-12 items-center justify-center rounded-2xl bg-[#112a46]/[0.08] transition-opacity duration-300 group-hover:opacity-0'
                      : 'flex h-12 w-12 items-center justify-center rounded-2xl bg-[#112a46]/[0.08]'
                  }
                >
                  <Icon className="h-6 w-6 text-[#112a46]" strokeWidth={1.75} />
                </div>
                <div className="mt-6">
                  <h3
                    className={
                      image
                        ? 'font-editorial text-[20px] font-normal leading-[1.15] text-[#112a46] transition-colors duration-500 group-hover:text-white md:text-[24px]'
                        : 'font-editorial text-[20px] font-normal leading-[1.15] text-[#112a46] md:text-[24px]'
                    }
                  >
                    {title}
                  </h3>
                  <p
                    className={
                      image
                        ? 'mt-2 max-w-[280px] font-poppins text-[13px] font-normal leading-[1.45] tracking-[-0.005em] text-[rgba(17,42,70,0.65)] transition-colors duration-500 group-hover:text-white/75 md:text-[14px]'
                        : 'mt-2 max-w-[280px] font-poppins text-[13px] font-normal leading-[1.45] tracking-[-0.005em] text-[rgba(17,42,70,0.65)] md:text-[14px]'
                    }
                  >
                    {description}
                  </p>
                </div>
              </div>
            </BentoCard>
          ))}
        </BentoGrid>
      </div>
    </section>
  );
}
