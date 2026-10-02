// SERVER ONLY. Pulls ACTUAL Google Cloud cost from the Cloud Billing export
// in BigQuery (the source of truth) into costAnalyticsDaily/{date}.billingActual,
// which lib/costAnalytics.js then prefers over the usage-based estimate.
//
// Turned on by one env var, so nothing here runs until billing export exists:
//   BILLING_BQ_TABLE        fully-qualified export table, e.g.
//                           my-proj.billing_export.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX
//   BILLING_BQ_PROJECT_IDS  optional, comma-separated GCP project ids to count
//                           (a billing account is often shared by several projects)
//
// The server's Firebase service account needs BigQuery Job User on the
// project that runs the query and BigQuery Data Viewer on the dataset.
// Uses the BigQuery REST API with that same service account — no extra
// dependency.
import { getApps } from "firebase-admin/app";
import { adminDb } from "./firebaseAdmin";
import { addDays, dateRange } from "./costAnalytics";

export function billingConfigured() {
  return !!process.env.BILLING_BQ_TABLE;
}

// Billing service/SKU -> dashboard bucket. Network is SKU-based because
// egress is billed under many services.
export function bucketOf(service, sku) {
  const sv = String(service || "").toLowerCase();
  const sk = String(sku || "").toLowerCase();
  if (/network|egress|data transfer|cdn/.test(sk)) return "networkCost";
  if (/firestore|datastore/.test(sv)) return "firestoreCost";
  if (/cloud functions|cloud run|cloudfunctions/.test(sv)) return "functionsCost";
  if (/cloud storage|firebase storage/.test(sv)) return "storageCost";
  if (/firebase hosting|hosting/.test(sv)) return "hostingCost";
  return "otherCost";
}

async function accessToken() {
  const app = getApps()[0];
  const tok = await app?.options?.credential?.getAccessToken?.();
  if (!tok?.access_token) throw new Error("No Google access token from the service account");
  return tok.access_token;
}

async function runQuery(sql, params) {
  const table = process.env.BILLING_BQ_TABLE;
  const projectId = table.split(".")[0]; // job runs in the export's project
  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
    method: "POST",
    headers: { Authorization: "Bearer " + (await accessToken()), "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, useLegacySql: false, parameterMode: "NAMED", queryParameters: params, timeoutMs: 45000 }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "BigQuery error " + res.status);
  if (!data.jobComplete) throw new Error("BigQuery query timed out");
  return (data.rows || []).map((r) => r.f.map((c) => c.v));
}

// Syncs [from, to] (IST dates). Returns { days, currency, lastBillingUpdate }.
export async function syncBilling(from, to) {
  if (!billingConfigured()) throw { status: 400, message: "Billing export is not configured (BILLING_BQ_TABLE)" };
  const table = process.env.BILLING_BQ_TABLE.replace(/[^A-Za-z0-9_.\-]/g, "");
  const projects = (process.env.BILLING_BQ_PROJECT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const sql = `
    SELECT FORMAT_DATE('%Y-%m-%d', DATE(usage_start_time, 'Asia/Kolkata')) AS d,
           service.description AS svc, sku.description AS sku, currency,
           SUM(cost + IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS cost,
           FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', MAX(export_time)) AS exported
    FROM \`${table}\`
    WHERE DATE(usage_start_time, 'Asia/Kolkata') BETWEEN @from AND @to
      ${projects.length ? "AND project.id IN UNNEST(@projects)" : ""}
    GROUP BY d, svc, sku, currency`;
  const params = [
    { name: "from", parameterType: { type: "DATE" }, parameterValue: { value: from } },
    { name: "to", parameterType: { type: "DATE" }, parameterValue: { value: to } },
  ];
  if (projects.length) params.push({ name: "projects", parameterType: { type: "ARRAY", arrayType: { type: "STRING" } }, parameterValue: { arrayValues: projects.map((v) => ({ value: v })) } });

  const rows = await runQuery(sql, params);
  const perDay = new Map();
  let currency = "INR", lastUpdate = null;
  for (const [d, svc, sku, cur, cost, exported] of rows) {
    currency = cur || currency;
    if (exported && (!lastUpdate || exported > lastUpdate)) lastUpdate = exported;
    const day = perDay.get(d) || { firestoreCost: 0, functionsCost: 0, storageCost: 0, networkCost: 0, hostingCost: 0, otherCost: 0, currency, exported: null };
    day[bucketOf(svc, sku)] += Number(cost) || 0;
    if (exported && (!day.exported || exported > day.exported)) day.exported = exported;
    perDay.set(d, day);
  }
  const db = adminDb();
  const writes = [];
  for (const [d, day] of perDay) {
    const { exported, ...billingActual } = day;
    for (const k of Object.keys(billingActual)) if (typeof billingActual[k] === "number") billingActual[k] = Math.round(billingActual[k] * 10000) / 10000;
    writes.push(db.collection("costAnalyticsDaily").doc(d).set({ date: d, billingActual, lastBillingUpdate: exported, updatedAt: new Date() }, { merge: true }));
  }
  await Promise.all(writes);
  await db.doc("platformFinance/billingSync").set({ lastSyncAt: new Date(), lastBillingUpdate: lastUpdate, currency, days: perDay.size, error: null }, { merge: true });
  return { days: perDay.size, currency, lastBillingUpdate: lastUpdate };
}

export async function recordSyncError(message) {
  await adminDb().doc("platformFinance/billingSync").set({ lastSyncAt: new Date(), error: String(message).slice(0, 300) }, { merge: true }).catch(() => {});
}

export async function loadSyncStatus() {
  const snap = await adminDb().doc("platformFinance/billingSync").get();
  const d = snap.exists ? snap.data() : {};
  return {
    configured: billingConfigured(),
    lastSyncAt: d.lastSyncAt?.toDate ? d.lastSyncAt.toDate().toISOString() : null,
    lastBillingUpdate: d.lastBillingUpdate || null,
    currency: d.currency || "INR",
    error: d.error || null,
  };
}

export { addDays, dateRange };
