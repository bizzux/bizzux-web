import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

// Public and identical for every visitor (no per-user data), so unlike the
// rest of this app's API routes this one is safe to let Vercel's CDN cache
// — a fresh Firestore-backed serverless invocation was taking 1-3s here
// (the well-known "first Firestore query on a cold instance" tax) on
// EVERY pricing-page visit for no reason, since the underlying data (which
// offer codes are currently active) rarely changes. Served from cache for
// up to 60s, then revalidated in the background (visitors keep getting the
// fast cached response while that happens) — a new offer going live takes
// at most a minute to appear here instead of instantly.
export const revalidate = 60;

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

    const activePlans = plansSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.active !== false);
    const plansById = Object.fromEntries(activePlans.map((p) => [p.id, p]));

    const now = Date.now();
    const offers = offersSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((o) => !o.expiresAt || new Date(o.expiresAt).getTime() >= now)
      .filter((o) => !o.maxRedemptions || (o.redemptionCount || 0) < o.maxRedemptions)
      .map((o) => {
        const scope = o.scope || "plan";
        // "plan"-scoped codes name one exact plan; "app"/"all"-scoped
        // codes apply to several, so a representative plan is picked just
        // to render a friendly "X% off the <Plan> plan" headline below —
        // see offerHeadline() in PricingPlans.tsx.
        let plan;
        if (scope === "plan") plan = plansById[o.planId];
        else if (scope === "app") plan = activePlans.find((p) => p.appKey === o.appKey);
        else plan = activePlans[0];
        if (!plan) return null;
        return {
          code: o.id,
          planId: plan.id,
          planName: plan.name,
          discountType: o.discountType,
          discountValue: o.discountValue,
          duration: o.duration,
          cyclesCount: o.cyclesCount || null,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ offers });
  } catch (e) {
    return NextResponse.json({ offers: [] }, { status: 200 });
  }
}
