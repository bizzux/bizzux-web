import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sends a one-time password to the signed-in user's phone via MSG91, for
// accounts where the Super Admin has selected "Mobile" as the verification
// method (see app/api/admin/settings/route.js and the Trial settings tab of
// the Super Admin panel). MSG91 requires DLT registration in India before
// it will actually deliver an SMS — until MSG91_AUTH_KEY and
// MSG91_TEMPLATE_ID are set, this fails closed with a clear error instead
// of silently doing nothing (same pattern as /api/send-verification-email
// for Resend).
export async function POST(req) {
  try {
    const c = await requireUser(req);

    const authKey = process.env.MSG91_AUTH_KEY;
    const templateId = process.env.MSG91_TEMPLATE_ID;
    if (!authKey || !templateId) {
      throw { status: 500, message: "Mobile verification isn't configured yet. Contact support." };
    }

    const ref = adminDb().doc("customers/" + c.uid);
    const snap = await ref.get();
    if (!snap.exists) throw { status: 404, message: "No Bizzux account found for this sign-in" };
    const data = snap.data();
    if (data.phoneVerified) {
      return NextResponse.json({ ok: true, alreadyVerified: true, phone: data.phone || "" });
    }

    // Optional: the "Change" link on the verify screen lets someone fix a
    // mistyped number before requesting a fresh code. Only allowed pre
    // -verification (the check above already returns early once verified).
    let body = {};
    try { body = await req.json(); } catch { /* no body sent — resend to the number on file */ }
    let phone = data.phone || "";
    const newPhone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (newPhone && newPhone !== phone) {
      phone = newPhone;
      await ref.set({ phone }, { merge: true });
    }
    if (!phone) throw { status: 400, message: "No phone number on file for this account" };

    // MSG91 wants the number without a leading "+".
    const mobile = phone.replace(/^\+/, "");
    const url = `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(templateId)}&mobile=${encodeURIComponent(mobile)}&otp_expiry=10`;
    const r = await fetch(url, { method: "POST", headers: { authkey: authKey } });
    const d = await r.json().catch(() => ({}));
    if (d.type === "error") throw new Error(d.message || "Could not send verification code");

    return NextResponse.json({ ok: true, phone });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
