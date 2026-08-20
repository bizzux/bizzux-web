"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

// Secondary tab strip shown just below Nav on the signed-in account pages.
// Two top-level destinations only: "Profile" (which itself expands into a
// second row of sub-tabs — Your Profile / Dashboard / Team) and "Super
// Admin" (Super-Admin-only, its own page handles its own 3 sub-tabs
// internally — see AdminTabs.tsx). `active` marks which sub-page is
// current; Team only shows for account admins, Super Admin only for
// Super Admin.
const PROFILE_SECTION_KEYS = ["profile", "dashboard", "team"];

export default function AccountTabs({ active, isAccountAdmin = false, isSuper = false }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  const inProfileSection = PROFILE_SECTION_KEYS.includes(active);

  const topTabs = [
    { key: "profile-section", href: "/profile", label: "Profile", isActive: inProfileSection },
    ...(isSuper ? [{ key: "admin", href: "/admin", label: "Super Admin", isActive: active === "admin" }] : []),
  ];

  // Your Profile is always first, so landing on the Profile top tab always
  // opens there first.
  const subTabs = [
    { key: "profile", href: "/profile", label: "Your Profile" },
    { key: "dashboard", href: "/dashboard", label: "Dashboard" },
    ...(isAccountAdmin ? [{ key: "team", href: "/team", label: "Team" }] : []),
  ];

  return (
    <div className="border-b border-slate-100 bg-white">
      <div className="max-w-7xl mx-auto px-6 h-12 flex items-center justify-between">
        <nav className="flex items-center gap-6 text-sm font-medium">
          {topTabs.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className={
                "h-12 inline-flex items-center border-b-2 transition-colors " +
                (t.isActive
                  ? "border-brand-blue text-brand-blue"
                  : "border-transparent text-slate-800 hover:text-brand-blue")
              }
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-4">
          {user?.email && (
            <span className="hidden sm:inline text-xs text-slate-500" title="Signed in as">
              {user.email}
            </span>
          )}
          <button
            onClick={() => signOut(auth)}
            className="text-sm font-medium text-slate-600 hover:text-brand-blue transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>

      {inProfileSection && (
        <div className="max-w-7xl mx-auto px-6 h-10 flex items-center gap-5 text-[13px] font-medium border-t border-slate-50">
          {subTabs.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className={
                "transition-colors " +
                (active === t.key ? "text-brand-blue font-semibold" : "text-slate-500 hover:text-brand-blue")
              }
            >
              {t.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
