import { NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";
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
