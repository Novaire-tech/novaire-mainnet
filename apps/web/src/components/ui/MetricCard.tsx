'use client';

import React, { useId, useState } from 'react';
import { motion } from 'framer-motion';
import { CardWaveDecoration } from './CardWaveDecoration';

export interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  change?: React.ReactNode;
  isPositive?: boolean;
  icon: React.ElementType;
  sparkline?: string;
  index?: number;
  delay?: number;
  tooltip?: string;
  callout?: React.ReactNode;
}

export function MetricCard({ 
  label, 
  value, 
  change, 
  isPositive = true, 
  icon: Icon, 
  sparkline,
  index = 0,
  delay = 0.2,
  tooltip,
  callout
}: MetricCardProps) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const tooltipId = useId();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: delay + index * 0.05, ease: 'easeOut' }}
      className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-all duration-200 hover:border-[#BEB7A7] hover:shadow-[0_0_18px_rgba(190,183,167,0.35)] hover:-translate-y-[3px]"
    >
      <CardWaveDecoration />

      {/* Top Row: Icon & Label */}
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-white/5 text-[#F5F5F2]/60 transition-colors duration-200 group-hover:bg-[#BEB7A7]/10 group-hover:text-[#BEB7A7]">
          <Icon className="h-3 w-3" />
        </div>
        <div className="flex items-center gap-1 group/tooltip relative">
          <span className="text-[10px] font-medium uppercase tracking-wider text-[#F5F5F2]/60 font-sans leading-none">
            {label}
          </span>
          {tooltip && (
            <>
              <button
                type="button"
                className="cursor-help text-[#F5F5F2]/60 hover:text-[#F5F5F2] transition-colors"
                aria-label={`More info: ${label}`}
                aria-describedby={tooltipId}
                aria-expanded={tooltipOpen}
                onClick={() => setTooltipOpen((open) => !open)}
                onBlur={() => setTooltipOpen(false)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
              </button>
              <div
                id={tooltipId}
                role="tooltip"
                className={`absolute left-0 bottom-full mb-1 ${tooltipOpen ? 'block' : 'hidden'} group-hover/tooltip:block bg-[#0A0A0A] border border-white/10 text-[#F5F5F2] text-[10px] normal-case tracking-normal px-2 py-1.5 rounded shadow-xl whitespace-normal w-max max-w-[220px] z-50`}
              >
                {tooltip}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Value */}
      <div className="mt-3 flex flex-col relative z-10 min-h-[28px]">
        <div className="font-serif text-[22px] leading-tight text-[#F5F5F2] tracking-tight">
          {value}
        </div>
        {change && (
          <div className={`mt-1 text-[10px] font-medium font-sans ${isPositive ? 'text-[#BEB7A7]' : 'text-red-400'}`}>
            {change}
          </div>
        )}
        {callout && (
          <div className="mt-2.5">
            {callout}
          </div>
        )}
      </div>

      {/* Bottom accent line — always visible, brightens on hover */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#BEB7A7]/30 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
    </motion.div>
  );
}
