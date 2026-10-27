// Organization lifecycle: environment classification, impact preview, deletion
// blockers, and the resumable permanent-deletion engine.
//
// Rules:
//  - Test/Demo orgs can be deleted at once (users + data), after typing the name.
//  - Production/Trial orgs go Archive -> 30-day recovery -> removal. Removal is
//    refused while billing, legal hold/retention or dependencies block it.
//  - A person who also belongs to another organization (or is a platform admin,
//    or owns another business) is only DETACHED from this one. Their login is
//    never deleted here, so the surviving organization keeps working.
//  - Deletion is a list of idempotent steps whose progress lives in
//    orgLifecycle/{orgId} (separate from the org doc). A retry skips finished
//    steps. Only when every step succeeds is the org doc removed and the result
//    reported as complete; anything skipped/failed leaves status "deleting".
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "./firebaseAdmin";
import { logAuditEvent } from "./audit";
import { removeFromDirectory } from "./orgDirectory";
import { assertOrgPermission, loadOrg, lockRef } from "./orgProvisioning";

export const ARCHIVE_RECOVERY_DAYS = 30;
export const DELETION_REASONS = {
  testing_recreate: "Testing / recreate",
  no_longer_required: "No longer required",
  duplicate: "Duplicate",
  other: "Other",
};
const DAY = 864e5;
const ORG_COLLECTIONS = ["organizationAppSubscriptions", "appAssignments", "organizationMemberships"];

export function environmentFor(org, customer) {
  const p = org?.planType || customer?.planType;
  if (org?.isTestAccount === true || p === "TEST") return "test_demo";
  if (p === "INTERNAL" || org?.type === "INTERNAL") return "internal";
  if (p === "PAID") return "production";
  if (p === "TRIAL") return "trial";
  return customer?.status === "active" && customer?.planId && customer?.billing !== "complimentary" ? "production" : "trial";
}
export const ENVIRONMENT_LABEL = { production: "Production", trial: "Trial", test_demo: "Test/Demo", internal: "Internal" };

// Validates the picklist. Legacy callers that send only free text count as "other".
export function parseDeletionReason({ reasonCode, reason }) {
  const code = reasonCode || "other";
  if (!DELETION_REASONS[code]) throw { status: 400, message: "Choose a valid reason" };
  const text = String(reason || "").trim().slice(0, 300);
  if (code === "other" && text.length < 3) throw { status: 400, message: "Describe the reason (it is recorded in the audit log)" };
  return { reasonCode: code, reasonText: text || DELETION_REASONS[code] };
}

const toMillis = (t) => (t?.toMillis ? t.toMillis() : t?.toDate ? t.toDate().getTime() : t ? new Date(t).getTime() : 0);

// Things that must stop a permanent removal. Pure: takes already-loaded facts.
export function deletionBlockers({ org, customer, children = 0, otherJob = false, now = new Date() }) {
  const b = [];
  if (org.type === "INTERNAL" && org.provisionedVia !== "platform-admin") b.push("Bizzux's own organization can't be deleted");
  if (org.legalHold === true || customer?.legalHold === true) b.push("Legal hold is set on this organization");
  if (toMillis(org.retentionUntil) > now.getTime()) b.push("Legal retention period runs until " + new Date(toMillis(org.retentionUntil)).toISOString().slice(0, 10));
  const paying = customer && customer.billing !== "complimentary" && !!customer.planId &&
    (["active", "past_due"].includes(customer.status) || ["active", "past_due"].includes(customer.prevStatus));
  if (paying) b.push("Active paid subscription: cancel billing first");
  if (children > 0) b.push(children + " other organization(s) depend on this one (parent link)");
  if (otherJob) b.push("A deletion is already running for this organization");
  if (org.dependencyHold === true) b.push("Unresolved cross-application dependency is flagged on this organization");
  return b;
}

// Who is in the org, and which of them also belong elsewhere (kept, detached).
async function classifyUsers(id, customer, savedUids) {
  const db = adminDb();
  const uids = new Set(savedUids || []);
  if (customer) {
    (await db.collection("customers/" + id + "/team").get()).docs.forEach((d) => d.data().uid && uids.add(d.data().uid));
  }
  (await db.collection("organizationMemberships").where("organizationId", "==", id).get()).docs.forEach((d) => d.data().userId && uids.add(d.data().userId));
  (await db.collection("usernames").where("organizationId", "==", id).get()).docs.forEach((d) => d.data().uid && uids.add(d.data().uid));
  if (customer) uids.add(id); // the owner's login is the org id for self/admin-provisioned businesses
  const exclusive = [], shared = [];
  for (const uid of uids) {
    const [others, pa, ownBiz] = await Promise.all([
      db.collection("organizationMemberships").where("userId", "==", uid).limit(5).get(),
      db.doc("platformAdmins/" + uid).get(),
      uid === id ? null : db.doc("customers/" + uid).get(),
    ]);
    const elsewhere = others.docs.some((d) => d.data().organizationId !== id);
    (elsewhere || pa.exists || ownBiz?.exists ? shared : exclusive).push(uid);
  }
  return { exclusive, shared };
}

export async function previewOrgDeletion({ actor, organizationId, now = new Date() }) {
  await assertOrgPermission(actor, "organizations.archive");
  const { id, org, customer } = await loadOrg(organizationId);
  const db = adminDb();
  const lc = (await db.doc("orgLifecycle/" + id).get()).data() || null;
  const env = environmentFor(org, customer);
  const { exclusive, shared } = await classifyUsers(id, customer, lc?.userUids);
  const counts = {};
  for (const col of ORG_COLLECTIONS) counts[col] = (await db.collection(col).where("organizationId", "==", id).count().get()).data().count;
  const children = (await db.collection("organizations").where("parentOrganizationId", "==", id).count().get()).data().count;
  const running = !!lc && lc.state === "deleting" && toMillis(lc.leaseUntil) > now.getTime();
  const blockers = deletionBlockers({ org, customer, children, otherJob: running, now });
  const purgeAfter = toMillis(org.purgeAfter);
  return {
    organizationId: id, name: org.organizationName || org.name || "", environment: env, environmentLabel: ENVIRONMENT_LABEL[env],
    status: org.status || "active", purgeAfter: purgeAfter ? new Date(purgeAfter).toISOString() : null,
    users: { removed: exclusive.length, keptElsewhere: shared.length },
    records: counts, hasBusinessData: !!customer, blockers, canDeleteNow: !blockers.length && eligibility(org, customer, env, now, false).ok,
    reasonIfNot: eligibility(org, customer, env, now, false).why || null,
    previousAttempt: lc && lc.state !== "completed" ? { state: lc.state, failed: lc.failed || [] } : null,
  };
}

// When may this org be permanently removed? `early` = Owner explicitly skips the wait.
function eligibility(org, customer, env, now, early) {
  const status = org.status || "active";
  if (status === "deleting") return { ok: true };
  if (env === "test_demo") return { ok: true };
  if (!["archived", "pending", "pending_admin"].includes(status)) return { ok: false, why: "Archive the organization before permanently deleting it" };
  if (!customer) return { ok: true }; // nothing recoverable: never had users or data
  const due = toMillis(org.purgeAfter);
  if (early || (due && due <= now.getTime())) return { ok: true };
  return { ok: false, why: "Recovery window runs until " + (due ? new Date(due).toISOString().slice(0, 10) : "(not scheduled)") + ". Only the Platform Owner can remove it earlier." };
}

async function deleteQuery(q) {
  const snap = await q.get();
  const db = adminDb();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const b = db.batch();
    snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  return snap.size;
}

// Detach a shared person from this org only. Their login and other orgs stay.
async function detachUser(uid, id) {
  const db = adminDb();
  await deleteQuery(db.collection("organizationMemberships").where("userId", "==", uid).where("organizationId", "==", id));
  await deleteQuery(db.collection("appAssignments").where("userId", "==", uid).where("organizationId", "==", id));
  await deleteQuery(db.collection("customers/" + id + "/team").where("uid", "==", uid));
  const m = await db.doc("memberships/" + uid).get();
  if (m.exists && m.data().accountId === id) await m.ref.delete();
}

export function newJob(now) {
  return { state: "deleting", steps: {}, failed: [], userUids: [], startedAt: Timestamp.fromDate(now) };
}

// Runs (or resumes) the deletion. Never throws for a step failure: returns
// { ok:false, status:"incomplete", failed:[...] } so callers can't mistake it for done.
export async function runOrgDeletion({ actor, id, org, customer, reasonCode, reasonText, now = new Date(), deps = {} }) {
  const db = adminDb();
  const jobRef = db.doc("orgLifecycle/" + id);
  const prior = (await jobRef.get()).data();
  const job = prior && prior.state !== "completed" ? prior : newJob(now);
  const name = org.organizationName || org.name || "";
  const env = environmentFor(org, customer);
  const steps = job.steps || {};
  const failed = [];
  const report = { usersRemoved: 0, usersDetached: 0, skipped: [] };
  const lease = () => jobRef.set({
    ...job, steps, state: "deleting", leaseUntil: Timestamp.fromDate(new Date(now.getTime() + 10 * 60000)),
    orgName: name, environment: env, reasonCode, reasonText, requestedBy: actor.uid || actor.email || "system", updatedAt: Timestamp.fromDate(now),
  });
  if (prior?.state === "deleting" && toMillis(prior.leaseUntil) > now.getTime() && prior.requestedBy && !deps.ignoreLease) {
    throw { status: 409, message: "A deletion is already running for this organization. Try again in a few minutes." };
  }
  await lease();
  // From here on the org is unusable even if cleanup stops half way.
  await db.doc("organizations/" + id).set({ status: "deleting", updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  const run = async (key, fn) => {
    if (steps[key] === "done") return;
    try {
      const r = await fn();
      steps[key] = "done";
      if (r?.skipped?.length) { steps[key] = "failed"; failed.push(key + ": " + r.skipped.join("; ")); report.skipped.push(...r.skipped); }
    } catch (e) {
      steps[key] = "failed";
      failed.push(key + ": " + (e?.message || "failed"));
    }
    await lease();
  };

  // 1. People. The uid list is saved first so a retry still finds logins
  //    whose records were already removed.
  await run("users", async () => {
    const { exclusive, shared } = await classifyUsers(id, customer, job.userUids);
    job.userUids = [...new Set([...(job.userUids || []), ...exclusive])];
    await lease();
    const purge = deps.purgeUser || (await import("./userPurge")).purgeUser;
    const skipped = [];
    for (const uid of job.userUids) {
      if (uid === id) continue;
      const r = await purge({ uid, email: "", ownsBusiness: false, memberOf: { accountId: id }, keepOrgDoc: true });
      report.usersRemoved++; skipped.push(...(r?.skipped || []));
    }
    for (const uid of shared) { if (uid !== id) { await detachUser(uid, id); report.usersDetached++; } }
    // The owner: wipe the business's data; delete the login only if it's theirs alone.
    if (customer) {
      const ownerShared = shared.includes(id);
      const r = await purge({ uid: id, email: customer.email || "", ownsBusiness: true, memberOf: null, keepIdentity: ownerShared, keepOrgDoc: true });
      if (ownerShared) report.usersDetached++; else report.usersRemoved++;
      skipped.push(...(r?.skipped || []));
    }
    return { skipped };
  });
  // 2. Anything left in the org's own collections (usernames of removed people etc).
  // Only after people are fully handled: this step deletes customers/{id}, which a
  // retry of the people step still needs to find the owner.
  if (!failed.length) await run("records", async () => {
    await deleteQuery(db.collection("usernames").where("organizationId", "==", id));
    for (const col of ORG_COLLECTIONS) await deleteQuery(db.collection(col).where("organizationId", "==", id));
    if (customer) await db.recursiveDelete(db.doc("customers/" + id));
  });

  if (failed.length || Object.values(steps).some((s) => s !== "done")) {
    job.failed = failed;
    await jobRef.set({ ...job, steps, failed, state: "deleting", leaseUntil: Timestamp.fromDate(now), updatedAt: Timestamp.fromDate(now) });
    await logAuditEvent({ action: "organization.delete_incomplete", actor, targetType: "organization", targetId: id, details: { name, failed } });
    return { ok: false, status: "incomplete", failed, ...report };
  }
  // 3. Only now: name lock (never an archived org's, already freed and maybe reused), org doc, directory.
  if (org.nameKey && org.status !== "archived") await lockRef(org.nameKey).delete().catch(() => {});
  await db.doc("organizations/" + id).delete();
  await removeFromDirectory(id);
  await jobRef.set({
    state: "completed", orgName: name, environment: env, reasonCode, reasonText, steps, failed: [],
    completedAt: Timestamp.fromDate(now), usersRemoved: report.usersRemoved, usersDetached: report.usersDetached,
  });
  await logAuditEvent({
    action: env === "test_demo" ? "organization.delete_test" : "organization.delete", actor, targetType: "organization", targetId: id,
    details: { name, environment: env, reasonCode, reason: reasonText, usersRemoved: report.usersRemoved, usersKept: report.usersDetached, skipped: [] },
  });
  return { ok: true, status: "deleted", ...report };
}

// Permanent deletion on behalf of a person (permissions, name confirmation, blockers).
export async function deleteOrganizationPermanently({ actor, organizationId, confirmName, reason, reasonCode, earlyPurge = false, now = new Date() }, deps = {}) {
  const { id, org, customer } = await loadOrg(organizationId);
  const env = environmentFor(org, customer);
  const resuming = org.status === "deleting";
  if (env === "test_demo") await assertOrgPermission(actor, "organizations.delete_test");
  else await assertOrgPermission(actor, "organizations.delete");
  if (org.type === "INTERNAL" && org.provisionedVia !== "platform-admin") throw { status: 400, message: "Internal organizations can't be deleted here" };
  const name = org.organizationName || org.name || "";
  if (String(confirmName || "").trim() !== name) throw { status: 400, message: "Type the organization name exactly to confirm" };
  const why = parseDeletionReason({ reasonCode: reasonCode || (env === "test_demo" ? "testing_recreate" : undefined), reason });
  // Non-test deletion already needs organizations.delete (Owner-only), so earlyPurge is Owner-only too.
  const children = (await adminDb().collection("organizations").where("parentOrganizationId", "==", id).count().get()).data().count;
  const blockers = deletionBlockers({ org, customer, children, now });
  if (blockers.length) throw { status: 409, message: "Can't delete: " + blockers.join("; "), blockers };
  const el = eligibility(org, customer, env, now, earlyPurge);
  if (!el.ok && !resuming) throw { status: 400, message: el.why };
  return runOrgDeletion({ actor, id, org, customer, ...why, now, deps });
}

// Daily expiry: archived orgs whose 30 days are up are removed if nothing blocks them;
// blocked ones stay archived with the reason recorded. Safe to re-run.
export async function purgeExpiredArchives({ now = new Date(), limit = 10, deps = {} } = {}) {
  const db = adminDb();
  const due = await db.collection("organizations").where("purgeAfter", "<=", Timestamp.fromDate(now)).limit(50).get();
  const system = { uid: "system:org-expiry", email: "system", platformRole: "SYSTEM" };
  const results = [];
  for (const d of due.docs) {
    if (results.length >= limit) break;
    const org = d.data();
    if (!["archived", "deleting"].includes(org.status)) continue;
    const customerSnap = await db.doc("customers/" + d.id).get();
    const customer = customerSnap.exists ? customerSnap.data() : null;
    const children = (await db.collection("organizations").where("parentOrganizationId", "==", d.id).count().get()).data().count;
    const blockers = deletionBlockers({ org, customer, children, now });
    if (blockers.length) {
      await d.ref.set({ purgeBlocked: blockers, purgeCheckedAt: Timestamp.fromDate(now) }, { merge: true });
      results.push({ id: d.id, result: "blocked", blockers });
      continue;
    }
    try {
      const r = await runOrgDeletion({
        actor: system, id: d.id, org, customer, reasonCode: org.deletionReasonCode || "no_longer_required",
        reasonText: org.deletionReason || "Archive recovery window ended", now, deps: { ...deps, ignoreLease: true },
      });
      results.push({ id: d.id, result: r.ok ? "deleted" : "incomplete", failed: r.failed });
    } catch (e) {
      results.push({ id: d.id, result: "error", error: e?.message || String(e) });
    }
  }
  return results;
}
