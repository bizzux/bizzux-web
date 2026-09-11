// SERVER ONLY — shared 2FA helpers. Deliberately keyed on the Firebase
// uid alone (twoFactor/{uid}), not nested under customers/{uid} or
// memberships/{uid} — this is what lets the exact same setup/verify flow
// cover an organization owner, a team member, AND a Platform Admin/Owner
// with one implementation, since all three are just "a signed-in uid" as
// far as this is concerned.
//
// Email OTP reuses the pattern already proven out for Bizzux Shop's
// Danger Zone reset (app/api/shop-reset-otp/route.js) — a random 6-digit
// code, stored with a short expiry, emailed via Resend, single-use.
// TOTP (authenticator app codes) uses the free, universal RFC 6238
// standard via the `otpauth` package — works with Google Authenticator,
// Authy, Microsoft Authenticator, etc., no per-use cost, no SMS gateway.
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { randomInt } from "crypto";
import { Resend } from "resend";
import { adminDb } from "@/lib/firebaseAdmin";
import { twoFactorCodeEmailHtml } from "@/lib/emailTemplates";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

const EMAIL_OTP_TTL_MS = 10 * 60 * 1000;

export async function getTwoFactorSettings(uid) {
  const snap = await adminDb().doc("twoFactor/" + uid).get();
  return snap.exists ? snap.data() : { enabled: false, method: null };
}

export async function sendEmailCode(uid, email) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw { status: 500, message: "Email delivery isn't configured yet. Contact support." };

  const code = String(randomInt(100000, 1000000));
  await adminDb().doc("twoFactorEmailOtps/" + uid).set({
    code, expiresAt: Timestamp.fromMillis(Date.now() + EMAIL_OTP_TTL_MS), createdAt: FieldValue.serverTimestamp(),
  });

  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL || "Bizzux <verify@verify.bizzux.com>";
  const { error } = await resend.emails.send({
    from, to: email, subject: "Your Bizzux sign-in code", html: twoFactorCodeEmailHtml({ code }),
  });
  if (error) throw new Error(error.message || "Could not send the verification code email");
}

export async function verifyEmailCode(uid, code) {
  const ref = adminDb().doc("twoFactorEmailOtps/" + uid);
  const snap = await ref.get();
  if (!snap.exists) return { valid: false, error: "Request a new code — this one wasn't found or was already used." };
  const otp = snap.data();
  if (otp.expiresAt.toMillis() < Date.now()) {
    await ref.delete();
    return { valid: false, error: "That code has expired. Request a new one." };
  }
  if (otp.code !== String(code || "").trim()) return { valid: false, error: "That code doesn't match. Check the email and try again." };
  await ref.delete(); // single-use
  return { valid: true };
}

// Generates a fresh TOTP secret + the otpauth:// URI's QR code as a data
// URL the client can render directly in an <img>. Not enabled yet — the
// caller stores this as `pendingTotpSecret` until confirmed with one
// correct code (see verifyTotpCode), so a typo'd/misscanned setup can
// never lock someone out of an account they just tried to secure.
export async function generateTotpSetup(email) {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: "Bizzux", label: email, algorithm: "SHA1", digits: 6, period: 30, secret,
  });
  const otpauthUrl = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 240, margin: 1 });
  return { secret: secret.base32, qrDataUrl };
}

export function verifyTotpCode(base32Secret, code) {
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(base32Secret),
  });
  // window: 1 tolerates the code from just before/after now, for clock
  // drift between the phone and our server — standard TOTP practice.
  const delta = totp.validate({ token: String(code || "").trim(), window: 1 });
  return delta !== null;
}
