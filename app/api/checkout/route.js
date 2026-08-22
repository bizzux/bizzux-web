import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { razorpay } from "@/lib/razorpay";
import { stripe } from "@/lib/stripe";
import { createRazorpayPlan, createStripePrice, computeDiscountedPrice } from "@/lib/gatewayPlans";
import { resolveCode } from "@/lib/referral";
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
//
// Partner / reseller referral codes (see lib/referral.js) go through this
// exact same path — resolveCode() checks offers/{CODE} first, then
// referralCodes/{CODE}, and returns one common shape either way. When it's
// a referral code, resolveCode also hands back the reseller's uid, which
// gets stamped onto notes/metadata below (resellerId) so the payment
// webhooks know who to credit a commission to once the sale goes through.
async function resolveOfferForCheckout({ code, planId, plan, gateway, requester }) {
  const resolved = await resolveCode(code, planId, requester);
  if (!resolved.valid) throw { status: 400, message: resolved.error };

  const discountedPrice = computeDiscountedPrice(plan.price, resolved.discountType, resolved.discountValue);
  const planFields = { name: `${plan.name} (${resolved.code})`, price: discountedPrice, billingPeriod: plan.billingPeriod };

  let discountedPlanId;
  if (gateway === "razorpay") {
    discountedPlanId = resolved.razorpayPlanId;
    if (!discountedPlanId) {
      discountedPlanId = await createRazorpayPlan(planFields);
      if (!discountedPlanId) throw { status: 500, message: "Couldn't set up that discount right now. Please try again shortly." };
      await resolved.ref.set({ razorpayPlanId: discountedPlanId }, { merge: true });
    }
  } else {
    discountedPlanId = resolved.stripePriceId;
    if (!discountedPlanId) {
      discountedPlanId = await createStripePrice(planFields);
      if (!discountedPlanId) throw { status: 500, message: "Couldn't set up that discount right now. Please try again shortly." };
      await resolved.ref.set({ stripePriceId: discountedPlanId }, { merge: true });
    }
  }

  const cyclesRemaining = resolved.duration === "once" ? 1 : resolved.duration === "cycles" ? resolved.cyclesCount : null;
  return { code: resolved.code, discountedPlanId, cyclesRemaining, resellerId: resolved.resellerId || null };
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

    const custRef = adminDb().doc("customers/" + c.uid);
    const custSnap = await custRef.get();
    const customer = custSnap.exists ? custSnap.data() : {};

    let offerResult = null;
    if (couponCode && String(couponCode).trim()) {
      offerResult = await resolveOfferForCheckout({
        code: couponCode, planId, plan, gateway,
        requester: { uid: c.uid, paymentCount: customer.paymentCount || 0 },
      });
    }

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
        if (offerResult.resellerId) notes.resellerId = offerResult.resellerId;
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
      if (offerResult.resellerId) metadata.resellerId = offerResult.resellerId;
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
