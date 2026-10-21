import { NextResponse } from "next/server";
import { createHmac, randomUUID } from "crypto";
import { requireAccountAdmin } from "@/lib/firebaseAdmin";
import { logAuditEvent } from "@/lib/audit";
import { safeAdminTarget } from "@/lib/adminHost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Opens the Admin Center for a signed-in COMPANY admin. The admin host is a different origin, so it cannot see this host's Firebase session
// (and we deliberately do not share a cookie across *.bizzux.com). Instead this mints a short-lived, audience-bound ("admin"), single-use,
// HMAC-signed token that /api/sso on the admin host exchanges for a Firebase custom token of the SAME uid. The token goes in the URL fragment so it
// never reaches server logs or Referer headers. Platform Admins are not special here: only the company-admin check applies.
const ADMIN_ORIGIN = () => process.env.ADMIN_CENTER_ORIGIN || "https://admin.bizzux.com";

export async function GET(req) {
  try {
    const acct = await requireAccountAdmin(req); // 401 when signed out, 403 when not a company Owner/Admin
    const secret = process.env.APP_SSO_SECRET;
    if (!secret) throw { status: 500, message: "SSO is not configured" };
    const to = safeAdminTarget(new URL(req.url).searchParams.get("to"));
    const payload = { v: 2, aud: "admin", jti: randomUUID(), uid: acct.uid, iat: Date.now() };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const key = createHmac("sha256", secret).update("bizzux-sso-v2|admin").digest("hex");
    const sig = createHmac("sha256", key).update(payloadB64).digest("hex");
    await logAuditEvent({ action: "admin_center.handoff", actor: acct, targetType: "organization", targetId: acct.accountId, details: { to } }).catch(() => {});
    return NextResponse.json({ url: `${ADMIN_ORIGIN()}/sso#token=${payloadB64}.${sig}&to=${encodeURIComponent(to)}` });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
