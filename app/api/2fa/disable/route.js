import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const c = await requireUser(req);
    await adminDb().doc("twoFactor/" + c.uid).set(
      { enabled: false, method: null, totpSecret: null, pendingTotpSecret: null },
      { merge: true }
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
