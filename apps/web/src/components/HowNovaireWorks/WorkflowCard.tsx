'use client';

import { motion, useReducedMotion } from 'framer-motion';

export interface WorkflowCardProps {
  /** Static image asset for the media area. Falls back to a placeholder when omitted. */
  image?: string;
  /** Video asset for the media area, takes precedence over `image` when provided. */
  video?: string;
  /** Small uppercase step label shown above the title, e.g. "1. Deposit". */
  step?: string;
  /** Card title. Falls back to a placeholder when omitted. */
  title?: string;
  /** Card description. Falls back to a placeholder when omitted. */
  description?: string;
  /** Stagger index used to offset the entrance animation. */
  index?: number;
  /** Shifts the artwork up within the frame (px), independent of the title/description below. */
  imageLift?: number;
  /** Renders an animated "energy flow" pulse traveling along the two connecting arrows on hover. */
  flowPaths?: boolean;
  /** Centers the artwork within the frame instead of bottom-anchoring it (card 1's default treatment). */
  centerImage?: boolean;
  /** Nudges a centered image down (px) via margin-top, independent of the card's own hover-scale transform. */
  centerImageOffsetY?: number;
}

export function WorkflowCard({
  image,
  video,
  step,
  title,
  description,
  index = 0,
  imageLift,
  flowPaths,
  centerImage,
  centerImageOffsetY,
}: WorkflowCardProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{
        duration: prefersReducedMotion ? 0 : 0.7,
        ease: 'easeOut',
        delay: prefersReducedMotion ? 0 : index * 0.1,
      }}
      className="group flex h-[520px] flex-col overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#112a46] transition-all duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-[6px] hover:shadow-[0_28px_56px_-20px_rgba(0,0,0,0.3)] md:h-[560px]"
    >
      {/* Media area — top ~70%, shrunk 20px so the content below can start higher without a negative margin
          (a negative margin here would overlap the sibling across this overflow-hidden ancestor's boundary,
          which triggers a Chromium text-rasterization bug — glyphs render corrupted right at that seam). */}
      <div className="relative h-[calc(70%-20px)] w-full shrink-0 overflow-hidden rounded-t-[28px] bg-[#112a46]">
        {/* Media frame — a second, fixed border inset from the card edge. Only what's INSIDE it (and this border) animates. */}
        <div className="absolute inset-6 flex items-end justify-center overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.08)] transition-[border-color] duration-[450ms] ease-[ease] group-hover:border-[rgba(255,255,255,0.22)]">
          {/* Inner canvas: only this crossfades on hover, contained entirely within the frame */}
          <div className="absolute inset-0 bg-[#112a46]" />
          <div className="absolute inset-0 bg-[#7A8CA6] opacity-0 transition-opacity duration-[450ms] ease-[ease] group-hover:opacity-100" />

          {video ? (
            // Video fills the inner frame edge-to-edge (object-cover) instead of sitting inset like the
            // static artwork, so it starts exactly at this rounded border rather than floating within it.
            <video
              src={video}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              controls={false}
              className="absolute inset-0 h-full w-full origin-center object-cover transition-transform duration-[450ms] ease-[ease] group-hover:scale-[1.04]"
            />
          ) : image && flowPaths ? (
            // Split-diagram artwork: wrapped so an SVG overlay (built to a 659x523 viewBox matching
            // this specific image) can be pixel-aligned with the coordinate space below.
            <div
              style={imageLift ? { marginBottom: imageLift } : undefined}
              className="relative aspect-[659/523] max-h-[94%] max-w-[85%] origin-center transition-transform duration-[450ms] ease-[ease] group-hover:scale-[1.06]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt={title ?? ''} className="h-full w-full object-contain" />

              <svg
                viewBox="0 0 659 523"
                className="pointer-events-none absolute inset-0 h-full w-full overflow-visible opacity-0 transition-opacity duration-500 ease-out group-hover:opacity-100"
                aria-hidden="true"
              >
                <defs>
                  {/* stdDeviation is in the same 659x523 user-space units as the paths below, so it scales
                      correctly with the card at every breakpoint (a CSS filter:blur() px value would not). */}
                  <filter id="workflow-pulse-blur" x="-200%" y="-200%" width="500%" height="500%">
                    <feGaussianBlur stdDeviation="9" />
                  </filter>
                </defs>
                {/* Two hand-drawn bezier paths tracing the dotted arrows baked into the PNG — the artwork
                    itself can't be animated, so these invisible guide paths carry the traveling pulse. */}
                {[
                  'M 245,178 C 195,225 130,255 100,325',
                  'M 415,178 C 465,225 530,255 558,325',
                ].map((d, i) => (
                  <g key={i}>
                    {/* Soft blurred aura — literal Blue Slate, heavily blurred so it reads as a glow.
                        (mix-blend-mode: screen was tried here to keep the core dot in literal #7A8CA6 too,
                        but it doesn't composite reliably with SVG filters in this rendering pipeline, so the
                        core below uses a lightened Blue Slate tint — a real color difference, not a blend
                        trick — to stay visible once the media background transitions to this same hue.) */}
                    <circle
                      r="11"
                      fill="#7A8CA6"
                      opacity="0"
                      filter="url(#workflow-pulse-blur)"
                      style={{ offsetPath: `path("${d}")` }}
                      className="animate-flow-pulse"
                    />
                    {/* Lightened Blue Slate core so the pulse stays visibly distinct from the identical-hue hover fill */}
                    <circle
                      r="6"
                      fill="#C3CEDC"
                      opacity="0"
                      style={{ offsetPath: `path("${d}")` }}
                      className="animate-flow-pulse"
                    />
                  </g>
                ))}
              </svg>
            </div>
          ) : image && centerImage ? (
            // Standard centered artwork: a normal flex child with self-center overriding the frame's
            // items-end, sized via max-h/max-w so it fills the frame nicely without cropping.
            <img
              src={image}
              alt={title ?? ''}
              style={{
                ...(imageLift ? { marginBottom: imageLift } : {}),
                ...(centerImageOffsetY ? { marginTop: centerImageOffsetY } : {}),
              }}
              className="relative max-h-[94%] max-w-[85%] w-auto origin-center self-center object-contain transition-transform duration-[400ms] ease-[ease] group-hover:scale-[1.04]"
            />
          ) : image ? (
            // Plain artwork (no SVG overlay needed). Sized the same way as before (max-h/max-w caps,
            // natural aspect ratio) so the rendered scale is unchanged, but positioned via absolute
            // placement + a horizontal-centering transform instead of align-items/justify-content —
            // Pinned as close to the frame's bottom edge as possible without clipping: the source PNG
            // is already cropped tight to the coins (no internal transparent margin), so any negative
            // bottom offset pushes real pixels past this frame's overflow-hidden edge and flattens them.
            <img
              src={image}
              alt={title ?? ''}
              style={imageLift ? { marginBottom: imageLift } : undefined}
              className="absolute bottom-[2px] left-1/2 max-h-[94%] max-w-[85%] w-auto -translate-x-1/2 origin-bottom object-contain transition-transform duration-[450ms] ease-[ease] group-hover:scale-[1.06]"
            />
          ) : (
            <div className="relative flex h-full w-full flex-col items-center justify-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-white/20">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(245,244,240,0.4)" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </div>
              <span className="font-poppins text-[12px] font-medium uppercase tracking-[0.14em] text-white/40">
                Asset Placeholder
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Content area — bottom ~30%, grown by the same 20px taken from the media area above */}
      <div className="flex h-[calc(30%+20px)] w-full flex-col overflow-hidden px-8 pt-0">
        {step && (
          <span className="font-poppins text-[14px] font-medium uppercase tracking-[0.08em] text-[#beb7a7]">
            {step}
          </span>
        )}
        <h3 className={`font-poppins text-[40px] font-bold leading-tight tracking-[-0.02em] text-[#f5f4f0] ${step ? 'mt-3' : ''}`}>
          {title ?? 'Title Placeholder'}
        </h3>
        <p className="mt-4 w-[90%] font-poppins text-[18px] font-normal leading-[1.7] text-[rgba(245,244,240,0.82)]">
          {description ?? 'Description Placeholder'}
        </p>
      </div>
    </motion.div>
  );
}
