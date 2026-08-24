import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function BentoGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid w-full grid-cols-1 gap-6 sm:grid-cols-3 sm:auto-rows-[320px] md:auto-rows-[360px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function BentoCard({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group relative flex min-h-[240px] flex-col overflow-hidden rounded-[28px] border border-[#112a46]/[0.1] bg-[#BEB7A7] shadow-none transition-colors duration-300 ease-out hover:border-[#112a46]/[0.16] sm:min-h-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
