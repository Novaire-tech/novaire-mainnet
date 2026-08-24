import { LogoMarquee, type Logo } from '@/components/ui/logo-marquee';

// Kept separate from the component so the logo set can be edited without touching
// LogoMarquee itself. `src` omitted where no verified official asset is available —
// LogoMarquee falls back to a clean text wordmark for those.
const ecosystemLogos: Logo[] = [
  { src: '/images/stellar.svg', alt: 'Stellar' },
  { src: '/images/blend.png', alt: 'Blend' },
  { src: '/images/freighter.png', alt: 'Freighter' },
];

export function TechMarquee() {
  return (
    // Same warm taupe canvas as "How Novaire Works" — no separate dark block breaking the page flow.
    // -mt-16 pulls this section up into the previous section's own bottom padding, landing on a
    // ~92px gap to the feature cards. Purely this section's own margin; the previous section's
    // file is untouched.
    <section className="-mt-16 w-full bg-[#e7e2ce] pt-4 pb-24">
      <div className="mx-auto w-full max-w-[1500px] px-6 md:px-10">
        <h2 className="text-left font-editorial font-normal uppercase text-[40px] leading-[1.05] tracking-[-0.01em] text-[#112a46] sm:text-[52px] md:text-[64px] lg:text-[72px]">
          BUILT FOR THE ECOSYSTEM
        </h2>
        <p className="mt-4 max-w-[520px] font-poppins text-[18px] font-normal leading-[1.6] text-[rgba(17,42,70,0.8)] sm:text-[19px] md:text-[20px]">
          Powered by the networks and protocols that secure billions.
        </p>

        <div className="mx-auto mt-8 w-full max-w-[1320px]">
          <LogoMarquee logos={ecosystemLogos} className="mx-0 max-w-none px-0 py-0" />
        </div>
      </div>
    </section>
  );
}
