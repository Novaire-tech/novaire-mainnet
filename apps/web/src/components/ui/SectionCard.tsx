import React from 'react';
import { motion } from 'framer-motion';
import { CardWaveDecoration } from './CardWaveDecoration';

export interface SectionCardProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

export function SectionCard({ children, className = '', delay = 0 }: SectionCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
      whileHover={{ y: -3 }}
      className={`relative overflow-hidden rounded-2xl border border-nova-border bg-nova-surface transition-all duration-200 hover:border-nova-accent-hover hover:shadow-[0_0_18px_var(--accent-hover)] ${className}`}
      style={{ padding: '24px' }}
    >
      <CardWaveDecoration />
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}
