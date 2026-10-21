import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Receiver for the Admin Center hand-off (see /api/admin-center/handoff). Only v2 tokens whose audience is "admin" are accepted: older or
// shared-secret tokens are refused outright, tokens are valid for 60 seconds, and each jti works once. The result is a Firebase custom token for
// the SAME uid; no user is created or looked up by email here.
const APP_KEY = "admin";
const TOKEN_TTL_MS = 60_000;

const safeEqualHex = (a, b) => {
  const x = Buffer.from(a || "", "hex"), y = Buffer.from(b || "", "hex");
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

export async function POST(req) {
  try {
    const { token } = await req.json();
    if (typeof token !== "string" || !token.includes(".")) throw { status: 400, message: "Invalid sign-in link" };
    const [payloadB64, sig] = token.split(".");
    let payload;
    try { payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")); } catch { throw { status: 400, message: "Invalid sign-in link" }; }
    if (payload?.v !== 2) throw { status: 401, message: "This sign-in link is outdated. Open the Admin Center from bizzux.com again." };
    const secret = process.env.APP_SSO_SECRET;
    if (!secret) throw { status: 500, message: "SSO is not configured" };
    const key = createHmac("sha256", secret).update("bizzux-sso-v2|" + APP_KEY).digest("hex");
    if (!safeEqualHex(sig, createHmac("sha256", key).update(payloadB64).digest("hex"))) throw { status: 401, message: "Invalid or tampered sign-in link" };
    if (payload.aud !== APP_KEY) throw { status: 401, message: "This sign-in link was issued for a different app." };
    if (!payload.uid || !payload.iat || Date.now() - payload.iat > TOKEN_TTL_MS || payload.iat > Date.now() + 5_000) throw { status: 401, message: "This sign-in link has expired. Open the Admin Center from bizzux.com again." };
    if (typeof payload.jti !== "string" || !payload.jti || payload.jti.length > 64) throw { status: 401, message: "Invalid sign-in link" };
    try {
      await adminDb().collection("ssoUsed").doc(payload.jti).create({ app: APP_KEY, uid: payload.uid, usedAt: new Date(), expiresAt: new Date(Date.now() + 10 * 60_000) });
    } catch (e) {
      if (e && (e.code === 6 || /already exists/i.test(e.message || ""))) throw { status: 401, message: "This sign-in link was already used. Open the Admin Center from bizzux.com again." };
      throw e;
    }
    return NextResponse.json({ ok: true, customToken: await adminAuth().createCustomToken(payload.uid) });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Sign-in failed" }, { status: e.status || 500 });
  }
}
