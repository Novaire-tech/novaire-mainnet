/**
 * Shared decorative wave line for Web Terminal cards. Purely visual — no data,
 * no interaction. Parent must be `relative overflow-hidden` (and typically
 * `rounded-*`) so this clips to the card's shape and sits behind its content.
 */
export function CardWaveDecoration() {
  return (
    <svg
      className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-12 w-full opacity-[0.14] sm:h-14"
      viewBox="0 0 400 60"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M0,40 C 40,20 70,52 110,34 C 150,16 180,48 220,32 C 260,16 290,46 330,30 C 355,20 375,34 400,26"
        fill="none"
        stroke="#BEB7A7"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
