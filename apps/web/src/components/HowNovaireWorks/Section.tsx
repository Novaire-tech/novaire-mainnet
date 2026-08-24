'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { BentoCard, BentoGrid } from '@/components/ui/bento-grid';

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
          <BentoCard className="sm:col-span-1" />
          <BentoCard className="sm:col-span-2" />
          <BentoCard className="sm:col-span-2" />
          <BentoCard className="sm:col-span-1" />
        </BentoGrid>
      </div>
    </section>
  );
}
