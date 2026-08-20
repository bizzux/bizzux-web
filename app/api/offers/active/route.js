import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUBLIC on purpose, unlike /api/offers/validate (which requires sign-in to
// avoid being a code-guessing oracle). This one doesn't take a guess at
// all — it just lists codes that are already meant to be advertised, so the
// pricing page can promote them to visitors before they even sign in (see
// app/(marketing)/pricing/PricingPlans.tsx). Only the fields needed to show
// a friendly "use CODE for X% off <Plan>" message are returned; nothing
// about redemption counts, other admin-only offer fields, etc.
export async function GET() {
  try {
    const [offersSnap, plansSnap] = await Promise.all([
      adminDb().collection("offers").where("active", "==", true).get(),
      adminDb().collection("plans").get(),
    ]);

    const plansById = {};
    plansSnap.docs.forEach((d) => { plansById[d.id] = d.data(); });

    const now = Date.now();
    const offers = offersSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((o) => !o.expiresAt || new Date(o.expiresAt).getTime() >= now)
      .filter((o) => !o.maxRedemptions || (o.redemptionCount || 0) < o.maxRedemptions)
      .filter((o) => plansById[o.planId] && plansById[o.planId].active !== false)
      .map((o) => ({
        code: o.id,
        planId: o.planId,
        planName: plansById[o.planId]?.name || "",
        discountType: o.discountType,
        discountValue: o.discountValue,
        duration: o.duration,
        cyclesCount: o.cyclesCount || null,
      }));

    return NextResponse.json({ offers });
  } catch (e) {
    return NextResponse.json({ offers: [] }, { status: 200 });
  }
}
