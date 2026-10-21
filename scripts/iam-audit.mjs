// READ-ONLY IAM consistency audit against the real Firestore/Auth project.
//   node scripts/iam-audit.mjs --step A            sizing: a few count() aggregations (about 20 reads)
//   node scripts/iam-audit.mjs --step B [--cap N]  scan + analyse (reads about the sum of the sizes; aborts at --cap, default 60000)
// Safety: every Firestore write method is replaced by a function that throws, before anything is queried; only field-masked reads are issued;
// secrets (hash, salt, pw, recovery, activation, tokens) are never selected; emails and uids are replaced in the output by a salted hash prefix
// (salt exists only in memory for this run). Output goes to a local folder and is never sent anywhere.
import { createRequire } from "node:module";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { analyze, summarize } from "../lib/iamAuditAnalysis.js";

const require = createRequire(import.meta.url);
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > -1 ? process.argv[i + 1] : d; };
const STEP = arg("step", "");
const CAP = Number(arg("cap", "60000"));
const ENV = arg("env", "C:/Users/rajth/Projects/bizzux-web/.env.local");
const OUT = path.join("C:/Users/rajth/Projects/_backups", "iam-audit-" + new Date().toISOString().slice(0, 10));
if (!["A", "B"].includes(STEP)) { console.log("Usage: --step A|B"); process.exit(1); }

const admin = require("firebase-admin");
const fsLib = require("@google-cloud/firestore");

// 1) Make writes impossible. This runs before any client is created.
const BLOCKED = [["DocumentReference", ["set", "update", "delete", "create"]], ["CollectionReference", ["add"]], ["WriteBatch", ["set", "update", "delete", "create", "commit"]], ["Transaction", ["set", "update", "delete", "create", "commit"]], ["Firestore", ["batch", "runTransaction", "bulkWriter", "bulkWriter"]], ["BulkWriter", ["set", "update", "delete", "create"]]];
for (const [cls, methods] of BLOCKED) {
  const C = fsLib[cls]; if (!C) continue;
  for (const m of methods) if (C.prototype[m]) C.prototype[m] = function () { throw new Error(`BLOCKED: ${cls}.${m} is disabled in the read-only audit`); };
}

// 2) Credentials (never printed, never logged).
function credentials() {
  const env = fs.readFileSync(ENV, "utf8");
  const m = env.match(/^FIREBASE_SERVICE_ACCOUNT=(.*)$/m);
  let raw = m[1].trim(); if (/^['"]/.test(raw)) raw = raw.slice(1, -1);
  let sa; try { sa = JSON.parse(raw); } catch { sa = JSON.parse(raw.replace(/\\"/g, '"')); }
  sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  return sa;
}
let db, auth;
try { admin.initializeApp({ credential: admin.credential.cert(credentials()) }); db = admin.firestore(); auth = admin.auth(); }
catch (e) { console.log("Could not start (" + (e?.name || "error") + "). Nothing was read."); process.exit(1); }

if (process.argv.includes("--selftest")) { try { db.doc("a/b").set({}); console.log("WRITE NOT BLOCKED"); process.exit(2); } catch (e) { console.log(String(e.message).startsWith("BLOCKED") ? "selftest ok: writes are blocked (" + e.message + ")" : "selftest odd: " + e.message); process.exit(0); } } // BLOCKED check

let reads = 0;
const spend = (n) => { reads += n; if (reads > CAP) throw new Error(`Read cap ${CAP} reached; aborting. Nothing was written.`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const salt = crypto.randomBytes(16).toString("hex");
const h = (v) => (v ? crypto.createHash("sha256").update(salt + String(v).toLowerCase()).digest("hex").slice(0, 8) : "");

async function count(q) { const r = await q.count().get(); const n = r.data().count; spend(Math.max(1, Math.ceil(n / 1000))); return n; }
async function scan(q, fields, map) {
  const rows = []; let last = null;
  for (;;) {
    let page = q.select(...fields).orderBy(admin.firestore.FieldPath.documentId()).limit(500);
    if (last) page = page.startAfter(last);
    const snap = await page.get(); spend(snap.size);
    for (const d of snap.docs) rows.push(map(d));
    if (snap.size < 500) break; last = snap.docs[snap.size - 1]; await sleep(150);
  }
  return rows;
}
// subcollections: try one collection-group scan, else fall back to one query per company.
async function groupScan(name, fields, map, companyIds) {
  try { return await scan(db.collectionGroup(name), fields, map); }
  catch (e) {
    if (/blocked|cap/i.test(e.message)) throw e;
    const rows = [];
    for (const id of companyIds) rows.push(...(await scan(db.collection("customers").doc(id).collection(name), fields, map)));
    return rows;
  }
}

fs.mkdirSync(OUT, { recursive: true });
const SIZES = path.join(OUT, "sizes.json");

if (STEP === "A") {
  const names = ["customers", "memberships", "organizationMemberships", "appAssignments", "organizationAppSubscriptions", "usernames", "attUsernames", "users", "linkRequests", "invites"];
  const sizes = {};
  for (const n of names) sizes[n] = await count(db.collection(n));
  for (const g of ["team", "attEmployees"]) { try { sizes["group:" + g] = await count(db.collectionGroup(g)); } catch { sizes["group:" + g] = null; } }
  let authUsers = 0, tok; do { const r = await auth.listUsers(1000, tok); authUsers += r.users.length; tok = r.pageToken; } while (tok);
  sizes.authUsers = authUsers;
  fs.writeFileSync(SIZES, JSON.stringify({ at: new Date().toISOString(), readsUsed: reads, sizes }, null, 2));
  const firestoreDocs = Object.entries(sizes).filter(([k]) => !["authUsers", "users", "linkRequests", "invites"].includes(k)).reduce((a, [, v]) => a + (v || 0), 0);
  console.log(JSON.stringify({ readsUsed: reads, sizes, estimatedStepBReads: firestoreDocs + (sizes.customers || 0), note: "Step B reads about one document per row above (team and attEmployees via collection-group scans)." }, null, 2));
  process.exit(0);
}

// STEP B
if (!fs.existsSync(SIZES)) { console.log("Run --step A first."); process.exit(1); }
const sizes = JSON.parse(fs.readFileSync(SIZES, "utf8")).sizes;
const est = ["customers", "memberships", "organizationMemberships", "appAssignments", "organizationAppSubscriptions", "usernames", "attUsernames"].reduce((a, k) => a + (sizes[k] || 0), 0) + (sizes["group:team"] || 0) + (sizes["group:attEmployees"] || 0);
console.log(`Estimated reads: ${est} (cap ${CAP})`);
if (est > CAP) { console.log("Estimate exceeds the cap; raise --cap deliberately to continue."); process.exit(1); }

const customers = await scan(db.collection("customers"), ["status", "multiOrg"], (d) => ({ id: d.id, status: d.get("status") || "", multiOrg: !!d.get("multiOrg") }));
const ids = customers.map((c) => c.id);
const memberships = await scan(db.collection("memberships"), ["accountId", "profile", "status", "multiOrg"], (d) => ({ uid: d.id, accountId: d.get("accountId") || "", profile: d.get("profile") || "", status: d.get("status") || "", multiOrg: !!d.get("multiOrg") }));
const orgMemberships = await scan(db.collection("organizationMemberships"), ["organizationId", "userId", "role", "status", "profile"], (d) => ({ id: d.id, organizationId: d.get("organizationId") || "", userId: d.get("userId") || "", role: d.get("role") || "", status: d.get("status") || "", profile: d.get("profile") || "" }));
const assignments = await scan(db.collection("appAssignments"), ["organizationId", "userId", "appId", "role", "status"], (d) => ({ id: d.id, organizationId: d.get("organizationId") || "", userId: d.get("userId") || "", appId: d.get("appId") || "", role: d.get("role") || "", status: d.get("status") || "" }));
const subs = await scan(db.collection("organizationAppSubscriptions"), ["organizationId", "appId", "status"], (d) => ({ organizationId: d.get("organizationId") || "", appId: d.get("appId") || "", status: d.get("status") || "" }));
const usernames = await scan(db.collection("usernames"), ["uid", "organizationId", "disabled"], (d) => ({ name: d.id, uid: d.get("uid") || "", organizationId: d.get("organizationId") || "", disabled: !!d.get("disabled") }));
const attUsernames = await scan(db.collection("attUsernames"), ["uid", "accountId", "status"], (d) => ({ name: d.id, uid: d.get("uid") || "", accountId: d.get("accountId") || "", status: d.get("status") || "" }));
const team = await groupScan("team", ["uid", "profile", "status"], (d) => ({ org: d.ref.parent.parent.id, id: d.id, uid: d.get("uid") || "", profile: d.get("profile") || "", status: d.get("status") || "" }), ids);
const employees = await groupScan("attEmployees", ["userId", "loginUsername", "status", "organizationId"], (d) => ({ org: d.ref.parent.parent.id, id: d.id, userId: d.get("userId") || "", loginUsername: d.get("loginUsername") || "", status: d.get("status") || "", organizationId: d.get("organizationId") || d.ref.parent.parent.id }), ids);
const authUsers = []; let tok; do { const r = await auth.listUsers(1000, tok); for (const u of r.users) authUsers.push({ uid: u.uid, email: u.email || "", providers: u.providerData.map((p) => p.providerId), disabled: u.disabled }); tok = r.pageToken; } while (tok);

const findings = analyze({ customers, memberships, orgMemberships, assignments, subs, usernames, attUsernames, team, employees, authUsers });
const summary = { at: new Date().toISOString(), readsUsed: reads, cap: CAP, counts: { customers: customers.length, memberships: memberships.length, orgMemberships: orgMemberships.length, assignments: assignments.length, subs: subs.length, usernames: usernames.length, attUsernames: attUsernames.length, team: team.length, employees: employees.length, authUsers: authUsers.length }, findings: summarize(findings) };
const csv = ["code,org,user,detail", ...findings.map((f) => [f.code, f.org ? "org#" + h(f.org) : "", f.user ? "u#" + h(f.user) : "", '"' + f.detail.replace(/"/g, "'") + '"'].join(","))].join("\n");
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(OUT, "findings.csv"), csv);
console.log(JSON.stringify(summary, null, 2));
