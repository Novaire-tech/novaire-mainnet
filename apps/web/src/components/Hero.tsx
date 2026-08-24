import { HeroVideo } from "./hero/HeroVideo";

export function Hero() {
  return (
    <section className="relative w-full bg-nova-bg px-4 pt-[78px] pb-4 md:px-5 md:pt-[79px] md:pb-5 lg:px-6 lg:pt-[80px] lg:pb-8">
      <div className="mx-auto w-full max-w-[1760px]">
        <HeroVideo />
      </div>
    </section>
  );
}
