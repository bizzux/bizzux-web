import Link from "next/link";

// Nav for the SaaS app section's own public-ish pages (/apps, /sign-in).
// Renamed to AppNav (not Nav) so it doesn't collide with bizzux.com's own
// marketing components/Nav.tsx. Pricing and Sign in were dropped from here
// — bizzux.com's main Nav now carries All apps, Sign in and Start free
// trial too, so this bar doesn't need to repeat them.
export default function AppNav() {
  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/"><img src="/app-logo.png" alt="Bizzux" className="logo-img" /></Link>
        <div className="nav-links">
          <Link href="/apps">All apps</Link>
          <Link href="/sign-in?mode=signup" className="btn-primary" style={{ padding: "9px 20px", fontSize: 13.5 }}>
            Start free trial
          </Link>
        </div>
      </div>
    </nav>
  );
}
