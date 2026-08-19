import { NextResponse } from "next/server";
import { requireSuperAdmin, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Offer codes ("coupons") — Super Admin only, both read and write, since
// these are more sensitive than plan pricing (an org manager doesn't need
// to see active discount codes the way they need the plans dropdown).
//
// Each offer is scoped to exactly one plan and stores its discount as a
// percent-off or flat-amount-off the plan's INR price. It does NOT use
// Razorpay's native "Offers" feature or Stripe's native "Coupons" — see
// app/api/checkout/route.js's big comment for why (Razorpay Offers can
// only be created from their Dashboard, not via API, which rules out a
// self-service admin screen). Instead, redeeming a code auto-creates a
// discounted-price Razorpay Plan / Stripe Price the same way regular plans
// are created (lib/gatewayPlans.js) — the IDs get cached on razorpayPlanId
// / stripePriceId below so repeat redemptions of the same code reuse them
// instead of creating a new discounted plan every time.
const CODE_RE = /^[A-Z0-9_-]{3,32}$/;

function validateOffer(body) {
  const code = String(body.code || "").trim().toUpperCase();
  if (!CODE_RE.test(code)) {
    throw { status: 400, message: "Code must be 3-32 characters: letters, numbers, - or _" };
  }
  if (!body.planId) throw { status: 400, message: "A plan is required" };

  const discountType = body.discountType === "flat" ? "flat" : "percent";
  const discountValue = Number(body.discountValue);
  if (!discountValue || discountValue <= 0) throw { status: 400, message: "Discount value must be greater than 0" };
  if (discountType === "percent" && discountValue > 100) {
    throw { status: 400, message: "Percent discount can't exceed 100" };
  }

  const duration = ["forever", "cycles", "once"].includes(body.duration) ? body.duration : "forever";
  let cyclesCount = null;
  if (duration === "cycles") {
    cyclesCount = Number(body.cyclesCount);
    if (!cyclesCount || cyclesCount <= 0) {
      throw { status: 400, message: "Number of billing cycles must be greater than 0" };
    }
  }

  let expiresAt = null;
  if (body.expiresAt) {
    const d = new Date(body.expiresAt);
    if (isNaN(d.getTime())) throw { status: 400, message: "Invalid expiry date" };
    expiresAt = d.toISOString();
  }

  let maxRedemptions = null;
  if (body.maxRedemptions !== undefined && body.maxRedemptions !== null && body.maxRedemptions !== "") {
    maxRedemptions = Number(body.maxRedemptions);
    if (!maxRedemptions || maxRedemptions <= 0) throw { status: 400, message: "Max redemptions must be greater than 0" };
  }

  return {
    code, planId: body.planId, discountType, discountValue, duration, cyclesCount,
    expiresAt, maxRedemptions, active: body.active !== false,
  };
}

export async function GET(req) {
  try {
    await requireSuperAdmin(req);
    const snap = await adminDb().collection("offers").orderBy("createdAt", "desc").get();
    const offers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ offers });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json();
    const { action, id } = body; // `id` doubles as the offer's code (the Firestore doc id)

    if (action === "create") {
      const v = validateOffer(body);
      const ref = adminDb().doc("offers/" + v.code);
      const existing = await ref.get();
      if (existing.exists) throw { status: 400, message: `Code "${v.code}" is already in use` };

      await ref.set({
        ...v,
        razorpayPlanId: "", stripePriceId: "",
        redemptionCount: 0, redeemedSubscriptionIds: [],
        createdAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: true, id: v.code });
    }

    if (action === "update") {
      if (!id) throw { status: 400, message: "Offer id required" };
      const ref = adminDb().doc("offers/" + id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Offer not found" };
      const existing = snap.data();

      // Code itself can't change (it's the doc id) — editing just updates
      // the discount/plan/rules on the same code.
      const v = validateOffer({ ...body, code: id });

      // If the discount shape or the plan it applies to changed, the
      // cached discounted Razorpay Plan / Stripe Price no longer matches
      // — clear them so the next redemption creates fresh ones at the
      // correct price instead of silently applying a stale discount.
      const discountChanged =
        existing.planId !== v.planId ||
        existing.discountType !== v.discountType ||
        Number(existing.discountValue) !== v.discountValue;

      await ref.set({
        planId: v.planId, discountType: v.discountType, discountValue: v.discountValue,
        duration: v.duration, cyclesCount: v.cyclesCount, expiresAt: v.expiresAt,
        maxRedemptions: v.maxRedemptions, active: v.active,
        ...(discountChanged ? { razorpayPlanId: "", stripePriceId: "" } : {}),
      }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      if (!id) throw { status: 400, message: "Offer id required" };
      await adminDb().doc("offers/" + id).delete();
      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
