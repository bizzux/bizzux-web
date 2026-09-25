// SERVER ONLY. Loads Bizzux's published pricing from Firestore, which is
// the single source of truth for every price shown or charged anywhere:
//
//   pricingPlans/{planCode}   Published plans ("APP", "SUITE"): name, per-user
//                             monthly + annual price (set independently),
//                             billing toggles, labels, active, display order.
//   appPricing/{appKey}       Per-app settings: sold on its own? in the Suite?
//                             optional price override (else inherits "APP").
//   pricingSettings/config    usdRate, maxUsersPerCheckout.
//   pricingHistory/{auto}     One row per changed field: previous/new value,
//                             who, when. Never deleted.
//   gatewayPlanCache/{key}    Razorpay Plan / Stripe Price ids per unique
//                             amount+period, created on demand at checkout.
//
// Published pricing is separate from what a customer pays: at checkout the
// agreed price is copied into customers/{id}.subscription (and
// subscriptions/{gatewayId}), so later price edits never touch an existing
// subscriber.
import { adminDb } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { DEFAULT_PRICING_PLANS, DEFAULT_APP_PRICING, DEFAULT_PRICING_SETTINGS } from "./pricingDefaults";
import { byDisplayOrder } from "./pricingMath";
import { razorpay } from "./razorpay";
import { stripe } from "./stripe";

const CACHE_MS = 30 * 1000;
let cached = null;
let cachedAt = 0;

export function invalidatePricingCache() {
  cached = null;
  cachedAt = 0;
}

function stripTimestamps(d) {
  const out = { ...d };
  for (const k of ["createdAt", "updatedAt"]) {
    if (out[k]?.toDate) out[k] = out[k].toDate().toISOString();
  }
  return out;
}

// Writes the defaults the first time pricing is read on a fresh project, so
// the admin screen and the pricing page always have something to show.
async function seedIfEmpty(plansSnap, appsSnap, settingsSnap) {
  const db = adminDb();
  const batch = db.batch();
  let wrote = false;
  if (plansSnap.empty) {
    for (const p of DEFAULT_PRICING_PLANS) {
      batch.set(db.doc("pricingPlans/" + p.planCode), { ...p, id: p.planCode, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    }
    wrote = true;
  }
  if (appsSnap.empty) {
    for (const a of DEFAULT_APP_PRICING) {
      batch.set(db.doc("appPricing/" + a.appKey), { ...a, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    }
    wrote = true;
  }
  if (!settingsSnap.exists) {
    batch.set(db.doc("pricingSettings/config"), { ...DEFAULT_PRICING_SETTINGS, updatedAt: FieldValue.serverTimestamp() });
    wrote = true;
  }
  if (wrote) await batch.commit();
  return wrote;
}

// Full config, including inactive plans/apps (callers filter). Cached for a
// few seconds per server instance so SSO hand-offs don't re-read it on
// every app open.
export async function getPricingConfig({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < CACHE_MS) return cached;
  const db = adminDb();
  let [plansSnap, appsSnap, settingsSnap] = await Promise.all([
    db.collection("pricingPlans").get(),
    db.collection("appPricing").get(),
    db.doc("pricingSettings/config").get(),
  ]);
  if (await seedIfEmpty(plansSnap, appsSnap, settingsSnap)) {
    [plansSnap, appsSnap, settingsSnap] = await Promise.all([
      db.collection("pricingPlans").get(),
      db.collection("appPricing").get(),
      db.doc("pricingSettings/config").get(),
    ]);
  }
  cached = {
    plans: plansSnap.docs.map((d) => stripTimestamps({ id: d.id, planCode: d.id, ...d.data() })).sort(byDisplayOrder),
    apps: appsSnap.docs.map((d) => stripTimestamps({ appKey: d.id, ...d.data() })).sort(byDisplayOrder),
    settings: { ...DEFAULT_PRICING_SETTINGS, ...(settingsSnap.exists ? stripTimestamps(settingsSnap.data()) : {}) },
  };
  cachedAt = Date.now();
  return cached;
}

// What the public pricing page may see: active plans and active apps only.
export function publicPricing(config) {
  return {
    plans: config.plans.filter((p) => p.active !== false),
    apps: config.apps
      .filter((a) => a.active !== false && (a.individualPurchaseEnabled || a.suiteIncluded))
      .map(({ appKey, appName, icon, description, individualPurchaseEnabled, suiteIncluded, overrideEnabled, monthlyPriceOverride, annualPriceOverride, displayOrder }) => ({
        appKey, appName, icon, description, individualPurchaseEnabled, suiteIncluded, overrideEnabled, monthlyPriceOverride, annualPriceOverride, displayOrder,
      })),
    settings: { usdRate: config.settings.usdRate, maxUsersPerCheckout: config.settings.maxUsersPerCheckout },
  };
}

// Writes one pricingHistory row per changed field. Previous rows are never
// updated or deleted.
export async function recordPriceHistory({ entityType, entityId, entityName, before, after, fields, actor }) {
  const changes = fields.filter((f) => JSON.stringify(before?.[f] ?? null) !== JSON.stringify(after?.[f] ?? null));
  if (!changes.length) return [];
  const batch = adminDb().batch();
  for (const field of changes) {
    batch.set(adminDb().collection("pricingHistory").doc(), {
      entityType, entityId, entityName: entityName || entityId, field,
      previousValue: before?.[field] ?? null,
      newValue: after?.[field] ?? null,
      changedByUid: actor?.uid || null,
      changedBy: actor?.email || null,
      changedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return changes;
}

// Gateway plans/prices are immutable, so we keep one per distinct
// (gateway, amount, period) and reuse it for every customer at that price.
// A price change simply leads to a new one; existing subscriptions keep
// pointing at their old one, which is exactly the price protection we want.
export async function getOrCreateGatewayPlan({ gateway, amountInr, billingCycle, label, usdRate }) {
  const period = billingCycle === "year" ? "year" : "month";
  const amountMinor = gateway === "stripe"
    ? Math.round((Number(amountInr) / (Number(usdRate) || DEFAULT_PRICING_SETTINGS.usdRate)) * 100) // USD cents
    : Math.round(Number(amountInr) * 100); // INR paise
  const key = `${gateway}_${gateway === "stripe" ? "USD" : "INR"}_${amountMinor}_${period}`;
  const ref = adminDb().doc("gatewayPlanCache/" + key);
  const snap = await ref.get();
  if (snap.exists && snap.data().gatewayId) return snap.data().gatewayId;

  let gatewayId = null;
  try {
    if (gateway === "razorpay") {
      const plan = await razorpay().plans.create({
        period: period === "year" ? "yearly" : "monthly",
        interval: 1,
        item: { name: `Bizzux ${label}`.slice(0, 100), amount: amountMinor, currency: "INR" },
      });
      gatewayId = plan.id;
    } else {
      const price = await stripe().prices.create({
        currency: "usd",
        unit_amount: amountMinor,
        recurring: { interval: period },
        product_data: { name: `Bizzux ${label}`.slice(0, 100) },
      });
      gatewayId = price.id;
    }
  } catch (e) {
    console.error(`Creating ${gateway} plan failed:`, e?.message || e);
    return null;
  }
  await ref.set({ gateway, amountMinor, period, label, gatewayId, createdAt: FieldValue.serverTimestamp() });
  return gatewayId;
}

// The customer's own copy of what they agreed to pay. Stored on the
// customer at activation and never recomputed from published pricing.
export function buildSubscriptionSnapshot(quote, { discountedUnitPrice, couponCode, gateway, subscriptionId }) {
  const unitPrice = discountedUnitPrice ?? quote.unitPrice;
  return {
    planCode: quote.planCode,
    planType: quote.planType,
    planName: quote.planName,
    displayName: quote.displayName,
    appKey: quote.appKey,
    appKeys: quote.appKeys,
    billingCycle: quote.billingCycle,
    quantity: quote.quantity,
    currency: quote.currency,
    listUnitPrice: quote.unitPrice,
    unitPrice,
    totalPrice: unitPrice * quote.quantity,
    priceSource: quote.priceSource,
    couponCode: couponCode || null,
    gateway: gateway || null,
    subscriptionId: subscriptionId || null,
    agreedAt: new Date().toISOString(),
  };
}

// Fields to set on customers/{id} when a subscription becomes active. Keeps
// planId/planName (read all over the app) pointing at the new plan.
export function customerFieldsForSnapshot(snapshot) {
  return {
    planId: snapshot.planCode,
    planName: snapshot.displayName,
    billingCycle: snapshot.billingCycle,
    seats: snapshot.quantity,
    subscription: snapshot,
  };
}

// Looks up the snapshot stored at checkout for a gateway subscription id.
export async function loadSubscriptionSnapshot(subscriptionId) {
  if (!subscriptionId) return null;
  const snap = await adminDb().doc("subscriptions/" + subscriptionId).get();
  return snap.exists ? snap.data().snapshot || null : null;
}
