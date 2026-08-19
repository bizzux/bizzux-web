import { NextResponse } from "next/server";
import { requireSuperAdmin, requireOrgManager, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { razorpay } from "@/lib/razorpay";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Razorpay Plans and Stripe Prices are both immutable once created (you
// can't edit the amount on an existing one), so instead of making the
// admin create them by hand in each gateway's dashboard and paste the ID
// back into this form, we create them automatically whenever a plan is
// saved with a price/name/billing period that doesn't match what's
// already on file. The old plan/price object is simply left orphaned at
// the gateway (harmless — any existing subscription keeps referencing it);
// new checkouts pick up the fresh one via the Firestore doc. If a
// gateway's API keys (RAZORPAY_KEY_ID/SECRET, STRIPE_SECRET_KEY) aren't
// configured yet, that gateway is silently skipped — nothing blocks saving
// the plan itself, and the ID just stays empty until keys are added.
function razorpayPeriod(billingPeriod) {
  const p = (billingPeriod || "month").toLowerCase();
  if (p.startsWith("year")) return "yearly";
  if (p.startsWith("week")) return "weekly";
  if (p.startsWith("day")) return "daily";
  return "monthly";
}
function stripeInterval(billingPeriod) {
  const p = (billingPeriod || "month").toLowerCase();
  if (p.startsWith("year")) return "year";
  if (p.startsWith("week")) return "week";
  if (p.startsWith("day")) return "day";
  return "month";
}

// Rough INR -> USD conversion for the Stripe (USD) side — same estimated
// rate the pricing page shows customers (PricingPlans.tsx's USD_RATE).
const USD_RATE = 83;

async function createRazorpayPlan({ name, price, billingPeriod }) {
  try {
    const plan = await razorpay().plans.create({
      period: razorpayPeriod(billingPeriod),
      interval: 1,
      item: {
        name: `Bizzux ${name}`,
        amount: Math.round(Number(price) * 100), // paise
        currency: "INR",
      },
    });
    return plan.id;
  } catch (e) {
    console.error("Auto-create Razorpay plan failed:", e?.message || e);
    return null;
  }
}

async function createStripePrice({ name, price, billingPeriod }) {
  try {
    const unitAmount = Math.round((Number(price) / USD_RATE) * 100); // USD cents
    const p = await stripe().prices.create({
      currency: "usd",
      unit_amount: unitAmount,
      recurring: { interval: stripeInterval(billingPeriod) },
      product_data: { name: `Bizzux ${name}` },
    });
    return p.id;
  } catch (e) {
    console.error("Auto-create Stripe price failed:", e?.message || e);
    return null;
  }
}

// Picks the razorpayPlanId/stripePriceId to save. An explicit value on the
// request wins (manual override still works if ever needed); otherwise a
// fresh plan/price is auto-created when the price/name/billing period
// changed (or there's no id yet); otherwise the existing id is left
// untouched so an unrelated edit (e.g. toggling "active") doesn't spam the
// gateway with a new plan/price every time.
async function resolveGatewayIds({ planFields, overrides, existing, changed }) {
  let razorpayPlanId = existing?.razorpayPlanId || "";
  let stripePriceId = existing?.stripePriceId || "";

  if (typeof overrides.razorpayPlanId === "string" && overrides.razorpayPlanId.trim()) {
    razorpayPlanId = overrides.razorpayPlanId.trim();
  } else if (changed || !razorpayPlanId) {
    const created = await createRazorpayPlan(planFields);
    if (created) razorpayPlanId = created;
  }

  if (typeof overrides.stripePriceId === "string" && overrides.stripePriceId.trim()) {
    stripePriceId = overrides.stripePriceId.trim();
  } else if (changed || !stripePriceId) {
    const created = await createStripePrice(planFields);
    if (created) stripePriceId = created;
  }

  return { razorpayPlanId, stripePriceId };
}

// Read is available to anyone who can manage organizations (Super Admin,
// Global Admin, Admin) since the Add Organization form needs this list for
// its "Profile (plan)" dropdown. Writing/managing plans themselves — price,
// features, limits — stays Super Admin only below.
export async function GET(req) {
  try {
    await requireOrgManager(req);
    const snap = await adminDb().collection("plans").orderBy("sortOrder", "asc").get();
    const plans = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ plans });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json();
    const { action, id } = body;

    if (action === "create") {
      const { name, price, billingPeriod, description, features, popular, active, sortOrder, limits } = body;
      if (!name || price === undefined) throw { status: 400, message: "Name and price are required" };

      const { razorpayPlanId, stripePriceId } = await resolveGatewayIds({
        planFields: { name, price, billingPeriod },
        overrides: { razorpayPlanId: body.razorpayPlanId, stripePriceId: body.stripePriceId },
        existing: null,
        changed: true,
      });

      const ref = await adminDb().collection("plans").add({
        name, price: Number(price), billingPeriod: billingPeriod || "month",
        description: description || "", features: Array.isArray(features) ? features : [],
        popular: !!popular, active: active !== false, sortOrder: Number(sortOrder) || 0,
        limits: limits && typeof limits === "object" ? limits : {},
        razorpayPlanId, stripePriceId,
        createdAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: true, id: ref.id, razorpayPlanId, stripePriceId });
    }

    if (action === "update") {
      if (!id) throw { status: 400, message: "Plan id required" };
      const { name, price, billingPeriod, description, features, popular, active, sortOrder } = body;

      const existingSnap = await adminDb().doc("plans/" + id).get();
      const existing = existingSnap.exists ? existingSnap.data() : null;
      const changed =
        !existing ||
        existing.name !== name ||
        Number(existing.price) !== Number(price) ||
        (existing.billingPeriod || "month") !== (billingPeriod || "month");

      const { razorpayPlanId, stripePriceId } = await resolveGatewayIds({
        planFields: { name, price, billingPeriod },
        overrides: { razorpayPlanId: body.razorpayPlanId, stripePriceId: body.stripePriceId },
        existing,
        changed,
      });

      await adminDb().doc("plans/" + id).set({
        name, price: Number(price), billingPeriod: billingPeriod || "month",
        description: description || "", features: Array.isArray(features) ? features : [],
        popular: !!popular, active: active !== false, sortOrder: Number(sortOrder) || 0,
        razorpayPlanId, stripePriceId,
      }, { merge: true });
      return NextResponse.json({ ok: true, razorpayPlanId, stripePriceId });
    }

    // Lightweight patch used by the Plan Limits tab — only touches the
    // `limits` map, so it can't accidentally clobber name/price/features
    // while someone's mid-edit on the main Plans tab.
    if (action === "setLimits") {
      if (!id) throw { status: 400, message: "Plan id required" };
      const { limits } = body;
      await adminDb().doc("plans/" + id).set({ limits: limits && typeof limits === "object" ? limits : {} }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      if (!id) throw { status: 400, message: "Plan id required" };
      await adminDb().doc("plans/" + id).delete();
      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
