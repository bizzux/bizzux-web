// Shared CORS headers for the SSO mint routes (app-sso, shop-sso) that need
// to be called cross-origin from the split-out Bizzux apps — each of
// bizzux-notes/files/projects (and Shop) runs on its own Vercel domain, and
// the new in-app "switch apps" launcher calls these endpoints directly from
// there instead of routing through bizzux.com first. Auth here is a Bearer
// token, not a cookie, so a wildcard origin carries no ambient-credential
// risk (no session can be silently replayed cross-site the way it could
// with cookie-based auth).
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
