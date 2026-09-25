// One-off (2026-09-26): final launch pricing + retire the old plans.
//   1. pricingPlans/APP and /SUITE get regular + offer prices and the
//      "Launch Offer" promotion (App ₹999 → ₹599, Suite ₹1,999 → ₹999
//      monthly; annual ₹5,990 / ₹9,990 unchanged). Every changed field is
//      written to pricingHistory, and priceVersion goes up.
//   2. The old Essential/Business/Premium/POS docs in `plans` are archived
//      (active:false, archived:true). Not deleted: they stay as a record.
//   3. Free licenses still pointing at an old plan move to a free Bizzux
//      Suite with a price snapshot, so nothing references `plans` any more.
// Dry run by default; add --apply to write.
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import fs from "fs";

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  let v = fs.readFileSync(".env.local", "utf8").match(/FIREBASE_SERVICE_ACCOUNT=(.*)/)[1].trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
  const creds = JSON.parse(v);
  if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, "\n");
  return creds;
}

const apply = process.argv.includes("--apply");
initializeApp({ credential: cert(loadServiceAccount()) });
const db = getFirestore();
const actor = { changedBy: "script:migrate-launch-pricing", changedByUid: null };

const LAUNCH = {
  APP: {
    monthlyPricePerUser: 999, monthlyOfferPrice: 599, annualPricePerUser: 5990, annualOfferPrice: null,
    promotionEnabled: true, promotionLabel: "Launch Offer", promotionDescription: "",
    promotionStartDate: null, promotionEndDate: null, priceLockMonths: null,
    description: "Choose any one eligible Bizzux application.", badge: "",
  },
  SUITE: {
    monthlyPricePerUser: 1999, monthlyOfferPrice: 999, annualPricePerUser: 9990, annualOfferPrice: null,
    promotionEnabled: true, promotionLabel: "Launch Offer", promotionDescription: "",
    promotionStartDate: null, promotionEndDate: null, priceLockMonths: null,
    badge: "⭐ BEST VALUE",
  },
};

const batch = db.batch();
for (const [code, next] of Object.entries(LAUNCH)) {
  const ref = db.doc("pricingPlans/" + code);
  const cur = (await ref.get()).data() || {};
  const changed = Object.keys(next).filter((k) => JSON.stringify(cur[k] ?? null) !== JSON.stringify(next[k] ?? null));
  console.log(`${code}: ${changed.length ? changed.map((k) => `${k} ${JSON.stringify(cur[k] ?? null)} -> ${JSON.stringify(next[k])}`).join("; ") : "no change"}`);
  if (!changed.length) continue;
  batch.set(ref, { ...next, priceVersion: (Number(cur.priceVersion) || 1) + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  for (const field of changed) {
    batch.set(db.collection("pricingHistory").doc(), {
      entityType: "plan", entityId: code, entityName: cur.planName || code, field,
      previousValue: cur[field] ?? null, newValue: next[field] ?? null, ...actor, changedAt: FieldValue.serverTimestamp(),
    });
  }
}

const oldPlans = await db.collection("plans").get();
for (const d of oldPlans.docs) {
  console.log(`archive old plan ${d.id} (${d.data().name})`);
  batch.set(d.ref, { active: false, archived: true, archivedAt: FieldValue.serverTimestamp(), archivedReason: "Replaced by Bizzux App / Bizzux Suite pricing" }, { merge: true });
}

const suite = (await db.doc("pricingPlans/SUITE").get()).data() || {};
const suiteApps = (await db.collection("appPricing").get()).docs.map((d) => ({ appKey: d.id, ...d.data() }))
  .filter((a) => a.active !== false && a.suiteIncluded).map((a) => a.appKey);
const active = await db.collection("customers").where("status", "==", "active").get();
for (const d of active.docs) {
  const c = d.data();
  if (!c.planId || ["APP", "SUITE"].includes(c.planId)) continue;
  if (c.billing !== "complimentary") {
    console.log(`SKIP paid legacy customer ${d.id} ${c.email} (${c.planName}) — needs a manual decision`);
    continue;
  }
  const qty = Number(c.seats) || 1;
  const snapshot = {
    planCode: "SUITE", planType: "SUITE", planName: suite.planName || "Bizzux Suite", displayName: suite.planName || "Bizzux Suite",
    appKey: null, appKeys: suiteApps, billingCycle: "year", quantity: qty, currency: "INR",
    listUnitPrice: suite.annualPricePerUser ?? null, regularUnitPrice: suite.annualPricePerUser ?? null,
    unitPrice: 0, totalPrice: 0, discountPercent: 100, priceSource: "published",
    promotionApplied: false, promotionLabel: null, priceVersion: Number(suite.priceVersion) || 1,
    priceLockMonths: null, priceLockedUntil: null, couponCode: null, gateway: "complimentary", subscriptionId: null,
    agreedAt: new Date().toISOString(), migratedFrom: { planId: c.planId, planName: c.planName || null },
  };
  console.log(`move free license ${d.id} ${c.email}: ${c.planName} -> Bizzux Suite (free)`);
  batch.set(d.ref, { planId: "SUITE", planName: snapshot.displayName, billingCycle: "year", seats: qty, subscription: snapshot }, { merge: true });
}

if (apply) {
  await batch.commit();
  await db.collection("auditLogs").add({
    action: "pricing.launch_migration", actorUid: null, actorEmail: actor.changedBy, actorRole: "OWNER",
    targetType: "pricingPlan", targetId: null, details: { archivedOldPlans: oldPlans.size }, createdAt: FieldValue.serverTimestamp(),
  });
  console.log("Applied.");
} else {
  console.log("(dry run, nothing written — add --apply)");
}
