'use client';

import React from 'react';
import { motion } from 'framer-motion';

export interface PageContainerProps {
  children: React.ReactNode;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageContainer({ children, title, description, actions, className = '' }: PageContainerProps) {
  return (
    <div className={`mx-auto max-w-7xl px-6 pt-6 pb-12 lg:px-8 ${className}`}>
      {/* Page Header — matches Dashboard's pt-6 / gap-6 rhythm */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center"
      >
        <div>
          <h1 className="text-2xl font-medium text-white tracking-tight font-sans leading-none">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 text-sm text-[#F5F5F2]/60 font-sans leading-snug">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-3 flex-shrink-0">
            {actions}
          </div>
        )}
      </motion.div>

      {/* Page Content */}
      <div className="flex flex-col gap-6">
        {children}
      </div>
    </div>
  );
}
