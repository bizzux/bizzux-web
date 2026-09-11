import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { verifyEmailCode, verifyTotpCode, getTwoFactorSettings } from "@/lib/twoFactor";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One endpoint for both cases, since the actual code-checking logic is
// identical either way — only what happens on success differs:
//   - setup (body.setup + body.method): first time proving they can
//     produce a correct code. On success, this is what actually turns 2FA
//     on — promotes pendingTotpSecret -> totpSecret for TOTP, or just
//     flips enabled:true for email (there's no secret to store for email,
//     a fresh code is generated every time).
//   - login (no body.setup): checks against whichever method is already
//     enabled for this account. Doesn't change any stored state — the
//     client remembers "verified" for this session (see
//     app/(saas)/verify-2fa/page.js), matching how mustChangePassword's
//     gate already works.
export async function POST(req) {
  try {
    const c = await requireUser(req);
    const body = await req.json();
    const code = String(body.code || "").trim();
    if (!code) throw { status: 400, message: "Enter the code." };

    if (body.setup) {
      const method = body.method === "totp" ? "totp" : "email";
      if (method === "email") {
        const result = await verifyEmailCode(c.uid, code);
        if (!result.valid) throw { status: 400, message: result.error };
        await adminDb().doc("twoFactor/" + c.uid).set({
          enabled: true, method: "email", updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } else {
        const settings = await getTwoFactorSettings(c.uid);
        if (!settings.pendingTotpSecret) throw { status: 400, message: "Start setup again — no pending authenticator setup found." };
        if (!verifyTotpCode(settings.pendingTotpSecret, code)) {
          throw { status: 400, message: "That code doesn't match. Check your authenticator app and try again." };
        }
        await adminDb().doc("twoFactor/" + c.uid).set({
          enabled: true, method: "totp", totpSecret: settings.pendingTotpSecret,
          pendingTotpSecret: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return NextResponse.json({ ok: true });
    }

    // Login verification — check against whichever method is currently enabled.
    const settings = await getTwoFactorSettings(c.uid);
    if (!settings.enabled) return NextResponse.json({ ok: true }); // nothing to verify, shouldn't normally be reached
    if (settings.method === "totp") {
      if (!verifyTotpCode(settings.totpSecret, code)) throw { status: 400, message: "That code doesn't match. Check your authenticator app and try again." };
    } else {
      const result = await verifyEmailCode(c.uid, code);
      if (!result.valid) throw { status: 400, message: result.error };
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
