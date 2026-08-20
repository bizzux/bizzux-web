import { NextResponse } from "next/server";
import crypto from "crypto";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called by the client right after Razorpay Checkout.js's handler fires,
// so the dashboard/pricing page can flip away from "Trial" to the real
// plan immediately instead of waiting on the webhook round-trip. This is
// optimistic only — the subscription.activated / subscription.charged
// webhook (app/api/webhooks/razorpay/route.js) is the real source of truth
// and will confirm or correct this shortly after regardless of whether the
// customer's browser ever calls this endpoint at all.
export async function POST(req) {
  try {
    const c = await requireUser(req);
    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = await req.json();
    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
      throw { status: 400, message: "Missing verification fields" };
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) throw { status: 500, message: "Razorpay isn't configured on the server" };

    const expected = crypto
      .createHmac("sha256", secret)
      .update(razorpay_payment_id + "|" + razorpay_subscription_id)
      .digest("hex");

    if (expected !== razorpay_signature) {
      throw { status: 400, message: "Payment verification failed" };
    }

    const custRef = adminDb().doc("customers/" + c.uid);
    const custSnap = await custRef.get();
    const customer = custSnap.exists ? custSnap.data() : {};
    // /api/checkout stashed which plan this subscription is for right
    // before opening Checkout.js — pick it up here so planId/planName (and
    // therefore every "which plan am I on" display: dashboard, profile,
    // the pricing page's current-plan button) update right away, instead
    // of only `status` flipping now and the plan name lagging behind until
    // the webhook arrives.
    const pending = customer.pendingSubscription;
    const matchesPending = pending && pending.gateway === "razorpay" && pending.subscriptionId === razorpay_subscription_id;

    await custRef.set(
      {
        status: "active",
        subscriptionGateway: "razorpay",
        subscriptionId: razorpay_subscription_id,
        lastPaymentId: razorpay_payment_id,
        ...(matchesPending ? { planId: pending.planId, planName: pending.planName } : {}),
        pendingSubscription: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Verification failed" }, { status: e.status || 500 });
  }
}
