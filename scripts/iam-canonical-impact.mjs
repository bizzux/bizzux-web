// READ-ONLY: on real data, which logins would the canonical-membership fallback (lib/iamCanonical.js) newly let in, i.e. have no owner record and no
// legacy memberships/{uid} but do have a usable canonical record? Writes are blocked at runtime; only counts and hashed ids are printed.
import { createRequire } from "node:module";
import fs from "node:fs";
import crypto from "node:crypto";
import { pickCanonical } from "../lib/iamCanonical.js";

const require = createRequire(import.meta.url);
const admin = require("firebase-admin");
const fsLib = require("@google-cloud/firestore");
const BLOCKED = [["DocumentReference", ["set", "update", "delete", "create"]], ["CollectionReference", ["add"]], ["WriteBatch", ["set", "update", "delete", "create", "commit"]], ["Transaction", ["set", "update", "delete", "create", "commit"]], ["Firestore", ["batch", "runTransaction", "bulkWriter"]]];
for (const [cls, methods] of BLOCKED) for (const m of methods) if (fsLib[cls]?.prototype[m]) fsLib[cls].prototype[m] = function () { throw new Error("BLOCKED: read-only script"); };

const env = fs.readFileSync(process.argv[2] || "C:/Users/rajth/Projects/bizzux-web/.env.local", "utf8");
let raw = env.match(/^FIREBASE_SERVICE_ACCOUNT=(.*)$/m)[1].trim(); if (/^['"]/.test(raw)) raw = raw.slice(1, -1);
let sa; try { sa = JSON.parse(raw); } catch { sa = JSON.parse(raw.replace(/\\"/g, '"')); }
sa.private_key = sa.private_key.replace(/\\n/g, "\n");
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore(); let reads = 0;
const all = async (c, f) => { const s = await db.collection(c).select(...f).get(); reads += s.size; return s.docs; };
const customers = await all("customers", ["status"]);
const legacy = new Set((await all("memberships", [])).map((d) => d.id));
const oms = (await all("organizationMemberships", ["organizationId", "userId", "role", "status", "profile", "source", "createdAt", "updatedAt"])).map((d) => d.data());
const owners = new Set(customers.map((d) => d.id));
const okCo = new Map(customers.map((d) => [d.id, !["suspended", "closed"].includes(d.get("status") || "")]));
const salt = crypto.randomBytes(8).toString("hex");
const h = (v) => crypto.createHash("sha256").update(salt + v).digest("hex").slice(0, 6);

const byUser = new Map(); for (const m of oms) { if (!byUser.has(m.userId)) byUser.set(m.userId, []); byUser.get(m.userId).push(m); }
const newly = [];
for (const [uid, rows] of byUser) {
  if (owners.has(uid) || legacy.has(uid)) continue; // already resolves today; the fallback never overrides them
  const pick = pickCanonical(uid, rows, (id) => okCo.get(id) === true);
  if (pick) newly.push({ u: h(uid), org: h(pick.organizationId), role: pick.role, profile: pick.profile || "(none)", source: pick.source || "(none)", created: pick.createdAt?.toDate?.().toISOString?.().slice(0, 10) || "(none)", updated: pick.updatedAt?.toDate?.().toISOString?.().slice(0, 10) || "(none)" });
}
const skipped = [...byUser].filter(([uid]) => !owners.has(uid) && !legacy.has(uid)).length - newly.length;
console.log(JSON.stringify({ readsUsed: reads, canonicalRows: oms.length, usersWithOnlyCanonical: newly.length + skipped, wouldNewlyResolve: newly.length, rejectedByRules: skipped, newlyResolved: newly, elevated: newly.filter((n) => n.role !== "MEMBER" && n.role !== "VIEWER").length }, null, 2));
