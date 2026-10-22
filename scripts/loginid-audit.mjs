// READ-ONLY dry run for the Bizzux login ID ("first.last@bizzux"): lists existing usernames that can simply gain the suffix and the ones that need a decision.
//   Emulator (default):  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/loginid-audit.mjs
//   Production:          needs --prod AND an explicit approval first; reads usernames + attUsernames once (field-masked, no hashes) and checks Auth in batches of 100.
// Every Firestore write method is disabled before anything is queried. Names are printed only as counts or short samples; no secrets are ever selected.
import { createRequire } from "node:module";
import { analyzeLoginIds } from "../lib/loginIdAudit.js";
const require = createRequire(import.meta.url);
const PROD = process.argv.includes("--prod");
const emu = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!emu && !PROD) { console.log("Refusing to touch a real project without --prod (and approval). For the emulator set FIRESTORE_EMULATOR_HOST."); process.exit(1); }
const fsLib = require("@google-cloud/firestore");
for (const [cls, methods] of [["DocumentReference", ["set", "update", "delete", "create"]], ["CollectionReference", ["add"]], ["WriteBatch", ["set", "update", "delete", "create", "commit"]], ["Transaction", ["set", "update", "delete", "create"]]]) {
  const C = fsLib[cls]; if (!C) continue;
  for (const m of methods) if (C.prototype[m]) C.prototype[m] = function () { throw new Error(`BLOCKED: ${cls}.${m} is disabled in the read-only audit`); };
}
const admin = require("firebase-admin");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-bizzux" });
const db = admin.firestore();
let reads = 0;
const rows = async (col, ownerField) => { const s = await db.collection(col).select("uid", ownerField).get(); reads += s.size; return s.docs.map((d) => ({ id: d.id, uid: d.get("uid") || "", org: d.get(ownerField) || "" })); };
const portal = await rows("usernames", "organizationId");
const attendance = await rows("attUsernames", "accountId");
const uids = [...new Set([...portal, ...attendance].map((r) => r.uid).filter(Boolean))];
const present = new Set();
for (let i = 0; i < uids.length; i += 100) (await admin.auth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })))).users.forEach((u) => present.add(u.uid));
console.log(JSON.stringify({ environment: emu ? "emulator" : "PRODUCTION", firestoreReads: reads, authLookups: uids.length, report: analyzeLoginIds({ portal, attendance, authUids: present }) }, null, 2));
