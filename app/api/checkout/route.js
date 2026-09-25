import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { razorpay } from "@/lib/razorpay";
import { stripe } from "@/lib/stripe";
import { resolveCode } from "@/lib/referral";
import { getPricingConfig, getOrCreateGatewayPlan, buildSubscriptionSnapshot } from "@/lib/pricing";
import { computeQuote, applyDiscount } from "@/lib/pricingMath";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Starts a recurring per-user subscription for a signed-in customer:
// { planCode: "APP"|"SUITE", appKey (APP only), billingCycle: "month"|"year",
//   quantity (users), gateway: "razorpay"|"stripe", couponCode? }
//
// The price is computed here, server-side, from the published pricing in
// Firestore (lib/pricing.js + lib/pricingMath.js). The client never sends
// a price. The gateway is charged the per-user price x quantity, using a
// gateway plan/price cached per distinct amount (getOrCreateGatewayPlan).
//
// The agreed price is saved as a snapshot in subscriptions/{gatewayId} and
// copied onto the customer when payment is confirmed (checkout/verify or
// the webhooks). From then on the customer's price comes from that
// snapshot, not from published pricing, so later price changes never
// affect them.
//
// Offer, partner-referral and promo codes (lib/referral.js) still apply to
// monthly billing only. A discounted code charges a discounted gateway
// plan; for codes limited to N cycles, the webhooks switch the subscription
// back to the regular plan afterwards (offerCyclesRemaining +
// regularRazorpayPlanId / regularStripePriceId in notes/metadata).
export async function POST(req) {
  try {
    const c = await requireUser(req);
    const body = await req.json();
    const { gateway, couponCode } = body;
    if (gateway !== "razorpay" && gateway !== "stripe") throw { status: 400, message: "Unknown payment gateway" };

    const config = await getPricingConfig({ fresh: true });
    const quote = computeQuote(config, body);
    if (!quote.ok) throw { status: 400, message: quote.error };
    const annual = quote.billingCycle === "year";
    const usdRate = config.settings.usdRate;

    const custRef = adminDb().doc("customers/" + c.uid);
    const custSnap = await custRef.get();
    if (!custSnap.exists) {
      throw { status: 400, message: "Set up your business first: open any app from your dashboard, then come back to choose a plan." };
    }
    const customer = custSnap.data();
    // A second gateway subscription would double-charge. Plan changes on a
    // live paid subscription go through support until self-serve upgrades
    // (cancel + prorate) are built.
    if (customer.status === "active" && customer.billing !== "complimentary" && customer.subscriptionId) {
      throw { status: 409, message: "You already have an active subscription. Contact us to change your plan or number of users." };
    }

    let offer = null;
    if (!annual && couponCode && String(couponCode).trim()) {
      const resolved = await resolveCode(couponCode, { id: quote.planCode, appKey: quote.appKey }, {
        uid: c.uid, paymentCount: customer.paymentCount || 0,
      });
      if (!resolved.valid) throw { status: 400, message: resolved.error };
      offer = {
        code: resolved.code,
        kind: resolved.kind,
        resellerId: resolved.resellerId || null,
        cyclesRemaining: resolved.duration === "once" ? 1 : resolved.duration === "cycles" ? resolved.cyclesCount : null,
        unitPrice: applyDiscount(quote.unitPrice, resolved.discountType, resolved.discountValue),
      };
    }

    const chargeUnitPrice = offer ? offer.unitPrice : quote.unitPrice;
    const label = `${quote.displayName} (${annual ? "Annual" : "Monthly"}, per user)`;
    const gatewayPlanId = await getOrCreateGatewayPlan({ gateway, amountInr: chargeUnitPrice, billingCycle: quote.billingCycle, label, usdRate });
    if (!gatewayPlanId) {
      throw { status: 503, message: `${gateway === "razorpay" ? "Razorpay" : "Card"} payments aren't available right now. Please try again shortly or contact us.` };
    }
    let regularPlanId = null;
    if (offer && offer.cyclesRemaining !== null) {
      regularPlanId = await getOrCreateGatewayPlan({ gateway, amountInr: quote.unitPrice, billingCycle: quote.billingCycle, label, usdRate });
    }

    // Kept short: Razorpay allows 15 note keys of 256 chars each.
    const meta = {
      uid: c.uid,
      planId: quote.planCode,
      planName: quote.displayName,
      appKey: quote.appKey || "",
      billingCycle: quote.billingCycle,
      quantity: String(quote.quantity),
    };
    if (offer) {
      meta.offerCode = offer.code;
      if (offer.kind === "promo") meta.promoCode = offer.code;
      if (offer.resellerId) meta.resellerId = offer.resellerId;
      if (offer.cyclesRemaining !== null) {
        meta.offerCyclesRemaining = String(offer.cyclesRemaining);
        if (gateway === "razorpay") meta.regularRazorpayPlanId = regularPlanId || "";
        else meta.regularStripePriceId = regularPlanId || "";
      }
    }

    async function saveSnapshot(subscriptionId) {
      const snapshot = buildSubscriptionSnapshot(quote, {
        discountedUnitPrice: offer ? offer.unitPrice : undefined,
        couponCode: offer?.code,
        gateway,
        subscriptionId,
      });
      await adminDb().doc("subscriptions/" + subscriptionId).set({
        uid: c.uid, gateway, status: "created", snapshot, createdAt: FieldValue.serverTimestamp(),
      });
      await custRef.set(
        {
          pendingSubscription: { gateway, subscriptionId, planId: quote.planCode, planName: quote.displayName, billingCycle: quote.billingCycle },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    if (gateway === "razorpay") {
      let razorpayCustomerId = customer.razorpayCustomerId || null;
      if (!razorpayCustomerId) {
        try {
          const rc = await razorpay().customers.create({ name: customer.fullName || c.email, email: c.email, notes: { uid: c.uid } });
          razorpayCustomerId = rc.id;
          await custRef.set({ razorpayCustomerId }, { merge: true });
        } catch {
          razorpayCustomerId = null; // Checkout can still collect/match the customer itself
        }
      }

      const subscription = await razorpay().subscriptions.create({
        plan_id: gatewayPlanId,
        quantity: quote.quantity,
        customer_notify: 1,
        // Razorpay needs a finite count; ~10 years means "until cancelled".
        total_count: annual ? 10 : 120,
        notes: meta,
      });
      await saveSnapshot(subscription.id);

      return NextResponse.json({
        gateway: "razorpay",
        keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        subscriptionId: subscription.id,
        planName: quote.displayName,
      });
    }

    const origin = req.headers.get("origin") || "https://bizzux.com";
    const sessionParams = {
      mode: "subscription",
      line_items: [{ price: gatewayPlanId, quantity: quote.quantity }],
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=cancelled`,
      client_reference_id: c.uid,
      metadata: meta,
      subscription_data: { metadata: meta },
    };
    if (customer.stripeCustomerId) sessionParams.customer = customer.stripeCustomerId;
    else sessionParams.customer_email = c.email;

    const session = await stripe().checkout.sessions.create(sessionParams);
    // The Stripe subscription id only exists after payment, so the snapshot
    // is keyed by the checkout session id; the webhook looks it up by that.
    await saveSnapshot(session.id);
    return NextResponse.json({ gateway: "stripe", url: session.url });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Checkout failed" }, { status: e.status || 500 });
  }
}
