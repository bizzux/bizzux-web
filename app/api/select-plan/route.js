import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lets a signed-in customer record which plan they picked. No payment is
// collected here — it just tags their record so Super Admin can see intent
// and follow up.
export async function POST(req) {
  try {
    const c = await requireUser(req);
    const { planId } = await req.json();
    if (!planId) throw { status: 400, message: "Plan id required" };

    const planSnap = await adminDb().doc("plans/" + planId).get();
    if (!planSnap.exists) throw { status: 404, message: "Plan not found" };

    await adminDb().doc("customers/" + c.uid).set(
      { planId, planName: planSnap.data().name || null },
      { merge: true }
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
