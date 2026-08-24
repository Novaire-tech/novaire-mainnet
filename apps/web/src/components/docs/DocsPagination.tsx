import React from 'react';
import Link from 'next/link';

interface DocsPaginationProps {
  prev?: { title: string; href: string };
  next?: { title: string; href: string };
}

export default function DocsPagination({ prev, next }: DocsPaginationProps) {
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-20 pt-8 border-t border-nova-border">
      {prev ? (
        <Link 
          href={prev.href} 
          className="group w-full sm:w-1/2 flex flex-col items-start p-6 rounded-2xl border border-nova-border bg-white/5 md:hover:border-[#BEB7A7] transition-colors duration-200 ease-in-out"
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-2">
            <span>←</span> Previous
          </span>
          <span className="relative inline-block text-lg font-medium text-white transition-colors">
            {prev.title}
            <span className="absolute left-0 -bottom-1 h-[2px] w-0 bg-[#BEB7A7] transition-all duration-200 ease-in-out md:group-hover:w-full" />
          </span>
        </Link>
      ) : (
        <div className="hidden sm:block sm:w-1/2" />
      )}
      
      {next ? (
        <Link 
          href={next.href} 
          className="group w-full sm:w-1/2 flex flex-col items-end p-6 rounded-2xl border border-nova-border bg-white/5 md:hover:border-[#BEB7A7] transition-colors duration-200 ease-in-out text-right"
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-2 justify-end">
            Next <span>→</span>
          </span>
          <span className="relative inline-block text-lg font-medium text-white transition-colors">
            {next.title}
            <span className="absolute left-0 -bottom-1 h-[2px] w-0 bg-[#BEB7A7] transition-all duration-200 ease-in-out md:group-hover:w-full" />
          </span>
        </Link>
      ) : (
        <div className="hidden sm:block sm:w-1/2" />
      )}
    </div>
  );
}
