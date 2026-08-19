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
export default function SaasLayout({ children }) {
  return (
    <>
      <div className="bzx-app">{children}</div>
      <Footer />
    </>
  );
}
