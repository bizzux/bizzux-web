// SERVER ONLY. Firestore I/O for the Cost & Usage dashboard — see
// lib/costAnalytics.js for the data-flow overview and all the pure maths.
//
// Collections (Admin SDK only; never exposed to clients):
//   usageDaily/{YYYY-MM-DD}_{organizationId}   one doc per tenant per day
//   costAnalyticsDaily/{YYYY-MM-DD}            one platform-wide doc per day
//   platformFinance/costRates                  optional Owner-edited rate card
import { adminDb } from "./firebaseAdmin";
import { isPayingCustomer } from "./trial";
import { snapshotMonthlyValue } from "./pricingMath";
import { MODULES, MODULE_KEYS, APP_KEYS, SERVICE_UNIT_KEYS, dateKey, isDateKey, mergeRates, normUsage, buildDayAnalytics, dateRange, addDays } from "./costAnalytics";

export const usageDocId = (date, orgId) => `${date}_${orgId}`;

const MAX_EVENTS = 500;
const MAX_USER_IDS = 1000;
const cap = (v, max = 1e9) => Math.min(max, Math.max(0, Math.floor(Number(v) || 0)));

// Folds a batch of usage events for ONE organization into its daily docs.
// event: { date?, userId?, module?, app?, transactions?, reads?, writes?, deletes?, storageGB?,
//          service?, units? }   service: aiTokens | ocrPages | smsCount | whatsappCount | emailCount |
//          authOps | fileUploads | fileDownloads | apiCalls | egressGB(GB); `units` is how many.
// `transactions` defaults to 1 so a plain "a sale happened" ping is enough.
// Reads/writes are the Firestore operations the app itself performed on the
// tenant's behalf. Runs in a transaction so activeUsers (a unique count)
// stays exact; one transaction per touched day, normally just today's.
export async function recordUsage(orgId, events) {
  if (!orgId || /[\/\s]/.test(orgId)) throw { status: 400, message: "Invalid organizationId" };
  if (!Array.isArray(events) || events.length === 0) throw { status: 400, message: "No events" };
  if (events.length > MAX_EVENTS) throw { status: 400, message: `At most ${MAX_EVENTS} events per request` };

  const today = dateKey();
  const byDate = new Map();
  for (const ev of events) {
    // "other" (or no module) = org-wide Firestore ops not owned by one module
    // (settings, shops, staff...): counted in the org totals, not in any module.
    const mod = String(ev.module || "other");
    if (mod !== "other" && !MODULE_KEYS.includes(mod)) throw { status: 400, message: "Unknown module: " + mod };
    const date = ev.date ? String(ev.date) : today;
    // Late events are fine for a few days (offline devices syncing); the future is not.
    if (!isDateKey(date) || date > today || date < addDays(today, -7)) throw { status: 400, message: "Bad event date: " + date };
    const app = ev.app ? String(ev.app) : null;
    if (app && !APP_KEYS.includes(app)) throw { status: 400, message: "Unknown app: " + app };
    const service = ev.service ? String(ev.service) : null;
    if (service && !SERVICE_UNIT_KEYS.includes(service)) throw { status: 400, message: "Unknown service: " + service };
    const d = byDate.get(date) || { tx: {}, reads: 0, writes: 0, deletes: 0, modReads: {}, modWrites: {}, users: new Set(), storageGB: 0, svc: {}, appOps: {}, appSvc: {} };
    const tx = ev.transactions === undefined ? 1 : cap(ev.transactions, 1e7);
    const r = cap(ev.reads), w = cap(ev.writes);
    d.reads += r; d.writes += w; d.deletes += cap(ev.deletes);
    if (mod !== "other") {
      d.tx[mod] = (d.tx[mod] || 0) + tx;
      d.modReads[mod] = (d.modReads[mod] || 0) + r;
      d.modWrites[mod] = (d.modWrites[mod] || 0) + w;
    }
    if (app) {
      const a = (d.appOps[app] ||= { tx: 0, reads: 0, writes: 0 });
      a.reads += r; a.writes += w;
      if (mod !== "other") a.tx += tx;
    }
    if (service) {
      const units = Math.min(1e10, Math.max(0, Number(ev.units) || 0));
      d.svc[service] = (d.svc[service] || 0) + units;
      if (app) { const as = (d.appSvc[app] ||= {}); as[service] = (as[service] || 0) + units; }
    }
    if (ev.userId) d.users.add(String(ev.userId).slice(0, 128));
    d.storageGB = Math.max(d.storageGB, Math.min(1e6, Number(ev.storageGB) || 0));
    byDate.set(date, d);
  }

  const db = adminDb();
  for (const [date, d] of byDate) {
    const ref = db.collection("usageDaily").doc(usageDocId(date, orgId));
    await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const cur = snap.exists ? snap.data() : {};
      const ids = new Set(Array.isArray(cur.activeUserIds) ? cur.activeUserIds : []);
      d.users.forEach((u) => ids.size < MAX_USER_IDS && ids.add(u));
      const out = {
        date,
        organizationId: orgId,
        activeUsers: ids.size,
        activeUserIds: [...ids],
        firestoreReads: (Number(cur.firestoreReads) || 0) + d.reads,
        firestoreWrites: (Number(cur.firestoreWrites) || 0) + d.writes,
        firestoreDeletes: (Number(cur.firestoreDeletes) || 0) + d.deletes,
        moduleReads: { ...(cur.moduleReads || {}) },
        moduleWrites: { ...(cur.moduleWrites || {}) },
        storageGB: Math.max(Number(cur.storageGB) || 0, d.storageGB),
        serviceUnits: { ...(cur.serviceUnits || {}) },
        appOps: { ...(cur.appOps || {}) },
        appServiceUnits: { ...(cur.appServiceUnits || {}) },
        updatedAt: new Date(),
      };
      for (const [k, v] of Object.entries(d.svc)) out.serviceUnits[k] = (Number(out.serviceUnits[k]) || 0) + v;
      for (const [app, o] of Object.entries(d.appOps)) {
        const c = out.appOps[app] || {};
        out.appOps[app] = { tx: (Number(c.tx) || 0) + o.tx, reads: (Number(c.reads) || 0) + o.reads, writes: (Number(c.writes) || 0) + o.writes };
      }
      for (const [app, units] of Object.entries(d.appSvc)) {
        const c = { ...(out.appServiceUnits[app] || {}) };
        for (const [k, v] of Object.entries(units)) c[k] = (Number(c[k]) || 0) + v;
        out.appServiceUnits[app] = c;
      }
      let total = 0;
      for (const m of MODULES) {
        const add = d.tx[m.key] || 0;
        out[m.field] = (Number(cur[m.field]) || 0) + add;
        total += out[m.field];
        if (d.modReads[m.key]) out.moduleReads[m.key] = (Number(out.moduleReads[m.key]) || 0) + d.modReads[m.key];
        if (d.modWrites[m.key]) out.moduleWrites[m.key] = (Number(out.moduleWrites[m.key]) || 0) + d.modWrites[m.key];
      }
      out.transactions = total;
      t.set(ref, out, { merge: true });
    });
  }
  return { ok: true, days: byDate.size };
}

export async function loadRates() {
  const snap = await adminDb().doc("platformFinance/costRates").get();
  return mergeRates(snap.exists ? snap.data() : null);
}

// The tenant registry (customers/{organizationId}) — NOT a transactional
// collection, and only the handful of fields needed are fetched.
export async function loadTenants() {
  const snap = await adminDb().collection("customers").select("organizationName", "companyName", "email", "status", "billing", "planId", "planName", "subscription").get();
  const tenants = new Map();
  for (const d of snap.docs) {
    const c = d.data();
    const paying = isPayingCustomer(c);
    tenants.set(d.id, {
      name: c.organizationName || c.companyName || c.email || d.id,
      plan: c.subscription?.displayName || c.subscription?.planName || c.planName || (c.billing === "complimentary" ? "Free license" : c.planId || "Trial"),
      status: c.billing === "complimentary" ? "complimentary" : c.status || "trial",
      users: Number(c.subscription?.quantity) || 0,
      paying,
      monthlyRevenue: paying ? snapshotMonthlyValue(c.subscription) : 0,
    });
  }
  return tenants;
}

// Date-ranged reads of the two aggregate collections.
export async function loadRange(from, to) {
  const db = adminDb();
  const [u, c] = await Promise.all([
    db.collection("usageDaily").where("date", ">=", from).where("date", "<=", to).get(),
    db.collection("costAnalyticsDaily").where("date", ">=", from).where("date", "<=", to).get(),
  ]);
  const usageByDate = new Map();
  for (const d of u.docs) {
    const row = normUsage(d.data());
    if (!usageByDate.has(row.date)) usageByDate.set(row.date, []);
    usageByDate.get(row.date).push(row);
  }
  const days = new Map(c.docs.map((d) => [d.data().date, d.data()]));
  return { usageByDate, days };
}

// (Re)builds costAnalyticsDaily docs for the given dates from data already
// loaded by loadRange — no extra reads. Today is always rebuilt (it is still
// accumulating); past days are only built when missing, unless `force`.
// Writes are best-effort: the dashboard still renders if one fails.
export async function materializeDays(dates, usageByDate, days, rates, tenants, { force = false } = {}) {
  const today = dateKey();
  let mrr = 0;
  for (const t of tenants.values()) if (t.paying) mrr += t.monthlyRevenue;
  const db = adminDb();
  const writes = [];
  for (const date of dates) {
    const rows = usageByDate.get(date) || [];
    const existing = days.get(date) || null;
    // Late events may still land on the last week (offline devices syncing).
    const settled = date < addDays(today, -7);
    if (existing && settled && !force) continue;
    if (!existing && rows.length === 0 && date !== today) continue; // nothing happened, no doc
    const doc = buildDayAnalytics(date, rows, rates, mrr / 30, existing);
    days.set(date, doc);
    // Skip the write when a recent day hasn't actually changed.
    if (existing && !force && existing.totalCloudCost === doc.totalCloudCost && existing.transactions === doc.transactions && existing.firestoreReads === doc.firestoreReads) continue;
    writes.push(db.collection("costAnalyticsDaily").doc(date).set({ ...doc, updatedAt: new Date() }, { merge: true }).catch(() => {}));
  }
  await Promise.all(writes);
  return writes.length;
}

export { dateRange };
