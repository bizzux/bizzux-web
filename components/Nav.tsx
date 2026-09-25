"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useMe } from "@/lib/useMe";
import { roleLabel } from "@/lib/roleLabel";
import LiveClock from "@/components/LiveClock";
import AppLauncher from "@/components/AppLauncher";
import AccountSwitcher from "@/components/AccountSwitcher";

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
  { href: "/custom-solutions", label: "Build" },
  { href: "/pricing", label: "Pricing" },
  { href: "/resources", label: "Insights" },
];

// Everything about Bizzux-the-company lives under one "Company" menu (a
// grouped dropdown on desktop, an always-expanded section in the mobile
// menu) instead of separate top-level tabs.
const companyGroups = [
  {
    title: "Company",
    links: [
      { href: "/about", label: "About Us" },
      { href: "/leadership", label: "Leadership Team" },
      { href: "/careers", label: "Careers" },
      { href: "/contact", label: "Contact Us" },
    ],
  },
  { title: "Partners", links: [{ href: "/partners", label: "Partner with Us" }] },
  {
    title: "Customers",
    links: [
      { href: "/customers", label: "Our Customers" },
      { href: "/reviews", label: "Customer Reviews" },
      { href: "/events", label: "Events" },
    ],
  },
];

// Opens on hover (desktop pointer) and on click/tap/Enter;
// closes on mouse-leave, outside click, Escape, or any navigation.
function CompanyMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const active = companyGroups.some((g) => g.links.some((l) => l.href === pathname));
  return (
    <div ref={ref} className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        // Always opens (never toggles): a mouse click lands right after the
        // hover already opened it, and a toggle would snap it shut again.
        onClick={() => setOpen(true)}
        className="group relative inline-flex h-9 items-center gap-1 whitespace-nowrap text-sm font-medium"
        style={{ color: "#000000" }}
      >
        <span>Company</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span className={`pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-brand-teal transition-transform duration-200 ${open || active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"}`} />
      </button>
      {open && (
        // pt-3 is a hover bridge so the pointer can travel from the button
        // into the panel without crossing a gap that would close it.
        <div className="absolute left-1/2 -translate-x-1/2 top-full pt-3 z-50">
          <div className="grid grid-cols-3 w-[640px] rounded-2xl border border-slate-100 bg-white shadow-xl shadow-slate-900/10 overflow-hidden">
            {companyGroups.map((g, i) => (
              <div key={g.title} className={`p-6 ${i > 0 ? "border-l border-slate-100" : ""} ${i === 1 ? "bg-slate-50/70" : ""}`}>
                <div className="text-base font-bold text-ink mb-3">{g.title}</div>
                <ul className="space-y-1">
                  {g.links.map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        onClick={() => setOpen(false)}
                        className={`block rounded-lg px-2 py-1.5 -mx-2 text-sm transition-colors hover:bg-teal-50 hover:text-brand-tealDark ${pathname === l.href ? "text-brand-tealDark font-semibold" : "text-slate-700"}`}
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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
  // "Admin Center" sits right after "All apps" — visible only to whoever
  // can actually administer their own organization (Global Admin/Admin,
  // same gate /team itself uses), not every signed-in customer. Platform
  // Admins never see this row at all (see the `!isSuper &&` guard below),
  // so there's no overlap with their own Super Admin button.
  const navLinks = me?.isAccountAdmin
    ? [links[0], { href: "/team", label: "Admin Center" }, ...links.slice(1)]
    : links;
  // Same "who am I" wording used on Profile/Dashboard/Team's AccountTabs
  // badge (see lib/roleLabel.js) — repeated here so it's visible on every
  // page, not just those three, since Nav itself isn't in a shared layout.
  const myRoleLabel = isSuper ? "Platform " + (me?.platformRole === "OWNER" ? "Owner" : "Admin") : roleLabel(me);
  const [mobileOpen, setMobileOpen] = useState(false);
  // No dedicated "name" field comes back from /api/me — Firebase's own
  // displayName (set for Google sign-ins) is the best real name available,
  // shown in full (first + last), not just the first token; everyone else
  // falls back to the readable part of their email rather than showing
  // nothing.
  const greetingName = user?.displayName || user?.email?.split("@")[0];

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
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center gap-2 lg:gap-8">
        {signedIn && <AppLauncher user={user} isAccountAdmin={!!me?.isAccountAdmin} hasAccount={me?.hasAccount} />}
        <Link href="/" className="flex items-center gap-2 shrink-0" onClick={closeMenu}>
          {/* The source PNG has a lot of transparent headroom above the
              wordmark for the small cloud+arrow accent, so its own visual
              center sits well below the true center of its h-9 box — nudge
              it up so the "bizzux" text lines up with the nav tabs' text
              instead of the box's geometric center. */}
          <Image src="/logo-transparent.png" alt="Bizzux" width={132} height={54} priority className="h-11 w-auto -translate-y-2" />
        </Link>
        {/* Bizzux is the platform brand — this is which COMPANY's workspace
            the signed-in user is actually in (set via the "Getting Started"
            wizard, api/onboarding). Only rendered once it's known, so it
            never flashes empty before /api/me resolves, and never shows for
            a Platform Admin/Owner (they aren't inside any one company). */}
        {signedIn && !isSuper && me?.organizationName && (
          <span
            className="hidden sm:inline-flex items-center h-7 px-2.5 rounded-full text-[12px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 whitespace-nowrap max-w-[180px] truncate"
            title={me.organizationName}
          >
            {me.organizationName}
          </span>
        )}
        <nav className="hidden lg:flex items-center gap-6">
          {!isSuper &&
            navLinks.map((l) => (
              <NavLink key={l.href} href={l.href}>
                {l.label}
              </NavLink>
            ))}
          {!isSuper && <CompanyMenu />}
        </nav>
        <div className="flex-1" />
        <div className="hidden lg:flex items-center gap-3 shrink-0">
          {signedIn && <AccountSwitcher me={me} />}
          {signedIn && myRoleLabel && (
            <span
              className="text-[11px] font-semibold text-brand-blue bg-blue-50 rounded-full px-3 py-1 whitespace-nowrap"
              title={user?.email || ""}
            >
              {myRoleLabel}
            </span>
          )}
          {signedIn ? <NavLink href="/dashboard">Profile</NavLink> : <NavLink href="/sign-in">Sign in / Sign up</NavLink>}
          {/* "Book a demo" / "Start Free Trial" are customer-acquisition
              CTAs — hidden for a signed-in Platform Admin/Owner, who's
              internal staff running the company, not a prospect. */}
          {!isSuper &&
            (signedIn ? (
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
            ))}
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

      {signedIn && (
        <div className="border-t border-slate-50 bg-slate-50/60 px-6 py-1.5">
          <div className="max-w-7xl mx-auto">
            <LiveClock name={greetingName} photoUrl={user?.photoURL} />
          </div>
        </div>
      )}

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
          {signedIn && me?.dualContext && (
            <div className="pb-3 mb-3 border-b border-slate-100">
              <AccountSwitcher me={me} />
            </div>
          )}

          <nav className="flex flex-col mb-3">
            {!isSuper &&
              navLinks.map((l) => (
                <Link key={l.href} href={l.href} onClick={closeMenu} className="py-2.5 text-sm font-medium text-ink border-b border-slate-50 last:border-0">
                  {l.label}
                </Link>
              ))}
            {!isSuper &&
              companyGroups.map((g) => (
                <div key={g.title} className="pt-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 pb-1">{g.title}</div>
                  {g.links.map((l) => (
                    <Link key={l.href} href={l.href} onClick={closeMenu} className="block py-2 pl-3 text-sm font-medium text-ink border-l-2 border-slate-100 hover:border-brand-teal">
                      {l.label}
                    </Link>
                  ))}
                </div>
              ))}
          </nav>

          <div className="flex flex-col gap-2.5">
            {signedIn ? (
              <>
                <Link href="/dashboard" onClick={closeMenu} className="py-1 text-sm font-medium text-ink">Profile</Link>
                {isSuper && <Link href="/admin" onClick={closeMenu} className="py-1 text-sm font-medium text-ink">Super Admin</Link>}
                {!isSuper && (
                  <Link
                    href="/contact"
                    onClick={closeMenu}
                    className="h-10 inline-flex items-center justify-center rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-sm font-semibold"
                    style={{ color: "#ffffff" }}
                  >
                    Book a demo
                  </Link>
                )}
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
