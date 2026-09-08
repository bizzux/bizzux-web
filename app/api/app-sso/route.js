import { NextResponse } from "next/server";
import { requireAccountWithAppsAccess } from "@/lib/firebaseAdmin";
import { createHmac } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Generic SSO mint route for the split-out apps (Notes, Files, ...) that
// share THIS project's Firebase Auth/Firestore — unlike /api/shop-sso,
// which bridges to bizzux-shop's separate Firebase project and has to
// look up/create a user and remap roles on the other end. Here the target
// app already has the same uid, so the payload just carries it directly and
// the target's own /api/sso can mint a custom token for it immediately.
const TARGET_APPS = {
  notes: process.env.NOTES_APP_URL || "https://bizzux-notes.vercel.app",
  files: process.env.FILES_APP_URL || "https://bizzux-files.vercel.app",
};

export async function GET(req) {
  try {
    const appKey = new URL(req.url).searchParams.get("app");
    const targetUrl = TARGET_APPS[appKey];
    if (!targetUrl) throw { status: 400, message: "Unknown app" };

    // Enforces auth + the same trial/plan gate as the app itself (defense
    // in depth), and gives us the resolved accountId/email.
    const acct = await requireAccountWithAppsAccess(req);

    const secret = process.env.APP_SSO_SECRET;
    if (!secret) throw { status: 500, message: "SSO is not configured" };

    const payload = { uid: acct.uid, email: acct.email, iat: Date.now() };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", secret).update(payloadB64).digest("hex");
    const token = payloadB64 + "." + sig;

    return NextResponse.json({ url: `${targetUrl}/sso?token=${token}` });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
