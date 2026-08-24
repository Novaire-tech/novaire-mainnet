"use client";

import { ReactLenis } from "lenis/react";
import type { LenisOptions } from "lenis";
import type { ReactNode } from "react";

const lenisOptions: LenisOptions = {
  duration: 1.15,
  easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  lerp: 0.1,
  wheelMultiplier: 1,
  touchMultiplier: 1,
  smoothWheel: true,
  syncTouch: false,
  anchors: true,
  autoRaf: true,
};

const reducedMotionOptions: LenisOptions = {
  ...lenisOptions,
  duration: 0,
  lerp: 1,
  smoothWheel: false,
};

export default function SmoothScrollProvider({ children }: { children: ReactNode }) {
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <ReactLenis root options={prefersReducedMotion ? reducedMotionOptions : lenisOptions}>
      {children}
    </ReactLenis>
  );
}
