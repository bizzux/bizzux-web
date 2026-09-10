// Shared HMAC sign/verify for the two token kinds that flow BETWEEN
// bizzux-web and bizzux-shop over plain HTTP (they're separate Firebase
// projects, so neither can verify the other's ID tokens directly) — the
// existing SSO hand-off (web -> shop, see app/api/shop-sso/route.js) and
// this reset-authorization flow (shop -> web -> shop, see
// app/api/shop-reset-otp/route.js). Both apps hold the same
// SHOP_SSO_SECRET; reusing it here rather than adding a second shared
// secret keeps there being exactly one thing to rotate if it ever leaks.
import { createHmac, timingSafeEqual } from "crypto";

export function signShopToken(payload) {
  const secret = process.env.SHOP_SSO_SECRET;
  if (!secret) throw { status: 500, message: "SHOP_SSO_SECRET is not configured" };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payloadB64).digest("hex");
  return payloadB64 + "." + sig;
}

// `maxAgeMs` lets each call site pick its own TTL — a request to send/verify
// an OTP is short-lived (proves "this Shop session asked, just now"), while
// the resulting reset-authorization token bizzux-shop redeems is deliberately
// even shorter (see app/api/shop-reset-otp/route.js).
export function verifyShopToken(token, maxAgeMs) {
  const secret = process.env.SHOP_SSO_SECRET;
  if (!secret) throw { status: 500, message: "SHOP_SSO_SECRET is not configured" };

  const [payloadB64, sig] = String(token || "").split(".");
  if (!payloadB64 || !sig) throw { status: 400, message: "Invalid token" };

  const expected = createHmac("sha256", secret).update(payloadB64).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw { status: 403, message: "Invalid or tampered token" };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    throw { status: 400, message: "Invalid token" };
  }
  if (!payload.orgId || !payload.iat) throw { status: 400, message: "Invalid token" };
  if (Date.now() - payload.iat > maxAgeMs) {
    throw { status: 410, message: "This request has expired — please try again." };
  }
  return payload;
}
