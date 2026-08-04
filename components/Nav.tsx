import Link from "next/link";
import Image from "next/image";

const links = [
  { href: "/product", label: "Product" },
  { href: "/solutions", label: "Solutions" },
  { href: "/pricing", label: "Pricing" },
  { href: "/resources", label: "Resources" },
  { href: "/about", label: "About" },
];

export default function Nav() {
  return (
    <header className="border-b border-slate-100 sticky top-0 bg-white/90 backdrop-blur z-50">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image src="/logo-transparent.png" alt="Bizzux" width={132} height={54} priority className="h-9 w-auto" />
        </Link>
        <nav className="hidden lg:flex items-center gap-7 text-sm font-medium text-slate-600">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-brand-blue transition-colors">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/sign-in" className="hidden sm:block text-sm font-medium text-slate-600 hover:text-brand-blue transition-colors">
            Sign in
          </Link>
          <Link
            href="/contact"
            className="rounded-full bg-gradient-to-r from-brand-teal to-brand-blue text-white text-sm font-semibold px-5 py-2.5 hover:opacity-90 transition-opacity"
          >
            Book a demo
          </Link>
        </div>
      </div>
    </header>
  );
}
