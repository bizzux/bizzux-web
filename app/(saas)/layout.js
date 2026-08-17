// Route group (saas) — dashboard, team, profile, sign-in, accept-invite,
// apps. Deliberately does NOT render bizzux.com's marketing Nav/Footer
// (those live in app/(marketing)/layout.tsx); instead it wraps everything
// in the scoped .bzx-app app shell (app/bzx-app.css, ported from
// apps.bizzux.com's own globals.css) so the merged pages keep their
// original look without leaking any of that styling onto the marketing
// site. Route groups don't affect the URL, so /dashboard, /team, /profile,
// /sign-in, /accept-invite and /apps all keep their exact paths.
export default function SaasLayout({ children }) {
  return <div className="bzx-app">{children}</div>;
}
