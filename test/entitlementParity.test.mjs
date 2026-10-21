// The portal's entitlement rule equals the apps' rule: non-owners need an ACTIVE subscription AND an ACTIVE assignment AND an active membership.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.GCLOUD_PROJECT = "demo-bizzux";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", project_id: "demo-bizzux", private_key: privateKey, client_email: "t@demo-bizzux.iam.gserviceaccount.com" });
assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "emulators only");
const { appEntitlementDenial } = await import("../lib/appAccess.js");
const { adminDb } = await import("../lib/firebaseAdmin.js");
const db = adminDb(); const R = Math.random().toString(36).slice(2, 7); const org = "o" + R;
const sub = (app, status) => db.doc(`organizationAppSubscriptions/${org}_${app}`).set({ organizationId: org, appId: app, status });
const asg = (uid, app, status = "ACTIVE") => db.doc(`appAssignments/${org}_${uid}_${app}`).set({ organizationId: org, userId: uid, appId: app, role: "MEMBER", status });
const mem = (uid, status = "active") => db.doc(`organizationMemberships/${org}_${uid}`).set({ organizationId: org, userId: uid, role: "MEMBER", status });
const code = async (uid, app, isOwner = false) => (await appEntitlementDenial({ organizationId: org, userId: uid, appId: app, isOwner }))?.code || null;

test("matrix", async () => {
  await sub("a1", "ACTIVE"); await sub("a2", "INACTIVE");
  await mem("u"); await asg("u", "a1"); await asg("u", "a2"); await asg("u", "a3");
  assert.equal(await code("u", "a1"), null, "active sub + assignment + membership");
  assert.equal(await code("u", "a2"), "app_not_enabled", "company switched the app off");
  assert.equal(await code("u", "a3"), "app_not_assigned", "assignment but NO subscription doc: denied like the apps");
  assert.equal(await code("nobody", "a1"), "app_not_assigned", "no assignment");
  await mem("sus", "suspended"); await asg("sus", "a1");
  assert.equal(await code("sus", "a1"), "user_suspended", "suspended membership (portal now reports the same code as the apps: both deny)");
  assert.equal(await code("anyone", "a3", true), null, "an owner is tolerated without a subscription doc");
  assert.equal(await code("anyone", "a2", true), "app_not_enabled", "but not when the app is switched off");
});
