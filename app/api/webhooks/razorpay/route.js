import { NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";
import { razorpay } from "@/lib/razorpay";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Configure this URL (https://bizzux.com/api/webhooks/razorpay) under
// Razorpay Dashboard → Settings → Webhooks, with the same secret as
// RAZORPAY_WEBHOOK_SECRET below. Subscribe at least to: subscription.activated,
// subscription.charged, subscription.cancelled, subscription.completed,
// subscription.halted, payment.failed.
//
// This is the source of truth for subscription state — unlike the optimistic
// update in app/api/checkout/verify/route.js, this fires for every renewal,
// cancellation and failed payment for the lifetime of the subscription, not
// just the first payment.

// Idempotently counts an offer redemption: webhooks can be delivered more
// than once for the same event, so this only increments if this exact
// subscription hasn't already been counted for this code. See
// app/api/admin/offers/route.js for the offer doc shape.
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
// switches it back to the regular full-price Razorpay plan once they run
// out. sub.notes carries the ORIGINAL discount length (immutable, set once
// at subscription creation — see app/api/checkout/route.js); the live
// "how many are left" count lives on customers/{uid}.activeOffer since
// Razorpay subscription notes can't be edited after creation.
async function decrementOfferCycles(sub) {
  const uid = sub.notes?.uid;
  const offerCode = sub.notes?.offerCode;
  const totalCycles = sub.notes?.offerCyclesRemaining ? Number(sub.notes.offerCyclesRemaining) : null;
  const regularPlanId = sub.notes?.regularRazorpayPlanId;
  if (!uid || !offerCode || !totalCycles) return; // "forever" offers (no cycles note) need no tracking at all

  const custRef = adminDb().doc("customers/" + uid);
  let shouldRevert = false;

  try {
    await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(custRef);
      const existing = snap.exists ? snap.data().activeOffer : null;

      let remaining;
      if (existing && existing.subscriptionId === sub.id) {
        remaining = Number(existing.cyclesRemaining) - 1;
      } else {
        // First charge we're processing for this subscription's offer —
        // this charge itself consumes the first cycle.
        remaining = totalCycles - 1;
      }

      if (remaining <= 0) {
        shouldRevert = true;
        tx.set(custRef, { activeOffer: FieldValue.delete() }, { merge: true });
      } else {
        tx.set(custRef, { activeOffer: { code: offerCode, subscriptionId: sub.id, cyclesRemaining: remaining, regularPlanId } }, { merge: true });
      }
    });
  } catch (e) {
    console.error("decrementOfferCycles transaction failed:", e);
    return;
  }

  if (shouldRevert && regularPlanId) {
    try {
      await razorpay().subscriptions.update(sub.id, { plan_id: regularPlanId, schedule_change_at: "now" });
    } catch (e) {
      console.error("Reverting subscription to regular plan after offer expiry failed:", e);
    }
  }
}

export async function POST(req) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") || "";
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    console.error("RAZORPAY_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (expected !== signature) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const sub = event.payload?.subscription?.entity;
  const uid = sub?.notes?.uid;

  try {
    switch (event.event) {
      case "subscription.activated":
      case "subscription.charged":
        if (uid) {
          await adminDb().doc("customers/" + uid).set(
            {
              status: "active",
              subscriptionGateway: "razorpay",
              subscriptionId: sub.id,
              planId: sub.notes?.planId || null,
              planName: sub.notes?.planName || null,
              currentPeriodEnd: sub.current_end ? new Date(sub.current_end * 1000) : null,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        // Offer redemption counting + discount-cycle tracking, and the
        // paymentCount used by the Super Admin Customers list to tell a
        // first-time payer from a renewal, only run on subscription.charged
        // — that's the event guaranteed to fire for every actual successful
        // payment (activated can precede or coincide with it depending on
        // auth type; charged is the one that's actually money changing
        // hands). Webhooks can be redelivered, so paymentCount can drift
        // slightly high on a retry — fine for a display column, not used
        // for billing logic.
        if (event.event === "subscription.charged") {
          if (uid) {
            await adminDb().doc("customers/" + uid).set(
              { paymentCount: FieldValue.increment(1), lastChargedAt: FieldValue.serverTimestamp() },
              { merge: true }
            );
          }
          if (sub?.notes?.offerCode) {
            await recordOfferRedemption(sub.notes.offerCode, sub.id);
            await decrementOfferCycles(sub);
          }
        }
        break;

      case "subscription.cancelled":
      case "subscription.completed":
      case "subscription.halted":
        if (uid) {
          await adminDb().doc("customers/" + uid).set(
            { status: "cancelled", updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
        break;

      case "payment.failed": {
        const failedUid = event.payload?.payment?.entity?.notes?.uid || uid;
        if (failedUid) {
          await adminDb().doc("customers/" + failedUid).set(
            { status: "past_due", updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
        break;
      }

      default:
        // Other event types (invoice.*, order.paid, etc.) aren't acted on.
        break;
    }
  } catch (e) {
    console.error("Razorpay webhook handling failed:", e);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
