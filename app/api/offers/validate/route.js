import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { computeDiscountedPrice } from "@/lib/gatewayPlans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pure preview — signed-in users only (keeps this from being a free
// code-guessing oracle for anonymous visitors), no side effects. Doesn't
// touch redemptionCount or create anything at the gateways; that only
// happens for real at checkout (app/api/checkout/route.js), which
// re-validates everything here from scratch rather than trusting this call.
export async function POST(req) {
  try {
    await requireUser(req);
  } catch (e) {
    return NextResponse.json({ valid: false, error: "Please sign in first." }, { status: e.status || 401 });
  }

  try {
    const { code, planId } = await req.json();
    if (!code || !planId) {
      return NextResponse.json({ valid: false, error: "Missing code or plan" }, { status: 400 });
    }

    const offerSnap = await adminDb().doc("offers/" + String(code).trim().toUpperCase()).get();
    if (!offerSnap.exists) {
      return NextResponse.json({ valid: false, error: "That code isn't valid." });
    }
    const offer = offerSnap.data();

    if (offer.active === false) {
      return NextResponse.json({ valid: false, error: "That code isn't active anymore." });
    }
    if (offer.planId !== planId) {
      return NextResponse.json({ valid: false, error: "That code isn't valid for this plan." });
    }
    if (offer.expiresAt && new Date(offer.expiresAt).getTime() < Date.now()) {
      return NextResponse.json({ valid: false, error: "That code has expired." });
    }
    if (offer.maxRedemptions && (offer.redemptionCount || 0) >= offer.maxRedemptions) {
      return NextResponse.json({ valid: false, error: "That code has already been fully redeemed." });
    }

    const planSnap = await adminDb().doc("plans/" + planId).get();
    if (!planSnap.exists) {
      return NextResponse.json({ valid: false, error: "Plan not found." });
    }
    const plan = planSnap.data();
    const discountedPrice = computeDiscountedPrice(plan.price, offer.discountType, offer.discountValue);

    return NextResponse.json({
      valid: true,
      code: offerSnap.id,
      discountType: offer.discountType,
      discountValue: offer.discountValue,
      duration: offer.duration,
      cyclesCount: offer.cyclesCount || null,
      originalPrice: plan.price,
      discountedPrice,
    });
  } catch (e) {
    return NextResponse.json({ valid: false, error: e.message || "Couldn't check that code." }, { status: 500 });
  }
}
