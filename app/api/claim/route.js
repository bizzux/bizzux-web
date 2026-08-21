import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called right after a successful sign-in/sign-up. Creates the customer's
// record on their very first login, using whatever trial length is
// currently configured. Does nothing on later logins (idempotent).
export async function POST(req) {
  try {
    const c = await requireUser(req);
    const ref = adminDb().doc("customers/" + c.uid);
    const existing = await ref.get();
    if (existing.exists) {
      return NextResponse.json({ ok: true, created: false });
    }

    let body = {};
    try { body = await req.json(); } catch { /* no body sent (e.g. Google sign-in) */ }
    const fullName = typeof body.fullName === "string" ? body.fullName.trim().slice(0, 120) : "";
    const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 20) : "";

    const settingsSnap = await adminDb().doc("portalSettings/config").get();
    const settingsData = settingsSnap.exists ? settingsSnap.data() : {};
    const trialDays = Number(settingsData.trialDays ?? 14) || 14;
    // Stamped onto the account at signup, not read live on every later
    // visit — so switching the global setting never changes what an
    // already-created account is waiting on. Google sign-ins (no phone
    // collected) always land on "email", which they already satisfy since
    // Google guarantees a verified address; only email/password signups
    // with a phone on file can be routed to mobile OTP.
    const verificationMethod = settingsData.verificationMethod === "mobile" && phone ? "mobile" : "email";

    const now = Timestamp.now();
    const trialEndDate = Timestamp.fromMillis(now.toMillis() + trialDays * 24 * 60 * 60 * 1000);

    await ref.set({
      email: c.email,
      fullName: fullName || null,
      phone: phone || null,
      createdAt: FieldValue.serverTimestamp(),
      trialStartDate: now,
      trialEndDate,
      status: "trial",
      planId: null,
      planName: null,
      onboarded: false,
      verificationMethod,
      ...(verificationMethod === "mobile" ? { phoneVerified: false } : {}),
    });

    return NextResponse.json({ ok: true, created: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
