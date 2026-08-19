"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { IconWhatsApp } from "./Icons";

// "All apps" sits first, right next to the logo, on every page. The rest
// are the marketing tabs — always shown, signed in or not, so the menu bar
// never changes shape as someone moves between bizzux.com and the signed-in
// app (dashboard/team/profile/apps) — one consistent nav for the whole
// site. Account-specific destinations (Dashboard/Team/Admin/Sign out) live
// in AccountTabs, a secondary strip rendered under this one on the
// signed-in pages — Nav only ever shows a single "Profile" link for those,
// styled exactly like every other tab here.
const links = [
  { href: "/apps", label: "All apps" },
  { href: "/platform", label: "Platform" },
  { href: "/custom-solutions", label: "Custom Solutions" },
  { href: "/solutions", label: "Solutions" },
  { href: "/microsoft-365", label: "Microsoft 365" },
  { href: "/about", label: "About" },
  { href: "/careers", label: "Careers" },
];

export default function Nav() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  const signedIn = !!user;

  return (
    <header className="border-b border-slate-100 sticky top-0 bg-white/90 backdrop-blur z-50">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image src="/logo-transparent.png" alt="Bizzux" width={132} height={54} priority className="h-9 w-auto" />
        </Link>
        <nav className="hidden xl:flex items-center gap-6 text-sm font-medium" style={{ color: "#000000" }}>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-brand-blue transition-colors whitespace-nowrap">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 shrink-0">
          {signedIn ? (
            <Link href="/dashboard" className="hidden sm:block text-sm font-medium hover:text-brand-blue transition-colors" style={{ color: "#000000" }}>
              Profile
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className="hidden sm:block text-sm font-medium hover:text-brand-blue transition-colors" style={{ color: "#000000" }}>
                Sign in
              </Link>
              <Link
                href="/sign-in?mode=signup"
                className="hidden sm:inline-flex rounded-full bg-gradient-to-r from-brand-teal to-brand-blue text-sm font-semibold px-5 py-2.5 hover:opacity-90 transition-opacity whitespace-nowrap"
                style={{ color: "#ffffff" }}
              >
                Start free trial
              </Link>
            </>
          )}
          <a
            href="https://wa.me/919591222422"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-green-500 text-sm font-semibold px-4 py-2.5 hover:bg-green-50 transition-colors"
            style={{ color: "#16a34a" }}
          >
            <IconWhatsApp className="w-4 h-4" />
            WhatsApp
          </a>
          <Link
            href="/contact"
            className="rounded-full bg-gradient-to-r from-brand-teal to-brand-blue text-sm font-semibold px-5 py-2.5 hover:opacity-90 transition-opacity whitespace-nowrap"
            style={{ color: "#ffffff" }}
          >
            Book a demo
          </Link>
        </div>
      </div>
    </header>
  );
}
