export function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`max-w-6xl mx-auto px-6 ${className}`}>{children}</div>;
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-brand font-semibold text-sm tracking-wide uppercase mb-3">
      {children}
    </div>
  );
}

export function CTAButton({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
}) {
  const base = "inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold transition-colors";
  const styles =
    variant === "primary"
      ? `${base} bg-brand text-white hover:bg-brand-dark`
      : `${base} border border-slate-300 text-ink hover:border-brand hover:text-brand`;
  return (
    <a href={href} className={styles}>
      {children}
    </a>
  );
}
