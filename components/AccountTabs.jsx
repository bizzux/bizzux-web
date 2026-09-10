"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

// Secondary strip shown just below Nav, only on the Your Profile / Dashboard
// / Team pages themselves — the Super Admin page has its own tab strip
// (AdminTabs.tsx) and doesn't need this one at all, so it renders nothing
// there. The sub-tabs and the signed-in-as email + Sign out share one row.
const PROFILE_SECTION_KEYS = ["profile", "dashboard", "team"];

export default function AccountTabs({ active, isAccountAdmin = false, isSuper = false, roleLabel = "" }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  const inProfileSection = PROFILE_SECTION_KEYS.includes(active);
  if (!inProfileSection) return null;

  // Your Profile is always first, so landing on the Profile nav link always
  // opens there first.
  const subTabs = [
    { key: "profile", href: "/profile", label: "Your Profile" },
    { key: "dashboard", href: "/dashboard", label: "Dashboard" },
    ...(isAccountAdmin ? [{ key: "team", href: "/team", label: "Team" }] : []),
  ];

  return (
    <div className="border-b border-slate-100 bg-white">
      <div className="max-w-7xl mx-auto px-6 h-12 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-5 text-[13px] font-medium">
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
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap justify-end">
          {user?.email && (
            <span className="text-xs text-slate-700 truncate max-w-[45vw] sm:max-w-none" title="Signed in as">
              {user.email}
            </span>
          )}
          {roleLabel && (
            <span className="text-[11px] font-semibold text-brand-blue bg-blue-50 rounded-full px-3 py-1 whitespace-nowrap">
              {roleLabel}
            </span>
          )}
          <button
            onClick={() => signOut(auth)}
            className="h-10 text-sm font-medium text-black bg-slate-200 hover:bg-slate-300 rounded-full px-4 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
