import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { usernameLogin, normalizeUsername, setUsernamePassword, generateRecoveryCodes, hasRecoveryCodes, USERNAME_RE } from "@/lib/usernameAuth";
import { validatePassword } from "@/lib/passwordPolicy";
import { logAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, for apps that host their own sign-in box (Attendance). First sign-in with an admin-issued temporary password: { username, password, newPassword }.
// It re-checks the CURRENT password with the same lock-out / throttle / expiry rules as a normal sign-in, applies the company password policy, stores the
// new one, issues the recovery codes the first time (shown once), and returns a fresh custom token. A wrong current password changes nothing.
export async function POST(req) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  try {
    const b = await req.json().catch(() => ({}));
    await usernameLogin({ username: b.username, password: b.password, ip });
    const username = normalizeUsername(b.username);
    if (!USERNAME_RE.test(username)) throw { status: 401, message: "Incorrect username or password" };
    const doc = await adminDb().doc("usernames/" + username).get();
    const { uid, organizationId } = doc.data();
    const next = String(b.newPassword || "");
    if (next === String(b.password || "")) throw { status: 400, message: "Choose a different password from the temporary one." };
    const problem = await validatePassword(organizationId, next);
    if (problem) throw { status: 400, message: problem };
    await setUsernamePassword(uid, next, false);
    await adminDb().doc("memberships/" + uid).set({ mustChangePassword: false }, { merge: true });
    await logAuditEvent({ action: "auth.username_password_changed", actor: { uid, email: null }, targetType: "user", targetId: uid, details: { via: "set-password" } });
    const recoveryCodes = (await hasRecoveryCodes(uid)) ? null : await generateRecoveryCodes(uid);
    const token = await adminAuth().createCustomToken(uid, { organizationId, auth: "username" });
    return NextResponse.json({ ok: true, token, recoveryCodes });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
