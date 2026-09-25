import type { CustomerLogo } from "@/lib/companyData";

// Right-to-left scrolling strip of customer logos (Razorpay-style). Pure
// CSS: the list is rendered twice back to back and the track slides by
// exactly -50%, so the second copy lands where the first started and the
// loop is seamless. Pauses on hover; stops for prefers-reduced-motion.
// Logos show greyscale and turn full colour on hover. Renders nothing until
// at least one logo is added in /admin → Customers.
export default function CustomerMarquee({
  logos,
  title = "Trusted by growing businesses",
}: {
  logos: CustomerLogo[];
  title?: string;
}) {
  if (logos.length === 0) return null;
  // Repeat short lists so one copy is always wider than the screen,
  // otherwise a gap would show before the loop wraps.
  const base = logos.length >= 8 ? logos : Array.from({ length: Math.ceil(8 / logos.length) }, () => logos).flat();
  // ~3s per logo keeps the speed steady whatever the count.
  const duration = `${Math.max(20, base.length * 3)}s`;

  const Item = ({ c, hidden }: { c: CustomerLogo; hidden?: boolean }) => {
    const img = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={c.logoUrl}
        alt={hidden ? "" : c.name}
        title={c.name}
        loading="lazy"
        className="h-10 md:h-12 w-auto max-w-[160px] object-contain grayscale opacity-70 transition duration-300 hover:grayscale-0 hover:opacity-100"
      />
    );
    return (
      <li className="shrink-0 px-8 md:px-10 flex items-center" aria-hidden={hidden || undefined}>
        {c.website ? (
          <a href={c.website} target="_blank" rel="noopener noreferrer" tabIndex={hidden ? -1 : undefined}>
            {img}
          </a>
        ) : (
          img
        )}
      </li>
    );
  };

  return (
    <section className="py-10 md:py-12" aria-label={title}>
      <p className="text-center text-xs md:text-sm font-bold tracking-wider uppercase text-slate-500 mb-6">{title}</p>
      <div className="bzx-marquee relative overflow-hidden">
        <ul className="bzx-marquee-track flex w-max" style={{ animationDuration: duration }}>
          {base.map((c, i) => <Item key={"a" + i} c={c} />)}
          {base.map((c, i) => <Item key={"b" + i} c={c} hidden />)}
        </ul>
      </div>
    </section>
  );
}
