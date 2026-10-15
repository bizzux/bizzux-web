import { NextResponse } from "next/server";
import { consumeRecoveryCode, setUsernamePassword, normalizeUsername } from "@/lib/usernameAuth";
import { validatePassword } from "@/lib/passwordPolicy";
import { adminDb } from "@/lib/firebaseAdmin";
import { logAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Self-service password recovery for username users without an email:
// username + one single-use recovery code + new password. Rate limited and
// locked out like login; every failure is audited. The password policy is
// checked first so a weak password doesn't burn a code.
export async function POST(req) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  let body = {};
  try { body = await req.json(); } catch {}
  try {
    const password = String(body.password || "");
    const snap = await adminDb().collection("usernames").doc(normalizeUsername(body.username) || "_").get();
    // Unknown usernames fall through to consumeRecoveryCode, which fails generically.
    if (snap.exists) {
      const problem = await validatePassword(snap.data().organizationId, password);
      if (problem) throw { status: 400, message: problem };
    }
    const r = await consumeRecoveryCode({ username: body.username, code: body.code, ip });
    await setUsernamePassword(r.uid, password, false);
    await adminDb().doc("memberships/" + r.uid).set({ mustChangePassword: false }, { merge: true }).catch(() => {});
    await logAuditEvent({ action: "auth.username_recovered", actor: { uid: r.uid, email: null }, targetType: "user", targetId: r.uid, details: { orgId: r.organizationId, ip, remainingCodes: r.remaining } });
    return NextResponse.json({ ok: true, remainingCodes: r.remaining });
  } catch (e) {
    await logAuditEvent({ action: "auth.username_recovery_failed", actor: { uid: null, email: null }, targetType: "username", targetId: String(body.username || "").slice(0, 40).toLowerCase(), details: { ip, reason: e.message } });
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
