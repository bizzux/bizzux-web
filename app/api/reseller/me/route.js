import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Powers the Partners page's own dashboard (app/(marketing)/partners) —
// a signed-in visitor's view of their own application/earnings, not the
// Super Admin list (see app/api/admin/resellers/route.js for that).
export async function GET(req) {
  try {
    const c = await requireUser(req);
    const snap = await adminDb().doc("resellers/" + c.uid).get();
    if (!snap.exists) {
      return NextResponse.json({ registered: false });
    }
    const d = snap.data();
    return NextResponse.json({
      registered: true,
      status: d.status,
      referralCode: d.referralCode,
      fullName: d.fullName,
      phone: d.phone,
      businessName: d.businessName || null,
      payoutMethod: d.payoutMethod,
      totalReferrals: d.totalReferrals || 0,
      totalEarnings: d.totalEarnings || 0,
      pendingPayout: d.pendingPayout || 0,
      paidOut: d.paidOut || 0,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
