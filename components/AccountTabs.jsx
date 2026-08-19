"use client";

import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

// Secondary tab strip shown just below Nav on the signed-in account pages
// (dashboard/team/profile) — the account-specific destinations (Dashboard,
// Profile, Team, Admin) live here instead of in the main header, so Nav
// itself stays identical to the signed-out marketing bar. `active` marks
// which tab is current; Team/Admin only render for people with that role.
export default function AccountTabs({ active, isAccountAdmin = false, isSuper = false }) {
  const tabs = [
    { key: "dashboard", href: "/dashboard", label: "Dashboard" },
    { key: "profile", href: "/profile", label: "Profile" },
    ...(isAccountAdmin ? [{ key: "team", href: "/team", label: "Team" }] : []),
    ...(isSuper ? [{ key: "admin", href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <div className="border-b border-slate-100 bg-white">
      <div className="max-w-7xl mx-auto px-6 h-12 flex items-center justify-between">
        <nav className="flex items-center gap-6 text-sm font-medium">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className={
                "h-12 inline-flex items-center border-b-2 transition-colors " +
                (active === t.key
                  ? "border-brand-blue text-brand-blue"
                  : "border-transparent text-slate-600 hover:text-brand-blue")
              }
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => signOut(auth)}
          className="text-sm font-medium text-slate-600 hover:text-brand-blue transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
