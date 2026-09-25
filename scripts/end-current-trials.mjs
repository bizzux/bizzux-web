// One-off (2026-09-26): ends every free trial that is running today, as part
// of moving to phone-verified trials (see app/api/trial/start). Accounts
// keep all their data; their apps lock and they see "Your trial has ended,
// choose a plan". Paid, free-license (complimentary), suspended and closed
// accounts are not touched. A Platform Admin can still extend any one of
// them afterwards from Support / Customers → Extend trial.
//
// Dry run by default (prints what it would change). Add --apply to write.
//   node scripts/end-current-trials.mjs
//   node scripts/end-current-trials.mjs --apply
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import fs from "fs";

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const env = fs.readFileSync(".env.local", "utf8");
  const match = env.match(/FIREBASE_SERVICE_ACCOUNT=(.*)/);
  if (!match) throw new Error("FIREBASE_SERVICE_ACCOUNT not found in .env.local");
  let value = match[1].trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
  const creds = JSON.parse(value);
  if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, "\n");
  return creds;
}

const apply = process.argv.includes("--apply");
// --exclude=a@x.com,b@y.com leaves those accounts' trials running.
const excludeArg = process.argv.find((a) => a.startsWith("--exclude="));
const exclude = new Set((excludeArg ? excludeArg.slice(10).split(",") : []).map((e) => e.trim().toLowerCase()).filter(Boolean));
initializeApp({ credential: cert(loadServiceAccount()) });
const db = getFirestore();
const now = Timestamp.now();

const snap = await db.collection("customers").get();
const targets = snap.docs.filter((d) => {
  const c = d.data();
  if ((c.status || "trial") !== "trial") return false;
  if (c.billing === "complimentary") return false;
  if (exclude.has(String(c.email || "").toLowerCase())) return false;
  const end = c.trialEndDate?.toDate ? c.trialEndDate.toDate() : c.trialEndDate ? new Date(c.trialEndDate) : null;
  // Running (end in the future) or open-ended (no end date at all).
  return !end || end.getTime() > Date.now();
});

console.log(`${targets.length} running trial(s) found${apply ? ", ending now" : " (dry run, nothing written)"}.`);
for (const d of targets) {
  const c = d.data();
  console.log(" -", d.id, c.email || "", c.organizationName || c.companyName || "");
}

if (apply && targets.length) {
  for (let i = 0; i < targets.length; i += 400) {
    const batch = db.batch();
    for (const d of targets.slice(i, i + 400)) {
      batch.set(d.ref, {
        status: "trial",
        trialEndDate: now,
        trialEndedEarlyAt: FieldValue.serverTimestamp(),
        trialEndedReason: "Trial policy change 2026-09-26: trials now require phone verification",
      }, { merge: true });
    }
    await batch.commit();
  }
  await db.collection("auditLogs").add({
    action: "customer.trials_ended_bulk",
    actorUid: null, actorEmail: "script:end-current-trials", actorRole: "OWNER",
    targetType: "organization", targetId: null,
    details: { count: targets.length, ids: targets.map((d) => d.id) },
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log("Done.");
}
