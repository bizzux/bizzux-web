/* Static hero: one image plus plain-HTML pricing. No client JS, no animations. */
const W = 1672, H = 859; // hero-banner.webp (nav bar cropped off)
const box = (x1: number, y1: number, x2: number, y2: number) => ({
  left: `${(x1 / W) * 100}%`,
  top: `${((y1 - 82) / H) * 100}%`,
  width: `${((x2 - x1) / W) * 100}%`,
  height: `${((y2 - y1) / H) * 100}%`,
});

export default function StaticHero() {
  return (
    <section className="bg-white">
      <div className="relative mx-auto max-w-[1672px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/hero-banner.webp"
          alt="Bizzux: all your business apps in one place. Simple. Smart. Affordable."
          width={W}
          height={H}
          className="block w-full h-auto"
        />
        {/* real links laid over the buttons baked into the image */}
        <a href="/sign-in?mode=signup" aria-label="Start Free Trial" className="absolute rounded-full" style={box(78, 610, 344, 672)} />
        <a href="/contact" aria-label="Book a Demo" className="absolute rounded-full" style={box(358, 610, 559, 672)} />
      </div>

      <div className="mx-auto max-w-3xl px-6 py-8 grid gap-4 sm:grid-cols-2">
        <div className="relative rounded-2xl border border-teal-300/70 bg-teal-50/60 p-5 pt-6">
          <span className="absolute -top-3 left-4 rounded-full bg-amber-400 px-3 py-0.5 text-xs font-bold text-white shadow">♛ Best Value</span>
          <div className="text-3xl font-extrabold" style={{ color: "#0b2545" }}>₹599<span className="text-base font-semibold"> / month</span></div>
          <div className="mt-1 font-semibold text-slate-800">All Apps Included</div>
          <div className="mt-2 border-t border-teal-200 pt-2 text-xs text-slate-500">One Platform. Unlimited Possibilities.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 pt-6">
          <div className="text-3xl font-extrabold" style={{ color: "#0b2545" }}>₹299<span className="text-base font-semibold"> / month</span></div>
          <div className="mt-1 text-slate-500">Single App Plan</div>
          <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500">Choose the app you need</div>
        </div>
      </div>
    </section>
  );
}
