"use client";

import Link from "next/link";

// Secondary strip shown just below Nav, only on the Your Profile / Dashboard
// / Team pages themselves — the Super Admin page has its own tab strip
// (AdminTabs.tsx) and doesn't need this one at all, so it renders nothing
// there. Sub-tabs only — the signed-in-as email, role badge, and Sign out
// used to be repeated here too, directly duplicating Nav's own top-right
// group one row above; dropped in favor of that single copy.
const PROFILE_SECTION_KEYS = ["profile", "dashboard", "team", "team-apps", "team-groups", "team-security"];

// isSuper/roleLabel are no longer used here (see the file comment above)
// but stay accepted so every existing caller — several are .tsx files that
// type-check these props — doesn't need to change just because this
// component stopped needing them.
export default function AccountTabs({ active, isAccountAdmin = false, isSuper = false, roleLabel = "" }) {
  const inProfileSection = PROFILE_SECTION_KEYS.includes(active);
  if (!inProfileSection) return null;

  // Your Profile is always first, so landing on the Profile nav link always
  // opens there first. "Team" itself isn't listed here — Nav's own "Admin
  // Center" link already goes to /team, so a second link to the same page
  // right below it was a pure duplicate; "Apps" stays since Admin Center
  // doesn't cover /team/apps.
  const subTabs = [
    { key: "profile", href: "/profile", label: "Your Profile" },
    { key: "dashboard", href: "/dashboard", label: "Dashboard" },
    ...(isAccountAdmin ? [{ key: "team-apps", href: "/team/apps", label: "Apps" }] : []),
    ...(isAccountAdmin ? [{ key: "team-groups", href: "/team/groups", label: "Groups" }] : []),
    ...(isAccountAdmin ? [{ key: "team-security", href: "/team/security", label: "Security" }] : []),
  ];

  return (
    <div className="border-b border-slate-100 bg-white">
      <div className="max-w-7xl mx-auto px-6 h-12 flex items-center gap-5 text-[13px] font-medium">
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
    </div>
  );
}
