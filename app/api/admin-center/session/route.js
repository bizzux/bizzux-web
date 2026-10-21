import { NextResponse } from "next/server";
import { consumeHandle, readCookie, HANDLE_COOKIE } from "@/lib/shell/handoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called by /sso/complete on the Admin Center host. Burns the handle from the host-only cookie and returns a Firebase custom token for the SAME person
// plus the (server-validated) context. The cookie is cleared either way.
export async function POST(req) {
  const clear = `${HANDLE_COOKIE}=; Path=/api/admin-center; HttpOnly; SameSite=Strict; Max-Age=0`;
  try {
    const out = await consumeHandle(readCookie(req, HANDLE_COOKIE));
    const res = NextResponse.json({ ok: true, ...out }, { headers: { "Cache-Control": "no-store" } });
    res.headers.append("Set-Cookie", clear);
    return res;
  } catch (e) {
    const res = NextResponse.json({ error: e.message || "Sign-in failed" }, { status: e.status || 500, headers: { "Cache-Control": "no-store" } });
    res.headers.append("Set-Cookie", clear);
    return res;
  }
}
