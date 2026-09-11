import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebaseAdmin";
import { sendEmailCode } from "@/lib/twoFactor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Used both when SETTING UP email-based 2FA and when actually signing in
// with it already enabled — same code either way, just triggered from a
// different screen (see app/(saas)/verify-2fa/page.js and the Profile 2FA
// settings section).
export async function POST(req) {
  try {
    const c = await requireUser(req);
    await sendEmailCode(c.uid, c.email);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
