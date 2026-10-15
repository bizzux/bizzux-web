import { NextResponse } from "next/server";
import { requireUser, resolveAccount, adminDb } from "@/lib/firebaseAdmin";
import { setUsernamePassword } from "@/lib/usernameAuth";
import { validatePassword } from "@/lib/passwordPolicy";
import { logAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Self-service password change for username logins (no Firebase password
// provider exists for them, so the client SDK's updatePassword can't be
// used). The caller must already hold a valid session. The session is
// revoked afterwards; the client signs in again with the new password.
export async function POST(req) {
  try {
    const c = await requireUser(req);
    const { password } = await req.json();
    const acct = await resolveAccount(c.uid);
    const problem = await validatePassword(acct.accountId, String(password || ""));
    if (problem) throw { status: 400, message: problem };
    await setUsernamePassword(c.uid, String(password), false);
    if (acct.membership) await adminDb().doc("memberships/" + c.uid).set({ mustChangePassword: false }, { merge: true });
    else await adminDb().doc("customers/" + c.uid).set({ mustChangePassword: false }, { merge: true });
    await logAuditEvent({ action: "auth.username_password_changed", actor: c, targetType: "user", targetId: c.uid });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
