import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Configure this URL (https://bizzux.com/api/webhooks/stripe) under Stripe
// Dashboard → Developers → Webhooks, with the same secret as
// STRIPE_WEBHOOK_SECRET below. Subscribe at least to: checkout.session.completed,
// customer.subscription.updated, customer.subscription.deleted,
// invoice.payment_failed, invoice.paid.

// Idempotently counts an offer redemption — mirrors the Razorpay webhook's
// version. Webhooks can be delivered more than once for the same event, so
// this only increments if this exact subscription hasn't already been
// counted for this code. See app/api/admin/offers/route.js for the offer
// doc shape.
async function recordOfferRedemption(offerCode, subscriptionId) {
  if (!offerCode) return;
  const ref = adminDb().doc("offers/" + offerCode);
  try {
    await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const already = snap.data().redeemedSubscriptionIds || [];
      if (already.includes(subscriptionId)) return;
      tx.update(ref, {
        redeemedSubscriptionIds: FieldValue.arrayUnion(subscriptionId),
        redemptionCount: FieldValue.increment(1),
      });
    });
  } catch (e) {
    console.error("recordOfferRedemption failed:", e);
  }
}

// Tracks how many discounted billing cycles a subscription has left, and
// switches it back to the regular full-price Stripe Price once they run
// out. Mirrors the Razorpay webhook's decrementOfferCycles — the ORIGINAL
// discount length lives in the subscription's metadata (immutable, set
// once at checkout — see app/api/checkout/route.js); the live "how many
// are left" count lives on customers/{uid}.activeOffer, shared with the
// Razorpay side, keyed by subscriptionId.
async function decrementOfferCycles({ uid, subscriptionId, offerCode, totalCycles, regularPriceId }) {
  if (!uid || !offerCode || !totalCycles) return; // "forever" offers need no tracking at all

  const custRef = adminDb().doc("customers/" + uid);
  let shouldRevert = false;

  try {
    await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(custRef);
      const existing = snap.exists ? snap.data().activeOffer : null;

      let remaining;
      if (existing && existing.subscriptionId === subscriptionId) {
        remaining = Number(existing.cyclesRemaining) - 1;
      } else {
        // First invoice we're processing for this subscription's offer —
        // this charge itself consumes the first cycle.
        remaining = totalCycles - 1;
      }

      if (remaining <= 0) {
        shouldRevert = true;
        tx.set(custRef, { activeOffer: FieldValue.delete() }, { merge: true });
      } else {
        tx.set(custRef, { activeOffer: { code: offerCode, subscriptionId, cyclesRemaining: remaining, regularPlanId: regularPriceId } }, { merge: true });
      }
    });
  } catch (e) {
    console.error("decrementOfferCycles transaction failed:", e);
    return;
  }

  if (shouldRevert && regularPriceId) {
    try {
      const subscription = await stripe().subscriptions.retrieve(subscriptionId);
      const itemId = subscription.items?.data?.[0]?.id;
      if (itemId) {
        await stripe().subscriptions.update(subscriptionId, {
          items: [{ id: itemId, price: regularPriceId }],
          proration_behavior: "none",
        });
      }
    } catch (e) {
      console.error("Reverting subscription to regular price after offer expiry failed:", e);
    }
  }
}

export async function POST(req) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature") || "";
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  let event;
  try {
    event = stripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (e) {
    return NextResponse.json({ error: "Invalid signature: " + e.message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const uid = session.client_reference_id || session.metadata?.uid;
        if (uid) {
          await adminDb().doc("customers/" + uid).set(
            {
              status: "active",
              subscriptionGateway: "stripe",
              subscriptionId: session.subscription || null,
              stripeCustomerId: session.customer || null,
              planId: session.metadata?.planId || null,
              planName: session.metadata?.planName || null,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        break;
      }

      // Fires for every successful invoice payment — the very first one
      // (same invoice checkout.session.completed just activated) and every
      // renewal after it. This is the single place offer redemption
      // counting + discount-cycle tracking happens, mirroring Razorpay's
      // subscription.charged, so a cycle can't get double-counted between
      // this and checkout.session.completed. Also where paymentCount is
      // incremented (mirroring Razorpay's own increment) — used by the
      // Super Admin Customers list to tell a first-time payer from a
      // renewal. Webhooks can be redelivered, so it can drift slightly
      // high on a retry — fine for a display column, not billing logic.
      case "invoice.paid": {
        const invoice = event.data.object;
        const uid = invoice.subscription_details?.metadata?.uid || invoice.metadata?.uid;
        const offerCode = invoice.subscription_details?.metadata?.offerCode;
        const subscriptionId = invoice.subscription;
        if (uid) {
          await adminDb().doc("customers/" + uid).set(
            { paymentCount: FieldValue.increment(1), lastChargedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
        if (uid && offerCode && subscriptionId) {
          await recordOfferRedemption(offerCode, subscriptionId);
          const totalCycles = invoice.subscription_details?.metadata?.offerCyclesRemaining
            ? Number(invoice.subscription_details.metadata.offerCyclesRemaining)
            : null;
          const regularPriceId = invoice.subscription_details?.metadata?.regularStripePriceId;
          await decrementOfferCycles({ uid, subscriptionId, offerCode, totalCycles, regularPriceId });
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const uid = subscription.metadata?.uid;
        if (uid) {
          const status =
            ["active", "trialing"].includes(subscription.status)
              ? "active"
              : subscription.status === "past_due"
              ? "past_due"
              : "cancelled";
          await adminDb().doc("customers/" + uid).set(
            {
              status,
              currentPeriodEnd: subscription.current_period_end
                ? new Date(subscription.current_period_end * 1000)
                : null,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const uid = subscription.metadata?.uid;
        if (uid) {
          await adminDb().doc("customers/" + uid).set(
            { status: "cancelled", updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const uid = invoice.subscription_details?.metadata?.uid || invoice.metadata?.uid;
        if (uid) {
          await adminDb().doc("customers/" + uid).set(
            { status: "past_due", updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
        break;
      }

      default:
        break;
    }
  } catch (e) {
    console.error("Stripe webhook handling failed:", e);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
