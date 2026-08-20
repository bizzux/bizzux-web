import Footer from "@/components/Footer";

// Route group (saas): dashboard, team, profile, sign-in, accept-invite,
// apps. Wraps page content in the scoped .bzx-app app shell (app/bzx-app.css,
// ported from apps.bizzux.com's own globals.css) so the merged pages keep
// their original look without leaking any of that styling onto the
// marketing site. Footer is rendered here, outside .bzx-app, so it keeps
// the same Tailwind styling as the marketing site's Footer and appears on
// every page (marketing and signed-in app alike) for a uniform bottom bar
// across the whole app. Route groups don't affect the URL, so /dashboard,
// /team, /profile, /sign-in, /accept-invite and /apps all keep their exact
// paths.
//
// min-h-screen + flex-col on the outer wrapper, flex-1 on .bzx-app, is the
// standard "sticky footer" pattern (the same one app/(marketing)/layout.tsx
// already uses) — it pins the Footer to the bottom of the viewport on short
// pages like Team/Profile instead of leaving it stranded below a big empty
// gap, while still letting it sit at the true end of the page (pushed down
// naturally) once content is taller than the screen.
export default function SaasLayout({ children }) {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="bzx-app flex-1">{children}</div>
      <Footer />
    </div>
  );
}
