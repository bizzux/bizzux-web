import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sends an MSG91 one-time code to the phone number entered on the Partner
// application form (app/(marketing)/partners) — deliberately separate from
// /api/send-mobile-otp, which verifies the phone already on a customer's
// account (customers/{uid}.phone) and stamps that account's phoneVerified
// flag. A Partner applicant may want their commission payouts going to a
// different number than the one on their Bizzux account, so this is
// stateless: it just asks MSG91 to text whatever phone the client sends,
// with no Firestore read/write of its own. Companion to
// /api/reseller/verify-otp.
export async function POST(req) {
  try {
    await requireUser(req);

    const authKey = process.env.MSG91_AUTH_KEY;
    const templateId = process.env.MSG91_TEMPLATE_ID;
    if (!authKey || !templateId) {
      throw { status: 500, message: "Mobile verification isn't configured yet. Contact support." };
    }

    const body = await req.json().catch(() => ({}));
    const phone = String(body.phone || "").trim();
    if (!phone) throw { status: 400, message: "Enter a phone number first" };
    const digits = phone.replace(/[^\d]/g, "");
    if (digits.length < 8) throw { status: 400, message: "Enter a valid phone number" };

    // MSG91 wants the number without a leading "+".
    const mobile = phone.replace(/^\+/, "");
    const url = `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(templateId)}&mobile=${encodeURIComponent(mobile)}&otp_expiry=10`;
    const r = await fetch(url, { method: "POST", headers: { authkey: authKey } });
    const d = await r.json().catch(() => ({}));
    if (d.type === "error") throw new Error(d.message || "Could not send verification code");

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
