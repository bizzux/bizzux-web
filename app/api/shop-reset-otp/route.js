import { NextResponse } from "next/server";
import { Resend } from "resend";
import { adminDb } from "@/lib/firebaseAdmin";
import { signShopToken, verifyShopToken } from "@/lib/shopHmac";
import { resetOtpEmailHtml } from "@/lib/emailTemplates";
import { randomInt, randomUUID } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Backs Bizzux Shop's Danger Zone reset — a code sent to the REAL account
// owner's own registered email (customers/{orgId}.email), never to
// whoever is currently signed in to Shop, since the whole point is to
// require access a shared shop login doesn't grant (see the security
// discussion this was built from). bizzux-shop calls this over plain
// HTTP with an HMAC-signed request token (see lib/shopHmac.js) instead of
// a normal ID token, since the two apps are separate Firebase projects
// and neither can verify the other's tokens directly.
const REQUEST_TOKEN_TTL_MS = 60 * 1000; // the shop->web request itself
const OTP_TTL_MS = 10 * 60 * 1000;
// The resulting authToken carries no embedded TTL of its own — bizzux-shop's
// own reset route enforces a 5-minute freshness window on it when verifying
// (see that route's comments), matching what's documented here.

function maskEmail(email) {
  const [user, domain] = String(email || "").split("@");
  if (!user || !domain) return "your registered email";
  const visible = user.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(user.length - 1, 3))}@${domain}`;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { token, action } = body;
    const payload = verifyShopToken(token, REQUEST_TOKEN_TTL_MS);
    const orgId = payload.orgId;

    if (action === "send") {
      const custSnap = await adminDb().doc("customers/" + orgId).get();
      if (!custSnap.exists || !custSnap.data().email) {
        throw { status: 404, message: "No registered owner account found for this organization." };
      }
      const customer = custSnap.data();

      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) throw { status: 500, message: "Email delivery isn't configured yet. Contact support." };

      const code = String(randomInt(100000, 1000000)); // 6 digits, zero-padding never needed at this range
      await adminDb().doc("shopResetOtps/" + orgId).set({
        code,
        expiresAt: Timestamp.fromMillis(Date.now() + OTP_TTL_MS),
        createdAt: FieldValue.serverTimestamp(),
      });

      const resend = new Resend(apiKey);
      const from = process.env.RESEND_FROM_EMAIL || "Bizzux <verify@verify.bizzux.com>";
      const { error } = await resend.emails.send({
        from,
        to: customer.email,
        subject: "Your Bizzux Shop reset code",
        html: resetOtpEmailHtml({ code, organizationName: customer.organizationName || customer.companyName }),
      });
      if (error) throw new Error(error.message || "Could not send the reset code email");

      return NextResponse.json({ ok: true, emailHint: maskEmail(customer.email) });
    }

    if (action === "verify") {
      const code = String(body.code || "").trim();
      if (!code) throw { status: 400, message: "Enter the code from the email." };

      const otpRef = adminDb().doc("shopResetOtps/" + orgId);
      const otpSnap = await otpRef.get();
      if (!otpSnap.exists) throw { status: 400, message: "Request a new code — this one wasn't found or was already used." };
      const otp = otpSnap.data();
      if (otp.expiresAt.toMillis() < Date.now()) {
        await otpRef.delete();
        throw { status: 410, message: "That code has expired. Request a new one." };
      }
      if (otp.code !== code) throw { status: 400, message: "That code doesn't match. Check the email and try again." };

      // One-time: delete immediately on successful use so the same code
      // (or a captured request) can't be replayed.
      await otpRef.delete();

      // `nonce` lets bizzux-shop's own reset route enforce single-use on
      // this token (a Firestore create-if-absent check keyed by it) — the
      // HMAC signature alone only proves it was legitimately issued, not
      // that it hasn't already been redeemed once.
      const authToken = signShopToken({ orgId, iat: Date.now(), nonce: randomUUID() });
      return NextResponse.json({ ok: true, authToken });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
