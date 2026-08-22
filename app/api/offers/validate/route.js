import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { computeDiscountedPrice } from "@/lib/gatewayPlans";
import { resolveCode } from "@/lib/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pure preview — signed-in users only (keeps this from being a free
// code-guessing oracle for anonymous visitors), no side effects. Doesn't
// touch redemptionCount or create anything at the gateways; that only
// happens for real at checkout (app/api/checkout/route.js), which
// re-validates everything here from scratch rather than trusting this call.
//
// The code can be an admin-made Offer or a Partner's referral code —
// resolveCode (lib/referral.js) checks both and returns one common shape.
export async function POST(req) {
  let c;
  try {
    c = await requireUser(req);
  } catch (e) {
    return NextResponse.json({ valid: false, error: "Please sign in first." }, { status: e.status || 401 });
  }

  try {
    const { code, planId } = await req.json();
    if (!code || !planId) {
      return NextResponse.json({ valid: false, error: "Missing code or plan" }, { status: 400 });
    }

    const custSnap = await adminDb().doc("customers/" + c.uid).get();
    const paymentCount = custSnap.exists ? custSnap.data().paymentCount || 0 : 0;

    const resolved = await resolveCode(code, planId, { uid: c.uid, paymentCount });
    if (!resolved.valid) {
      return NextResponse.json({ valid: false, error: resolved.error });
    }

    const planSnap = await adminDb().doc("plans/" + planId).get();
    if (!planSnap.exists) {
      return NextResponse.json({ valid: false, error: "Plan not found." });
    }
    const plan = planSnap.data();
    const discountedPrice = computeDiscountedPrice(plan.price, resolved.discountType, resolved.discountValue);

    return NextResponse.json({
      valid: true,
      code: resolved.code,
      discountType: resolved.discountType,
      discountValue: resolved.discountValue,
      duration: resolved.duration,
      cyclesCount: resolved.cyclesCount || null,
      originalPrice: plan.price,
      discountedPrice,
    });
  } catch (e) {
    return NextResponse.json({ valid: false, error: e.message || "Couldn't check that code." }, { status: 500 });
  }
}
