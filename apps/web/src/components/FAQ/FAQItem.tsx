'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

interface FAQItemProps {
  index: string;
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
}

export function FAQItem({ index, question, answer, isOpen, onToggle }: FAQItemProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div
      className={`overflow-hidden rounded-[20px] border bg-[rgba(17,42,70,0.02)] transition-colors duration-300 ease-out ${
        isOpen
          ? 'border-[rgba(17,42,70,0.35)]'
          : 'border-[rgba(17,42,70,0.12)]'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="group flex w-full items-center justify-between gap-4 px-6 py-3.5 text-left"
      >
        <span className="flex items-center gap-4">
          <span className="font-poppins text-[13px] font-medium tracking-[0.06em] text-[rgba(17,42,70,0.45)] transition-colors duration-[250ms] ease-out group-hover:text-[#2454a6]">
            {index}
          </span>
          <span className="font-poppins text-[17px] font-medium leading-[1.4] text-[#112a46] transition-colors duration-[250ms] ease-out group-hover:text-[#2454a6] sm:text-[18px]">
            {question}
          </span>
        </span>

        <motion.svg
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.3, ease: 'easeOut' }}
          className="h-5 w-5 flex-shrink-0 text-[#112a46] transition-colors duration-[250ms] ease-out group-hover:text-[#2454a6]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </motion.svg>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.35, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <p className="whitespace-pre-line px-6 pb-6 pl-[52px] font-poppins text-[15px] font-normal leading-[1.7] text-[rgba(17,42,70,0.65)] sm:text-[16px]">
              {answer}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
