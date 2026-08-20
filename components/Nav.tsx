"use client";

import Link from "next/link";
import Image from "next/image";
import { useMe } from "@/lib/useMe";
import { IconWhatsApp } from "./Icons";

// "All apps" sits first, right next to the logo, on every page. The rest
// are the marketing tabs — always shown, signed in or not, so the menu bar
// never changes shape as someone moves between bizzux.com and the signed-in
// app (dashboard/team/profile/apps) — one consistent nav for the whole
// site. Account-specific destinations (Dashboard/Team/Sign out) live in
// AccountTabs, a secondary strip rendered under this one on the signed-in
// pages — Nav only shows "Profile" for those, plus, for Super Admins, a
// themed "Super Admin" button in the right-side button group, right before
// WhatsApp.
const links = [
  { href: "/apps", label: "All apps" },
  { href: "/platform", label: "Platform" },
  { href: "/custom-solutions", label: "Custom Solutions" },
  { href: "/solutions", label: "Solutions" },
  { href: "/microsoft-365", label: "Microsoft 365" },
  { href: "/pricing", label: "Pricing" },
  { href: "/careers", label: "Careers" },
];

export default function Nav() {
  // useMe() (lib/useMe.js) is what actually fixes the flicker here: Nav
  // isn't hoisted into a shared root layout (marketing/(saas)/admin each
  // wrap it differently), so every client-side navigation unmounts and
  // remounts this component from scratch, and it also shares its /api/me
  // request with whatever page it's rendered on instead of firing a
  // duplicate one.
  const { user, me } = useMe();
  const isSuper = me?.superAdmin === true;
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
          {signedIn && isSuper && (
            <Link
              href="/admin"
              className="hidden sm:inline-flex rounded-full bg-gradient-to-r from-brand-teal to-brand-blue text-sm font-semibold px-5 py-2.5 hover:opacity-90 transition-opacity whitespace-nowrap"
              style={{ color: "#ffffff" }}
            >
              Super Admin
            </Link>
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
