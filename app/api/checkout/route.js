import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { razorpay } from "@/lib/razorpay";
import { stripe } from "@/lib/stripe";
import { createRazorpayPlan, createStripePrice, computeDiscountedPrice } from "@/lib/gatewayPlans";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Starts a recurring subscription checkout for a signed-in customer.
// INR plans go through Razorpay Subscriptions (returns a subscription_id
// the client opens with Razorpay Checkout.js). USD plans go through a
// Stripe Checkout Session in subscription mode (returns a hosted URL to
// redirect to). Either gateway needs the corresponding plan configured
// with a razorpayPlanId / stripePriceId in Admin → Plans first — both are
// auto-created there, see app/api/admin/plans/route.js.
//
// Offer codes (Admin → Super Admin (SaaS) → Offers) are NOT implemented
// via Razorpay's native "Offers" or Stripe's native "Coupons" — Razorpay
// Offers can only be created from their Dashboard, not via API, which
// rules out a self-service admin screen for them. Instead, redeeming a
// valid code here auto-creates a discounted-price Razorpay Plan / Stripe
// Price (same helpers used for regular plans, see lib/gatewayPlans.js) and
// subscribes the customer to that instead of the regular one. For offers
// that only cover a limited number of billing cycles (or just the first
// payment), offerCyclesRemaining travels along in the subscription's
// notes/metadata — the webhook handlers decrement it on each renewal and
// switch the subscription back to the regular full-price plan once it
// hits 0 (see app/api/webhooks/razorpay/route.js and .../stripe/route.js).
async function resolveOfferForCheckout({ code, planId, plan, gateway }) {
  const offerRef = adminDb().doc("offers/" + String(code).trim().toUpperCase());
  const offerSnap = await offerRef.get();
  if (!offerSnap.exists) throw { status: 400, message: "That code isn't valid." };
  const offer = offerSnap.data();

  if (offer.active === false) throw { status: 400, message: "That code isn't active anymore." };
  if (offer.planId !== planId) throw { status: 400, message: "That code isn't valid for this plan." };
  if (offer.expiresAt && new Date(offer.expiresAt).getTime() < Date.now()) {
    throw { status: 400, message: "That code has expired." };
  }
  if (offer.maxRedemptions && (offer.redemptionCount || 0) >= offer.maxRedemptions) {
    throw { status: 400, message: "That code has already been fully redeemed." };
  }

  const discountedPrice = computeDiscountedPrice(plan.price, offer.discountType, offer.discountValue);
  const planFields = { name: `${plan.name} (${offer.code || offerSnap.id})`, price: discountedPrice, billingPeriod: plan.billingPeriod };

  let discountedPlanId;
  if (gateway === "razorpay") {
    discountedPlanId = offer.razorpayPlanId;
    if (!discountedPlanId) {
      discountedPlanId = await createRazorpayPlan(planFields);
      if (!discountedPlanId) throw { status: 500, message: "Couldn't set up that discount right now. Please try again shortly." };
      await offerRef.set({ razorpayPlanId: discountedPlanId }, { merge: true });
    }
  } else {
    discountedPlanId = offer.stripePriceId;
    if (!discountedPlanId) {
      discountedPlanId = await createStripePrice(planFields);
      if (!discountedPlanId) throw { status: 500, message: "Couldn't set up that discount right now. Please try again shortly." };
      await offerRef.set({ stripePriceId: discountedPlanId }, { merge: true });
    }
  }

  const cyclesRemaining = offer.duration === "once" ? 1 : offer.duration === "cycles" ? offer.cyclesCount : null;
  return { code: offerSnap.id, discountedPlanId, cyclesRemaining };
}

export async function POST(req) {
  try {
    const c = await requireUser(req);
    const { planId, gateway, couponCode } = await req.json();
    if (!planId) throw { status: 400, message: "Plan id required" };
    if (gateway !== "razorpay" && gateway !== "stripe") {
      throw { status: 400, message: "Unknown payment gateway" };
    }

    const planSnap = await adminDb().doc("plans/" + planId).get();
    if (!planSnap.exists || planSnap.data().active === false) {
      throw { status: 404, message: "Plan not found" };
    }
    const plan = planSnap.data();

    let offerResult = null;
    if (couponCode && String(couponCode).trim()) {
      offerResult = await resolveOfferForCheckout({ code: couponCode, planId, plan, gateway });
    }

    const custRef = adminDb().doc("customers/" + c.uid);
    const custSnap = await custRef.get();
    const customer = custSnap.exists ? custSnap.data() : {};

    if (gateway === "razorpay") {
      const razorpayPlanId = offerResult ? offerResult.discountedPlanId : plan.razorpayPlanId;
      if (!razorpayPlanId) {
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

      const notes = { uid: c.uid, planId, planName: plan.name };
      if (offerResult) {
        notes.offerCode = offerResult.code;
        if (offerResult.cyclesRemaining !== null) {
          notes.offerCyclesRemaining = String(offerResult.cyclesRemaining);
          notes.regularRazorpayPlanId = plan.razorpayPlanId || "";
        }
      }

      const subscription = await razorpay().subscriptions.create({
        plan_id: razorpayPlanId,
        customer_notify: 1,
        // ~10 years of monthly cycles — Razorpay subscriptions need a finite
        // total_count; this is effectively "runs until cancelled".
        total_count: 120,
        notes,
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
    const stripePriceId = offerResult ? offerResult.discountedPlanId : plan.stripePriceId;
    if (!stripePriceId) {
      throw {
        status: 400,
        message: `Stripe isn't set up for the ${plan.name} plan yet. Add its Stripe Price ID in Admin → Plans.`,
      };
    }

    const metadata = { uid: c.uid, planId, planName: plan.name };
    if (offerResult) {
      metadata.offerCode = offerResult.code;
      if (offerResult.cyclesRemaining !== null) {
        metadata.offerCyclesRemaining = String(offerResult.cyclesRemaining);
        metadata.regularStripePriceId = plan.stripePriceId || "";
      }
    }

    const origin = req.headers.get("origin") || "https://bizzux.com";
    const sessionParams = {
      mode: "subscription",
      line_items: [{ price: stripePriceId, quantity: 1 }],
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=cancelled`,
      client_reference_id: c.uid,
      metadata,
      subscription_data: { metadata },
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
