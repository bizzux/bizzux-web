import { IconArrowRight } from "./Icons";
import { BRAND_TAGLINE } from "@/lib/brand";

export function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`max-w-6xl mx-auto px-6 ${className}`}>{children}</div>;
}

export function Eyebrow({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <div className={`font-semibold text-sm tracking-wide uppercase mb-3 ${light ? "text-brand-lime" : "text-brand-blue"}`}>
      {children}
    </div>
  );
}

// The "what is Bizzux" category line, shown small-but-visible at the top of
// every marketing page header (the home hero renders its own large version).
export function BrandTagline({ light = false, className = "" }: { light?: boolean; className?: string }) {
  return (
    <div
      className={`inline-flex items-center rounded-full px-3 py-1 mb-4 text-[11px] md:text-xs font-bold tracking-wider uppercase border ${
        light ? "text-white bg-white/10 border-white/20" : "text-brand-tealDark bg-teal-50 border-teal-100"
      } ${className}`}
    >
      {BRAND_TAGLINE}
    </div>
  );
}

export function CTAButton({
  href,
  children,
  variant = "primary",
  icon = false,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost-light";
  icon?: boolean;
}) {
  const base = "inline-flex items-center gap-2 justify-center rounded-full h-10 px-6 text-sm font-semibold transition-all";
  const styles = {
    primary: `${base} bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white hover:opacity-90 shadow-sm`,
    secondary: `${base} border border-slate-300 text-ink hover:border-brand-blue hover:text-brand-blue`,
    "ghost-light": `${base} border border-white/40 text-white hover:bg-white/10`,
  }[variant];
  return (
    <a href={href} className={styles}>
      {children}
      {icon && <IconArrowRight className="w-4 h-4" />}
    </a>
  );
}

export function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-white border border-slate-200 px-4 py-1.5 text-sm text-slate-600">
      {children}
    </span>
  );
}
