import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Verifies the code the user typed against MSG91, then marks the account
// phoneVerified so the dashboard gate (app/(saas)/dashboard/page.js) lets
// them through. Companion to /api/send-mobile-otp.
export async function POST(req) {
  try {
    const c = await requireUser(req);

    const authKey = process.env.MSG91_AUTH_KEY;
    if (!authKey) {
      throw { status: 500, message: "Mobile verification isn't configured yet. Contact support." };
    }

    let body = {};
    try { body = await req.json(); } catch {}
    const otp = typeof body.otp === "string" ? body.otp.trim() : "";
    if (!otp) throw { status: 400, message: "Please enter the code we sent you" };

    const ref = adminDb().doc("customers/" + c.uid);
    const snap = await ref.get();
    if (!snap.exists) throw { status: 404, message: "No Bizzux account found for this sign-in" };
    const data = snap.data();
    if (data.phoneVerified) {
      return NextResponse.json({ ok: true, alreadyVerified: true });
    }
    const phone = data.phone || "";
    if (!phone) throw { status: 400, message: "No phone number on file for this account" };

    const mobile = phone.replace(/^\+/, "");
    const url = `https://control.msg91.com/api/v5/otp/verify?mobile=${encodeURIComponent(mobile)}&otp=${encodeURIComponent(otp)}`;
    const r = await fetch(url, { headers: { authkey: authKey } });
    const d = await r.json().catch(() => ({}));
    if (d.type !== "success") {
      throw { status: 400, message: d.message || "That code didn't match. Please check it and try again." };
    }

    await ref.set({ phoneVerified: true }, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
