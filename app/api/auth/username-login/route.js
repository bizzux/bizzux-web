import { NextResponse } from "next/server";
import { usernameLogin } from "@/lib/usernameAuth";
import { logAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  let body = {};
  try { body = await req.json(); } catch {}
  try {
    const r = await usernameLogin({ username: body.username, password: body.password, ip });
    return NextResponse.json({ ok: true, token: r.token, mustChangePassword: r.mustChangePassword });
  } catch (e) {
    await logAuditEvent({
      action: "auth.username_login_failed", actor: { uid: null, email: null },
      targetType: "username", targetId: String(body.username || "").slice(0, 40).toLowerCase(),
      details: { ip, reason: e.message },
    });
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
