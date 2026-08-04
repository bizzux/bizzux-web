import Link from "next/link";
import Image from "next/image";
import { IconWhatsApp } from "./Icons";

const links = [
  { href: "/platform", label: "Platform" },
  { href: "/custom-solutions", label: "Custom Solutions" },
  { href: "/solutions", label: "Solutions" },
  { href: "/microsoft-365", label: "Microsoft 365" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/careers", label: "Careers" },
];

export default function Nav() {
  return (
    <header className="border-b border-slate-100 sticky top-0 bg-white/90 backdrop-blur z-50">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image src="/logo-transparent.png" alt="Bizzux" width={132} height={54} priority className="h-9 w-auto" />
        </Link>
        <nav className="hidden xl:flex items-center gap-6 text-sm font-medium text-slate-600">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-brand-blue transition-colors whitespace-nowrap">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 shrink-0">
          <Link href="/sign-in" className="hidden sm:block text-sm font-medium text-slate-600 hover:text-brand-blue transition-colors">
            Sign in
          </Link>
          <a
            href="https://wa.me/919591222422"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-green-500 text-green-600 text-sm font-semibold px-4 py-2.5 hover:bg-green-50 transition-colors"
          >
            <IconWhatsApp className="w-4 h-4" />
            WhatsApp
          </a>
          <Link
            href="/contact"
            className="rounded-full bg-gradient-to-r from-brand-teal to-brand-blue text-white text-sm font-semibold px-5 py-2.5 hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            Book a demo
          </Link>
        </div>
      </div>
    </header>
  );
}
