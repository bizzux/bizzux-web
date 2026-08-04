import Link from "next/link";

const links = [
  { href: "/platform", label: "Platform" },
  { href: "/custom-software", label: "Custom Software" },
  { href: "/contact", label: "Contact" },
];

export default function Nav() {
  return (
    <header className="border-b border-slate-100 sticky top-0 bg-white/90 backdrop-blur z-50">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight">
          Bizz<span className="text-brand">ux</span>
        </Link>
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-brand transition-colors">
              {l.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/contact"
          className="rounded-full bg-brand text-white text-sm font-semibold px-5 py-2.5 hover:bg-brand-dark transition-colors"
        >
          Start Free
        </Link>
      </div>
    </header>
  );
}
