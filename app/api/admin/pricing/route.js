import { NextResponse } from "next/server";
import { requirePlatformAdmin, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { getPricingConfig, recordPriceHistory, invalidatePricingCache } from "@/lib/pricing";
import { isPrice } from "@/lib/pricingMath";
import { logAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Global Admin → Billing & Pricing. Every field is edited independently:
// saving a monthly price never touches the annual one, and the reverse.
// Changes apply to new checkouts only. Existing subscribers keep the price
// snapshot stored on their subscription (see lib/pricing.js).

const PLAN_FIELDS = [
  "planName", "tagline", "description", "currency", "monthlyPricePerUser", "annualPricePerUser",
  "monthlyBillingEnabled", "annualBillingEnabled", "discountLabel", "offerText", "badge", "ctaLabel",
  "active", "displayOrder",
];
const APP_FIELDS = [
  "appName", "icon", "description", "overrideEnabled", "monthlyPriceOverride", "annualPriceOverride",
  "individualPurchaseEnabled", "suiteIncluded", "active", "displayOrder",
];
const SETTINGS_FIELDS = ["usdRate", "maxUsersPerCheckout"];
const CURRENCIES = ["INR"];

function text(v, max = 200) {
  return String(v ?? "").trim().slice(0, max);
}
function price(v, label, { nullable = false } = {}) {
  if (nullable && (v === null || v === undefined || v === "")) return null;
  if (!isPrice(v)) throw { status: 400, message: `${label} must be a number of 0 or more` };
  return Math.round(Number(v) * 100) / 100;
}

function cleanPlan(input, existing) {
  const out = {};
  for (const f of PLAN_FIELDS) {
    if (!(f in input)) continue;
    const v = input[f];
    if (f === "monthlyPricePerUser") out[f] = price(v, "Monthly price");
    else if (f === "annualPricePerUser") out[f] = price(v, "Annual price");
    else if (["monthlyBillingEnabled", "annualBillingEnabled", "active"].includes(f)) out[f] = !!v;
    else if (f === "displayOrder") out[f] = Number(v) || 0;
    else if (f === "currency") {
      if (!CURRENCIES.includes(v)) throw { status: 400, message: "Currency must be INR for now" };
      out[f] = v;
    } else out[f] = text(v, f === "description" ? 400 : 120);
  }
  const merged = { ...existing, ...out };
  if (!merged.planName) throw { status: 400, message: "Plan name is required" };
  if (merged.active !== false && !merged.monthlyBillingEnabled && !merged.annualBillingEnabled) {
    throw { status: 400, message: "An active plan needs monthly or annual billing switched on" };
  }
  return out;
}

function cleanApp(input, existing) {
  const out = {};
  for (const f of APP_FIELDS) {
    if (!(f in input)) continue;
    const v = input[f];
    if (f === "monthlyPriceOverride") out[f] = price(v, "Monthly override", { nullable: true });
    else if (f === "annualPriceOverride") out[f] = price(v, "Annual override", { nullable: true });
    else if (["overrideEnabled", "individualPurchaseEnabled", "suiteIncluded", "active"].includes(f)) out[f] = !!v;
    else if (f === "displayOrder") out[f] = Number(v) || 0;
    else out[f] = text(v, f === "description" ? 300 : 80);
  }
  const merged = { ...existing, ...out };
  if (!merged.appName) throw { status: 400, message: "App name is required" };
  if (merged.overrideEnabled && merged.monthlyPriceOverride === null && merged.annualPriceOverride === null) {
    throw { status: 400, message: "Enter a monthly or annual override price, or switch the override off" };
  }
  return out;
}

export async function GET(req) {
  try {
    await requirePlatformAdmin(req);
    const config = await getPricingConfig({ fresh: true });
    const histSnap = await adminDb().collection("pricingHistory").orderBy("changedAt", "desc").limit(200).get();
    const history = histSnap.docs.map((d) => {
      const h = d.data();
      return { id: d.id, ...h, changedAt: h.changedAt?.toDate ? h.changedAt.toDate().toISOString() : null };
    });
    return NextResponse.json({ ...config, history });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const actor = await requirePlatformAdmin(req);
    const body = await req.json();
    const db = adminDb();

    if (body.action === "updatePlan") {
      const planCode = text(body.planCode, 40);
      const ref = db.doc("pricingPlans/" + planCode);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Plan not found" };
      const before = snap.data();
      const changes = cleanPlan(body.changes || {}, before);
      await ref.set({ ...changes, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      const changed = await recordPriceHistory({
        entityType: "plan", entityId: planCode, entityName: before.planName, before, after: { ...before, ...changes }, fields: PLAN_FIELDS, actor,
      });
      if (changed.length) {
        await logAuditEvent({ action: "pricing.plan_update", actor, targetType: "pricingPlan", targetId: planCode, details: { fields: changed } });
      }
      invalidatePricingCache();
      return NextResponse.json({ ok: true, changed });
    }

    if (body.action === "updateApp" || body.action === "addApp") {
      const appKey = text(body.appKey, 40).toLowerCase();
      if (!/^[a-z0-9-]{2,40}$/.test(appKey)) throw { status: 400, message: "App key must be 2-40 lowercase letters, numbers or dashes" };
      const ref = db.doc("appPricing/" + appKey);
      const snap = await ref.get();
      if (body.action === "addApp" && snap.exists) throw { status: 409, message: "An app with that key already exists" };
      if (body.action === "updateApp" && !snap.exists) throw { status: 404, message: "App not found" };
      const before = snap.exists
        ? snap.data()
        : {
            appKey, pricingPlanId: "APP", overrideEnabled: false, monthlyPriceOverride: null, annualPriceOverride: null,
            // A new app starts hidden from purchase until an admin decides.
            individualPurchaseEnabled: false, suiteIncluded: false, active: true, displayOrder: 100,
          };
      const changes = cleanApp(body.changes || {}, before);
      await ref.set(
        { ...(snap.exists ? {} : { ...before, createdAt: FieldValue.serverTimestamp() }), ...changes, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      const changed = await recordPriceHistory({
        entityType: "app", entityId: appKey, entityName: changes.appName || before.appName, before: snap.exists ? before : {}, after: { ...before, ...changes }, fields: APP_FIELDS, actor,
      });
      await logAuditEvent({ action: body.action === "addApp" ? "pricing.app_add" : "pricing.app_update", actor, targetType: "appPricing", targetId: appKey, details: { fields: changed } });
      invalidatePricingCache();
      return NextResponse.json({ ok: true, changed });
    }

    if (body.action === "updateSettings") {
      const ref = db.doc("pricingSettings/config");
      const snap = await ref.get();
      const before = snap.exists ? snap.data() : {};
      const input = body.changes || {};
      const changes = {};
      if ("usdRate" in input) {
        const r = Number(input.usdRate);
        if (!Number.isFinite(r) || r <= 0) throw { status: 400, message: "USD rate must be more than 0" };
        changes.usdRate = r;
      }
      if ("maxUsersPerCheckout" in input) {
        const m = Math.floor(Number(input.maxUsersPerCheckout));
        if (!Number.isFinite(m) || m < 1) throw { status: 400, message: "Max users must be at least 1" };
        changes.maxUsersPerCheckout = m;
      }
      await ref.set({ ...changes, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      const changed = await recordPriceHistory({ entityType: "settings", entityId: "config", entityName: "Pricing settings", before, after: { ...before, ...changes }, fields: SETTINGS_FIELDS, actor });
      invalidatePricingCache();
      return NextResponse.json({ ok: true, changed });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
