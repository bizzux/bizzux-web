"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useMe } from "@/lib/useMe";
import { roleLabel } from "@/lib/roleLabel";

// "All apps" sits first, right next to the logo, on every page. The rest
// are the marketing tabs, always shown, signed in or not, so the menu bar
// never changes shape as someone moves between bizzux.com and the signed-in
// app (dashboard/team/profile/apps), one consistent nav for the whole
// site. Links live directly next to the logo on the left; a flex-1 spacer
// pushes the auth/CTA/Super Admin group to the far right edge.
//
// The right-side group has two slots that both flip on sign-in state:
//   - Slot 1: "Sign in / Sign up" (signed out) -> "Profile" (signed in),
//     styled as a plain link with the same hover underline as the tabs.
//   - Slot 2: "Start Free Trial" (signed out) -> "Book a demo" (signed in,
//     links to /contact), the one filled CTA button.
// Account-specific destinations (Dashboard/Team/Sign out) live in
// AccountTabs, a secondary strip rendered under this one on the signed-in
// pages. For Super Admins, a themed "Super Admin" button follows the CTA.
const links = [
  { href: "/apps", label: "All apps" },
  { href: "/careers", label: "Career" },
  { href: "/custom-solutions", label: "Build" },
  { href: "/pricing", label: "Pricing" },
  { href: "/partners", label: "Partners" },
];

// A fixed h-9 box (same height as the logo) with the label vertically
// centered inside it, and the hover underline drawn as an absolutely
// positioned bar pinned to the box's own bottom edge. Because the
// underline doesn't add any padding or border to the box itself, the
// label sits at the exact same vertical center as the logo instead of
// getting nudged upward the way a real border-bottom would.
function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group relative inline-flex h-9 items-center whitespace-nowrap text-sm font-medium"
      style={{ color: "#000000" }}
    >
      <span>{children}</span>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-brand-teal transition-transform duration-200 group-hover:scale-x-100" />
    </Link>
  );
}

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
  // Same "who am I" wording used on Profile/Dashboard/Team's AccountTabs
  // badge (see lib/roleLabel.js) — repeated here so it's visible on every
  // page, not just those three, since Nav itself isn't in a shared layout.
  const myRoleLabel = isSuper ? "Platform " + (me?.platformRole === "OWNER" ? "Owner" : "Admin") : roleLabel(me);
  const [mobileOpen, setMobileOpen] = useState(false);

  // One breakpoint (lg) splits the ENTIRE right-side group — role badge,
  // Profile/Sign in, CTA, Super Admin, Sign out — from the desktop row into
  // the mobile menu below, rather than each item picking its own `sm:`/`xl:`
  // cutoff. Those used to just disappear below `sm` with nothing standing in
  // for them (no hamburger existed at all) — on a phone there was no way to
  // tell who was signed in, what role they had, or how to sign out. Same
  // content either way now, just laid out for the width it's on.
  const closeMenu = () => setMobileOpen(false);

  return (
    <header className="border-b border-slate-100 sticky top-0 bg-white/90 backdrop-blur z-50">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center gap-8">
        <Link href="/" className="flex items-center gap-2 shrink-0" onClick={closeMenu}>
          {/* The source PNG has a lot of transparent headroom above the
              wordmark for the small cloud+arrow accent, so its own visual
              center sits well below the true center of its h-9 box — nudge
              it up so the "bizzux" text lines up with the nav tabs' text
              instead of the box's geometric center. */}
          <Image src="/logo-transparent.png" alt="Bizzux" width={132} height={54} priority className="h-9 w-auto -translate-y-1.5" />
        </Link>
        <nav className="hidden lg:flex items-center gap-6">
          {links.map((l) => (
            <NavLink key={l.href} href={l.href}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex-1" />
        <div className="hidden lg:flex items-center gap-3 shrink-0">
          {signedIn && myRoleLabel && (
            <span
              className="text-[11px] font-semibold text-brand-blue bg-blue-50 rounded-full px-3 py-1 whitespace-nowrap"
              title={user?.email || ""}
            >
              {myRoleLabel}
            </span>
          )}
          {signedIn ? <NavLink href="/dashboard">Profile</NavLink> : <NavLink href="/sign-in">Sign in / Sign up</NavLink>}
          {signedIn ? (
            <Link
              href="/contact"
              className="inline-flex h-10 items-center justify-center rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-sm font-semibold px-5 hover:opacity-90 transition-opacity whitespace-nowrap"
              style={{ color: "#ffffff" }}
            >
              Book a demo
            </Link>
          ) : (
            <Link
              href="/sign-in?mode=signup"
              className="inline-flex h-10 items-center justify-center rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-sm font-semibold px-5 hover:opacity-90 transition-opacity whitespace-nowrap"
              style={{ color: "#ffffff" }}
            >
              Start Free Trial
            </Link>
          )}
          {signedIn && isSuper && (
            <Link
              href="/admin"
              className="inline-flex h-10 items-center justify-center rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-sm font-semibold px-5 hover:opacity-90 transition-opacity whitespace-nowrap"
              style={{ color: "#ffffff" }}
            >
              Super Admin
            </Link>
          )}
          {signedIn && (
            <button
              onClick={() => signOut(auth)}
              className="h-10 text-sm font-medium text-black bg-slate-200 hover:bg-slate-300 rounded-full px-4 transition-colors"
            >
              Sign out
            </button>
          )}
        </div>

        <button
          type="button"
          className="lg:hidden inline-flex items-center justify-center w-10 h-10 -mr-2 rounded-full hover:bg-slate-100 shrink-0"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          )}
        </button>
      </div>

      {mobileOpen && (
        <div className="lg:hidden border-t border-slate-100 bg-white px-6 py-4 max-h-[calc(100vh-4rem)] overflow-y-auto">
          {signedIn && (user?.email || myRoleLabel) && (
            <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-slate-100">
              <p className="text-xs text-slate-500 truncate" title={user?.email || ""}>{user?.email}</p>
              {myRoleLabel && (
                <span className="shrink-0 text-[11px] font-semibold text-brand-blue bg-blue-50 rounded-full px-3 py-1 whitespace-nowrap">
                  {myRoleLabel}
                </span>
              )}
            </div>
          )}

          <nav className="flex flex-col mb-3">
            {links.map((l) => (
              <Link key={l.href} href={l.href} onClick={closeMenu} className="py-2.5 text-sm font-medium text-ink border-b border-slate-50 last:border-0">
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="flex flex-col gap-2.5">
            {signedIn ? (
              <>
                <Link href="/dashboard" onClick={closeMenu} className="py-1 text-sm font-medium text-ink">Profile</Link>
                {isSuper && <Link href="/admin" onClick={closeMenu} className="py-1 text-sm font-medium text-ink">Super Admin</Link>}
                <Link
                  href="/contact"
                  onClick={closeMenu}
                  className="h-10 inline-flex items-center justify-center rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-sm font-semibold"
                  style={{ color: "#ffffff" }}
                >
                  Book a demo
                </Link>
                <button
                  onClick={() => { closeMenu(); signOut(auth); }}
                  className="h-10 text-sm font-medium text-black bg-slate-200 hover:bg-slate-300 rounded-full transition-colors"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link href="/sign-in" onClick={closeMenu} className="py-1 text-sm font-medium text-ink">Sign in / Sign up</Link>
                <Link
                  href="/sign-in?mode=signup"
                  onClick={closeMenu}
                  className="h-10 inline-flex items-center justify-center rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-sm font-semibold"
                  style={{ color: "#ffffff" }}
                >
                  Start Free Trial
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
