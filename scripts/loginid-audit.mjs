// READ-ONLY dry run for the Bizzux login ID ("first.last@bizzux"): lists existing usernames that can simply gain the suffix and the ones that need a decision.
//   Emulator (default):  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/loginid-audit.mjs
//   Production plan:     node scripts/loginid-audit.mjs --prod --plan      (project id, scope, two count() queries; reads the two collections' SIZES only)
//   Production run:      node scripts/loginid-audit.mjs --prod [--cap N]   (needs approval; field-masked scan of usernames + attUsernames, Auth lookups in batches)
// Every Firestore write method is disabled before anything is queried. Production output contains COUNTS and salted-hash prefixes only: no names, emails,
// uids, hashes, salts, codes or tokens are selected or printed. The read cap aborts the run if the collections are larger than expected.
import { createRequire } from "node:module";
import fs from "node:fs";
import crypto from "node:crypto";
import { analyzeLoginIds } from "../lib/loginIdAudit.js";
const require = createRequire(import.meta.url);
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > -1 ? process.argv[i + 1] : d; };
const PROD = process.argv.includes("--prod"), PLAN = process.argv.includes("--plan");
const CAP = Number(arg("cap", "2000"));
const ENV = arg("env", "C:/Users/rajth/Projects/bizzux-web/.env.local");
const emu = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!emu && !PROD) { console.log("Refusing to touch a real project without --prod (and approval). For the emulator set FIRESTORE_EMULATOR_HOST."); process.exit(1); }
if (emu && PROD) { console.log("Emulator variables are set together with --prod. Unset them first."); process.exit(1); }

const fsLib = require("@google-cloud/firestore");
for (const [cls, methods] of [["DocumentReference", ["set", "update", "delete", "create"]], ["CollectionReference", ["add"]], ["WriteBatch", ["set", "update", "delete", "create", "commit"]], ["Transaction", ["set", "update", "delete", "create"]]]) {
  const C = fsLib[cls]; if (!C) continue;
  for (const m of methods) if (C.prototype[m]) C.prototype[m] = function () { throw new Error(`BLOCKED: ${cls}.${m} is disabled in the read-only audit`); };
}
const admin = require("firebase-admin");
let projectId = process.env.GCLOUD_PROJECT || "demo-bizzux";
if (PROD) {
  try {
    const raw0 = fs.readFileSync(ENV, "utf8").match(/^FIREBASE_SERVICE_ACCOUNT=(.*)$/m)[1].trim();
    const raw = /^['"]/.test(raw0) ? raw0.slice(1, -1) : raw0;
    let sa; try { sa = JSON.parse(raw); } catch { sa = JSON.parse(raw.replace(/\\"/g, '"')); }
    sa.private_key = sa.private_key.replace(/\n/g, "\n");
    projectId = sa.project_id;
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  } catch (e) { console.log("Could not load the credentials (" + (e?.name || "error") + "). Nothing was read."); process.exit(1); }
} else admin.initializeApp({ projectId });
const db = admin.firestore();
let reads = 0;
const spend = (n) => { reads += n; if (reads > CAP) throw new Error(`Read cap ${CAP} reached; aborting. Nothing was written.`); };
const salt = crypto.randomBytes(16).toString("hex");
const h = (v) => crypto.createHash("sha256").update(salt + String(v).toLowerCase()).digest("hex").slice(0, 8);
const count = async (col) => { const n = (await db.collection(col).count().get()).data().count; spend(Math.max(1, Math.ceil(n / 1000))); return n; };

if (PROD) {
  console.log(JSON.stringify({ mode: PLAN ? "PRODUCTION PLAN (sizes only)" : "PRODUCTION READ-ONLY RUN", projectId, writesBlocked: true, readCap: CAP,
    scope: ["usernames: fields uid, organizationId (no hash/salt/code fields)", "attUsernames: fields uid, accountId", "Firebase Auth getUsers by uid, batches of 100 (existence only)"] }));
}
const sizes = { usernames: await count("usernames"), attUsernames: await count("attUsernames") };
const expectedReads = sizes.usernames + sizes.attUsernames;
if (PROD && PLAN) { console.log(JSON.stringify({ sizes, countQueryReads: reads, expectedReadsForFullRun: expectedReads, authLookupsAtMost: expectedReads, wouldAbortIfOver: CAP })); process.exit(0); }
if (expectedReads > CAP) { console.log(JSON.stringify({ sizes, stopped: `Expected ${expectedReads} reads is above the cap ${CAP}. Nothing was scanned.` })); process.exit(2); }

const rows = async (col, ownerField) => { const s = await db.collection(col).select("uid", ownerField).get(); spend(s.size); return s.docs.map((d) => ({ id: d.id, uid: d.get("uid") || "", org: d.get(ownerField) || "" })); };
const portal = await rows("usernames", "organizationId");
const attendance = await rows("attUsernames", "accountId");
const uids = [...new Set([...portal, ...attendance].map((r) => r.uid).filter(Boolean))];
const present = new Set();
for (let i = 0; i < uids.length; i += 100) (await admin.auth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })))).users.forEach((u) => present.add(u.uid));
const report = analyzeLoginIds({ portal, attendance, authUids: present });
if (PROD) { // counts and salted-hash prefixes only
  delete report.sampleReady;
  const hide = (a) => a.map(h);
  report.needDecision = { bothStores: hide(report.needDecision.bothStores), invalidFormat: hide(report.needDecision.invalidFormat),
    uidWithManyNames: report.needDecision.uidWithManyNames.map((x) => ({ names: hide(x.names) })), ...(report.needDecision.noFirebaseUser ? { noFirebaseUser: hide(report.needDecision.noFirebaseUser) } : {}) };
}
const kind = (store, r) => ({ store, uidKind: /^att_/.test(r.uid) ? "attendance-synthetic (att_...)" : "firebase-style", hasOrg: !!r.org });
report.noFirebaseUserDetail = [...portal.map((r) => [kind("usernames", r), r]), ...attendance.map((r) => [kind("attUsernames", r), r])].filter(([, r]) => r.uid && !present.has(r.uid)).map(([k]) => k);
console.log(JSON.stringify({ environment: emu ? "emulator" : "PRODUCTION", projectId, firestoreReads: reads, authLookups: uids.length, report }, null, 2));
