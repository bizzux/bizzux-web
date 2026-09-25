import { NextResponse } from "next/server";
import crypto from "crypto";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { loadSubscriptionSnapshot, customerFieldsForSnapshot } from "@/lib/pricing";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called by the client right after Razorpay Checkout.js's handler fires, so
// the dashboard flips to the paid plan immediately. The signature check
// proves the payment is real. The subscription.* webhooks
// (app/api/webhooks/razorpay/route.js) confirm the same thing again and keep
// renewals/cancellations in sync.
//
// The agreed price snapshot saved at checkout (subscriptions/{id}) is copied
// onto the customer here, so their price is locked from this moment.
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
    if (expected !== razorpay_signature) throw { status: 400, message: "Payment verification failed" };

    const custRef = adminDb().doc("customers/" + c.uid);
    const custSnap = await custRef.get();
    const customer = custSnap.exists ? custSnap.data() : {};
    const pending = customer.pendingSubscription;
    const matchesPending = pending && pending.gateway === "razorpay" && pending.subscriptionId === razorpay_subscription_id;

    const snapshot = await loadSubscriptionSnapshot(razorpay_subscription_id);
    await custRef.set(
      {
        status: "active",
        billing: FieldValue.delete(), compReason: FieldValue.delete(), compUntil: FieldValue.delete(), compNote: FieldValue.delete(),
        subscriptionGateway: "razorpay",
        subscriptionId: razorpay_subscription_id,
        lastPaymentId: razorpay_payment_id,
        ...(matchesPending ? { planId: pending.planId, planName: pending.planName } : {}),
        ...(snapshot ? customerFieldsForSnapshot(snapshot) : {}),
        pendingSubscription: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    if (snapshot) {
      await adminDb().doc("subscriptions/" + razorpay_subscription_id).set(
        { status: "active", activatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Verification failed" }, { status: e.status || 500 });
  }
}
