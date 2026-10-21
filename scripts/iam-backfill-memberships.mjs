// Canonical-membership backfill. Additive and reversible: creates missing organizationMemberships/{org}_{uid} records and fills absent
// bookkeeping fields (profile, schemaVersion, source). Never overwrites a present value, never deletes, never links identities by email.
//   node scripts/iam-backfill-memberships.mjs                       dry run: reads, prints the plan, writes plan.json (no Firestore writes)
//   node scripts/iam-backfill-memberships.mjs --apply               writes the journal FIRST, then applies in small batches
//   node scripts/iam-backfill-memberships.mjs --rollback <journal>  undoes exactly what that journal created / filled
// Options: --env <path to .env.local>, --out <folder>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { planBackfill, planRollback } from "../lib/iamMembershipPlan.js";

const require = createRequire(import.meta.url);
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > -1 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes("--apply");
const ROLLBACK = arg("rollback", "");
const ENV = arg("env", "C:/Users/rajth/Projects/bizzux-web/.env.local");
const OUT = arg("out", "C:/Users/rajth/Projects/_backups/iam-backfill-" + new Date().toISOString().replace(/[:.]/g, "-"));
const admin = require("firebase-admin");

function credentials() {
  const m = fs.readFileSync(ENV, "utf8").match(/^FIREBASE_SERVICE_ACCOUNT=(.*)$/m);
  let raw = m[1].trim(); if (/^['"]/.test(raw)) raw = raw.slice(1, -1);
  let sa; try { sa = JSON.parse(raw); } catch { sa = JSON.parse(raw.replace(/\\"/g, '"')); }
  sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  return sa;
}
let sa;
try { sa = credentials(); admin.initializeApp({ credential: admin.credential.cert(sa) }); } catch (e) { console.log("Could not start (" + (e?.name || "error") + "). Nothing was read or written."); process.exit(1); }
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let reads = 0, writes = 0;
console.log("Project:", sa.project_id, process.env.FIRESTORE_EMULATOR_HOST ? "(EMULATOR)" : "(PRODUCTION)", "mode:", ROLLBACK ? "rollback" : APPLY ? "APPLY" : "dry-run");

async function all(coll, fields, map) {
  const rows = []; let last = null;
  for (;;) {
    let q = db.collection(coll).select(...fields).orderBy(admin.firestore.FieldPath.documentId()).limit(500);
    if (last) q = q.startAfter(last);
    const s = await q.get(); reads += s.size;
    for (const d of s.docs) rows.push(map(d));
    if (s.size < 500) break; last = s.docs[s.size - 1]; await sleep(100);
  }
  return rows;
}
async function teamRows(ids) {
  const rows = [];
  for (const id of ids) { const s = await db.collection("customers").doc(id).collection("team").select("uid", "profile", "disabled", "status").get(); reads += s.size; for (const d of s.docs) rows.push({ org: id, id: d.id, uid: d.get("uid") || "", profile: d.get("profile") || "", disabled: !!d.get("disabled"), status: d.get("status") || "" }); }
  return rows;
}

fs.mkdirSync(OUT, { recursive: true });

if (ROLLBACK) {
  const journal = JSON.parse(fs.readFileSync(ROLLBACK, "utf8")).ops;
  const current = new Map();
  for (const j of journal) { const s = await db.collection("organizationMemberships").doc(j.id).get(); reads++; if (s.exists) current.set(j.id, s.data()); }
  const undo = planRollback(journal, current);
  console.log("Rollback plan:", undo.reduce((a, u) => ((a[u.type] = (a[u.type] || 0) + 1), a), {}));
  if (!APPLY) { console.log("Dry run. Add --apply to roll back."); process.exit(0); }
  for (const u of undo) {
    const ref = db.collection("organizationMemberships").doc(u.id);
    if (u.type === "delete") await ref.delete();
    if (u.type === "unfill") await ref.update(Object.fromEntries(u.fields.map((f) => [f, FV.delete()])));
    if (u.type !== "skip") writes++;
  }
  console.log("Rolled back. writes:", writes, "reads:", reads);
  process.exit(0);
}

const customers = await all("customers", ["status"], (d) => ({ id: d.id, status: d.get("status") || "" }));
const memberships = await all("memberships", ["accountId", "profile", "status"], (d) => ({ uid: d.id, accountId: d.get("accountId") || "", profile: d.get("profile") || "", status: d.get("status") || "" }));
const orgMemberships = await all("organizationMemberships", ["organizationId", "userId", "role", "status", "profile", "schemaVersion", "source"], (d) => ({ id: d.id, organizationId: d.get("organizationId") || "", userId: d.get("userId") || "", role: d.get("role") || "", status: d.get("status") || "", profile: d.get("profile") || "", schemaVersion: d.get("schemaVersion") || 0, source: d.get("source") || "" }));
const team = await teamRows(customers.map((c) => c.id));
const { ops, skipped } = planBackfill({ customers, memberships, team, orgMemberships });
const counts = ops.reduce((a, o) => ((a[o.type] = (a[o.type] || 0) + 1), a), {});
console.log("Plan:", counts, "skipped:", skipped.length, "reads so far:", reads);
fs.writeFileSync(path.join(OUT, "plan.json"), JSON.stringify({ at: new Date().toISOString(), project: sa.project_id, counts, skipped, ops }, null, 2));
if (!APPLY) { console.log("Dry run only. Plan saved to", OUT); process.exit(0); }

// Journal FIRST (before-images for fills, intended data for creates), then apply.
const before = new Map(orgMemberships.map((m) => [m.id, m]));
const journal = { at: new Date().toISOString(), project: sa.project_id, ops: ops.map((o) => (o.type === "fill" ? { ...o, before: Object.fromEntries(Object.keys(o.fields).map((k) => [k, before.get(o.id)?.[k] ?? null])) } : o)) };
const journalPath = path.join(OUT, "journal.json");
fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
console.log("Journal written:", journalPath);
for (let i = 0; i < ops.length; i += 25) {
  const batch = db.batch();
  for (const o of ops.slice(i, i + 25)) {
    const ref = db.collection("organizationMemberships").doc(o.id);
    if (o.type === "create") batch.create(ref, { ...o.data, createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() });
    else batch.update(ref, o.fields);
  }
  await batch.commit(); writes += Math.min(25, ops.length - i); await sleep(150);
}
console.log("Applied. writes:", writes, "reads:", reads, "rollback with: --rollback", journalPath);
