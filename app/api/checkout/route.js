import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { razorpay } from "@/lib/razorpay";
import { stripe } from "@/lib/stripe";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Starts a recurring subscription checkout for a signed-in customer.
// INR plans go through Razorpay Subscriptions (returns a subscription_id
// the client opens with Razorpay Checkout.js). USD plans go through a
// Stripe Checkout Session in subscription mode (returns a hosted URL to
// redirect to). Either gateway needs the corresponding plan configured
// with a razorpayPlanId / stripePriceId in Admin → Plans first — both are
// created once in that gateway's own dashboard, same as the plan itself.
export async function POST(req) {
  try {
    const c = await requireUser(req);
    const { planId, gateway } = await req.json();
    if (!planId) throw { status: 400, message: "Plan id required" };
    if (gateway !== "razorpay" && gateway !== "stripe") {
      throw { status: 400, message: "Unknown payment gateway" };
    }

    const planSnap = await adminDb().doc("plans/" + planId).get();
    if (!planSnap.exists || planSnap.data().active === false) {
      throw { status: 404, message: "Plan not found" };
    }
    const plan = planSnap.data();

    const custRef = adminDb().doc("customers/" + c.uid);
    const custSnap = await custRef.get();
    const customer = custSnap.exists ? custSnap.data() : {};

    if (gateway === "razorpay") {
      if (!plan.razorpayPlanId) {
        throw {
          status: 400,
          message: `Razorpay isn't set up for the ${plan.name} plan yet. Add its Razorpay Plan ID in Admin → Plans.`,
        };
      }

      // Reuse an existing Razorpay customer for this account if we've
      // already created one; otherwise try to create one now. If Razorpay
      // rejects it (e.g. a customer with this email already exists on
      // their side), fall back to letting Checkout collect/match the
      // customer itself — not fatal either way.
      let razorpayCustomerId = customer.razorpayCustomerId || null;
      if (!razorpayCustomerId) {
        try {
          const rc = await razorpay().customers.create({
            name: customer.fullName || c.email,
            email: c.email,
            notes: { uid: c.uid },
          });
          razorpayCustomerId = rc.id;
          await custRef.set({ razorpayCustomerId }, { merge: true });
        } catch {
          razorpayCustomerId = null;
        }
      }

      const subscription = await razorpay().subscriptions.create({
        plan_id: plan.razorpayPlanId,
        customer_notify: 1,
        // ~10 years of monthly cycles — Razorpay subscriptions need a finite
        // total_count; this is effectively "runs until cancelled".
        total_count: 120,
        notes: { uid: c.uid, planId, planName: plan.name },
      });

      await custRef.set(
        {
          pendingSubscription: {
            gateway: "razorpay",
            subscriptionId: subscription.id,
            planId,
            planName: plan.name,
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return NextResponse.json({
        gateway: "razorpay",
        keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        subscriptionId: subscription.id,
        planName: plan.name,
      });
    }

    // Stripe
    if (!plan.stripePriceId) {
      throw {
        status: 400,
        message: `Stripe isn't set up for the ${plan.name} plan yet. Add its Stripe Price ID in Admin → Plans.`,
      };
    }

    const origin = req.headers.get("origin") || "https://bizzux.com";
    const sessionParams = {
      mode: "subscription",
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=cancelled`,
      client_reference_id: c.uid,
      metadata: { uid: c.uid, planId, planName: plan.name },
      subscription_data: { metadata: { uid: c.uid, planId, planName: plan.name } },
    };
    if (customer.stripeCustomerId) {
      sessionParams.customer = customer.stripeCustomerId;
    } else {
      sessionParams.customer_email = c.email;
    }

    const session = await stripe().checkout.sessions.create(sessionParams);

    return NextResponse.json({ gateway: "stripe", url: session.url });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Checkout failed" }, { status: e.status || 500 });
  }
}
