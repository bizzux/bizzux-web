import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { generateTotpSetup } from "@/lib/twoFactor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Generates a fresh secret and its QR code, stored as `pendingTotpSecret`
// — NOT active yet. It only becomes the real secret once /api/2fa/verify
// confirms the person actually scanned it and can produce a correct code,
// so a botched scan can never lock someone out of 2FA setup.
export async function POST(req) {
  try {
    const c = await requireUser(req);
    const { secret, qrDataUrl } = await generateTotpSetup(c.email);
    await adminDb().doc("twoFactor/" + c.uid).set({ pendingTotpSecret: secret }, { merge: true });
    return NextResponse.json({ ok: true, qrDataUrl, secret });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
