"use client";

import Link from "next/link";
import Image from "next/image";
import { useMe } from "@/lib/useMe";

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

  return (
    <header className="border-b border-slate-100 sticky top-0 bg-white/90 backdrop-blur z-50">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center gap-8">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          {/* The source PNG has a lot of transparent headroom above the
              wordmark for the small cloud+arrow accent, so its own visual
              center sits well below the true center of its h-9 box — nudge
              it up so the "bizzux" text lines up with the nav tabs' text
              instead of the box's geometric center. */}
          <Image src="/logo-transparent.png" alt="Bizzux" width={132} height={54} priority className="h-9 w-auto -translate-y-1.5" />
        </Link>
        <nav className="hidden xl:flex items-center gap-6">
          {links.map((l) => (
            <NavLink key={l.href} href={l.href}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex-1" />
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:block">
            {signedIn ? (
              <NavLink href="/dashboard">Profile</NavLink>
            ) : (
              <NavLink href="/sign-in">Sign in / Sign up</NavLink>
            )}
          </div>
          {signedIn ? (
            <Link
              href="/contact"
              className="hidden sm:inline-flex h-10 items-center justify-center rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-sm font-semibold px-5 hover:opacity-90 transition-opacity whitespace-nowrap"
              style={{ color: "#ffffff" }}
            >
              Book a demo
            </Link>
          ) : (
            <Link
              href="/sign-in?mode=signup"
              className="hidden sm:inline-flex h-10 items-center justify-center rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-sm font-semibold px-5 hover:opacity-90 transition-opacity whitespace-nowrap"
              style={{ color: "#ffffff" }}
            >
              Start Free Trial
            </Link>
          )}
          {signedIn && isSuper && (
            <Link
              href="/admin"
              className="hidden sm:inline-flex h-10 items-center justify-center rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-sm font-semibold px-5 hover:opacity-90 transition-opacity whitespace-nowrap"
              style={{ color: "#ffffff" }}
            >
              Super Admin
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
