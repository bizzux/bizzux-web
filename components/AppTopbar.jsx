"use client";

import Link from "next/link";
import Image from "next/image";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

// Shared header for the signed-in app pages (dashboard, team, profile) —
// same white/sticky look, font and colors as the marketing site's Nav
// (components/Nav.tsx) and the same logo asset, so the "menu bar" reads as
// one consistent design across the whole app instead of switching to the
// old dark-navy apps.bizzux.com theme once you're signed in. `links` are
// the page-specific nav items (Dashboard/Team/Admin/Profile, shown
// conditionally by each page); Sign out is always last.
export default function AppTopbar({ links = [] }) {
  return (
    <header className="border-b border-slate-100 sticky top-0 bg-white/90 backdrop-blur z-50">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image src="/logo-transparent.png" alt="Bizzux" width={132} height={54} className="h-9 w-auto" />
        </Link>
        <div className="flex items-center gap-3 shrink-0">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-slate-600 hover:text-brand-blue transition-colors whitespace-nowrap"
            >
              {l.label}
            </Link>
          ))}
          <button
            onClick={() => signOut(auth)}
            className="rounded-full border border-slate-200 text-slate-600 text-sm font-semibold px-4 py-2 hover:bg-slate-50 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
