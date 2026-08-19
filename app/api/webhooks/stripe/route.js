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
// invoice.payment_failed.
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
