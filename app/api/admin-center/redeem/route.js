import { NextResponse } from "next/server";
import { redeemCode, HANDLE_COOKIE, HANDLE_TTL_MS } from "@/lib/shell/handoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Receives the one-time hand-off code as a FORM POST (so it is never in a URL) from the Bizzux app that requested it, burns it, and starts the
// sign-in on this host: a short-lived, HttpOnly, SameSite=Strict, host-only cookie carrying an opaque handle, then a redirect to /sso/complete.
// A failure redirects to the same page with a generic error flag; no detail and no token ever appears in the address.
export async function POST(req) {
  const go = (path, cookie) => {
    const res = new NextResponse(null, { status: 303, headers: { Location: new URL(path, req.url).toString(), "Cache-Control": "no-store" } });
    if (cookie) res.headers.append("Set-Cookie", cookie);
    return res;
  };
  try {
    const form = await req.formData();
    const handle = await redeemCode(String(form.get("code") || ""), req.headers.get("origin") || "");
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return go("/sso/complete", `${HANDLE_COOKIE}=${handle}; Path=/api/admin-center; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(HANDLE_TTL_MS / 1000)}${secure}`);
  } catch {
    return go("/sso/complete?error=1");
  }
}
