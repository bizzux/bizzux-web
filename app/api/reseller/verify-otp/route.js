import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Confirms the code MSG91 sent via /api/reseller/send-otp. Has no Firestore
// write of its own — the Partners page keeps "Submit application" disabled
// client-side until this returns ok, and the actual reseller record + code
// are still only created by /api/reseller/apply, which a Super Admin
// manually reviews and approves before the code can be used either way (see
// that route's own comment) — so there's no separate verified-state that
// needs persisting here, just a gate on the form itself.
export async function POST(req) {
  try {
    await requireUser(req);

    const authKey = process.env.MSG91_AUTH_KEY;
    if (!authKey) {
      throw { status: 500, message: "Mobile verification isn't configured yet. Contact support." };
    }

    const body = await req.json().catch(() => ({}));
    const phone = String(body.phone || "").trim();
    const otp = String(body.otp || "").trim();
    if (!phone) throw { status: 400, message: "Missing phone number" };
    if (!otp) throw { status: 400, message: "Please enter the code we sent you" };

    const mobile = phone.replace(/^\+/, "");
    const url = `https://control.msg91.com/api/v5/otp/verify?mobile=${encodeURIComponent(mobile)}&otp=${encodeURIComponent(otp)}`;
    const r = await fetch(url, { headers: { authkey: authKey } });
    const d = await r.json().catch(() => ({}));
    if (d.type !== "success") {
      throw { status: 400, message: d.message || "That code didn't match. Please check it and try again." };
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
