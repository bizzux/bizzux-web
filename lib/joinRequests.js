// Organization join requests: a signed-in person asks to join a company by its company code; the Owner, or an Admin the Owner has granted
// members.approve, decides. Reuses the existing records (organizationMemberships, memberships, team, appAssignments) and the shared helpers; it
// never links by email and never trusts anything from the client except the code, the decision, and a role/apps choice that is capped server-side.
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb, adminAuth } from "./firebaseAdmin";
import { logAuditEvent } from "./audit";
import { notifyApprovers } from "./joinNotify";
import { roleFromProfile } from "./organizationMembership";
import { getOrganizationAppSubscriptions, upsertAppAssignment } from "./appAccess";
import { APP_IDS } from "./appCatalog";
import { DEFAULT_PROFILE } from "./roles";
import { approverCan, assignableProfiles, cleanCode, cleanMessage, decisionProblem, eligibleApprovers, joinRequestId, MAX_REQUESTS_PER_DAY, MEMBERS_APPROVE, REQUEST_TTL_DAYS } from "./joinRules";

export const GENERIC = { ok: true, message: "If that company code is valid, its administrators have been notified. You will have access once one of them approves." };

async function overLimit(uid) {
  const ref = adminDb().collection("loginThrottle").doc("joinreq_" + uid);
  return adminDb().runTransaction(async (tx) => {
    const s = await tx.get(ref); const now = Date.now(); const d = s.exists ? s.data() : null;
    const fresh = d && now - d.windowStart < 86_400_000; const count = fresh ? d.count + 1 : 1;
    tx.set(ref, { windowStart: fresh ? d.windowStart : now, count });
    return count > MAX_REQUESTS_PER_DAY;
  });
}

async function enabledApps(organizationId) {
  const subs = await getOrganizationAppSubscriptions(organizationId);
  return new Set(subs.filter((s) => s.status === "ACTIVE").map((s) => s.appId));
}

// The caller's standing in their ACTIVE company, from the canonical record (+ ownership). acct comes from resolveAccount().
export async function approverContext(acct) {
  const isOwner = !!acct.isOwner;
  const snap = await adminDb().doc(`organizationMemberships/${acct.accountId}_${acct.uid}`).get();
  const m = snap.exists ? snap.data() : {};
  return { isOwner, role: isOwner ? "OWNER" : m.role || "", status: m.status || "active", permissions: Array.isArray(m.permissions) ? m.permissions : [] };
}

export async function requestToJoin({ actor, code, message }) {
  if (await overLimit(actor.uid)) throw { status: 429, message: "Too many requests. Try again tomorrow." };
  const c = cleanCode(code);
  if (!c) return GENERIC;
  const q = await adminDb().collection("customers").where("companyCode", "==", c).limit(1).get();
  if (q.empty) return GENERIC;
  const org = q.docs[0]; const organizationId = org.id;
  if (["suspended", "closed"].includes(org.data().status)) return GENERIC;
  const [mem, legacy, existing] = await Promise.all([
    adminDb().doc(`organizationMemberships/${organizationId}_${actor.uid}`).get(),
    adminDb().doc("memberships/" + actor.uid).get(),
    adminDb().doc("joinRequests/" + joinRequestId(organizationId, actor.uid)).get(),
  ]);
  if (actor.uid === organizationId || mem.exists || (legacy.exists && legacy.data().accountId === organizationId)) return GENERIC;
  if (existing.exists && existing.data().status === "pending" && existing.data().expiresAt?.toMillis() > Date.now()) return GENERIC;
  const members = await adminDb().collection("organizationMemberships").where("organizationId", "==", organizationId).where("role", "==", "ADMIN").get();
  let name = ""; try { name = (await adminAuth().getUser(actor.uid)).displayName || ""; } catch { /* no profile name */ }
  await adminDb().doc("joinRequests/" + joinRequestId(organizationId, actor.uid)).set({
    organizationId, requesterUid: actor.uid, requesterName: name, requesterEmail: actor.trustedEmail || "", message: cleanMessage(message),
    status: "pending", createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + REQUEST_TTL_DAYS * 86_400_000),
    notifiedUids: eligibleApprovers(organizationId, members.docs.map((d) => d.data())),
  });
  await logAuditEvent({ action: "join.request", actor, targetType: "organization", targetId: organizationId, details: {} }).catch(() => {});
  await notifyApprovers({ uids: eligibleApprovers(organizationId, members.docs.map((d) => d.data())), requesterName: name, orgName: org.data().organizationName });
  return GENERIC;
}

export async function listPending(acct) {
  const a = await approverContext(acct);
  if (!approverCan(a)) return { requests: [], canApprove: false, assignable: [] };
  const s = await adminDb().collection("joinRequests").where("organizationId", "==", acct.accountId).where("status", "==", "pending").get();
  const now = Date.now();
  const requests = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !r.expiresAt || r.expiresAt.toMillis() > now)
    .map((r) => ({ id: r.id, name: r.requesterName || "", email: r.requesterEmail || "", message: r.message || "", createdAt: r.createdAt?.toMillis?.() || 0 }));
  let admins = [], companyCode = "", discoverable = false;
  if (a.isOwner) {
    const orgRef = adminDb().doc("customers/" + acct.accountId);
    const orgData = (await orgRef.get()).data() || {};
    companyCode = orgData.companyCode || ""; discoverable = orgData.joinDiscoverable === true;
    if (!companyCode) { companyCode = "BZ" + Math.random().toString(36).slice(2, 8).toUpperCase(); await orgRef.set({ companyCode }, { merge: true }); }
    const [ms, team] = await Promise.all([
      adminDb().collection("organizationMemberships").where("organizationId", "==", acct.accountId).where("role", "==", "ADMIN").get(),
      adminDb().collection(`customers/${acct.accountId}/team`).get(),
    ]);
    const nameBy = new Map(team.docs.map((d) => [d.data().uid, [d.data().firstName, d.data().lastName].filter(Boolean).join(" ") || d.data().email || ""]));
    admins = ms.docs.filter((d) => d.data().status === "active").map((d) => ({ userId: d.data().userId, name: nameBy.get(d.data().userId) || "Admin", canApprove: (d.data().permissions || []).includes(MEMBERS_APPROVE) }));
  }
  return { requests, canApprove: true, assignable: assignableProfiles(a), apps: [...(await enabledApps(acct.accountId))], isOwner: a.isOwner, admins, companyCode, discoverable };
}

export async function myRequests(uid) {
  const s = await adminDb().collection("joinRequests").where("requesterUid", "==", uid).get();
  return s.docs.map((d) => ({ id: d.id, status: d.data().status, createdAt: d.data().createdAt?.toMillis?.() || 0 }));
}

export async function decide({ actor, acct, id, decision, profile, apps, note }) {
  const ref = adminDb().doc("joinRequests/" + String(id || ""));
  const snap = await ref.get();
  // Tenant isolation: a request is only visible to the company it was made to.
  if (!snap.exists || snap.data().organizationId !== acct.accountId) throw { status: 404, message: "Request not found" };
  const request = { ...snap.data(), expiresAtMs: snap.data().expiresAt?.toMillis?.() || 0 };
  const approver = await approverContext(acct);
  const prof = profile || DEFAULT_PROFILE;
  const problem = decisionProblem({ approver, approverUid: acct.uid, request, decision, profile: prof, nowMs: Date.now() });
  if (problem) throw { status: problem.startsWith("You are not allowed") || problem === "You cannot assign that role." ? 403 : 400, message: problem };
  const organizationId = acct.accountId, uid = request.requesterUid;
  const decided = { decidedBy: acct.uid, decidedAt: FieldValue.serverTimestamp(), decision, ...(note ? { decisionNote: cleanMessage(note) } : {}) };

  if (decision === "reject") {
    await ref.update({ status: "rejected", ...decided });
    await logAuditEvent({ action: "join.reject", actor, targetType: "user", targetId: uid, details: { organizationId } }).catch(() => {});
    return { ok: true };
  }
  // Claim it first so two approvers cannot both admit; undo the claim if admitting fails.
  const claimed = await adminDb().runTransaction(async (tx) => { const s = await tx.get(ref); if (s.data().status !== "pending") return false; tx.update(ref, { status: "approving" }); return true; });
  if (!claimed) throw { status: 400, message: "This request has already been decided." };
  try {
    const org = await adminDb().doc("customers/" + organizationId).get();
    if (!org.exists || ["suspended", "closed"].includes(org.data().status)) throw { status: 400, message: "Company is not active" };
    const memRef = adminDb().doc(`organizationMemberships/${organizationId}_${uid}`);
    if ((await memRef.get()).exists) throw { status: 409, message: "Already a member of this company" };
    if (org.data().allowedUsers) {
      const team = await adminDb().collection(`customers/${organizationId}/team`).count().get();
      if (team.data().count + 1 >= org.data().allowedUsers) throw { status: 400, message: "User limit reached for this company's subscription" };
    }
    const enabled = await enabledApps(organizationId);
    const list = (Array.isArray(apps) ? apps : []).filter((a) => APP_IDS.includes(a));
    const denied = list.filter((a) => !enabled.has(a));
    if (denied.length) throw { status: 400, message: "Not enabled for this company: " + denied.join(", ") };

    await memRef.set({ organizationId, userId: uid, role: roleFromProfile(prof, false), profile: prof, status: "active", permissions: [], source: "join_request", schemaVersion: 2, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    await adminDb().collection(`customers/${organizationId}/team`).add({ firstName: request.requesterName || request.requesterEmail || "New member", lastName: "", email: request.requesterEmail || "", role: prof, profile: prof, status: "active", uid, invitedBy: acct.uid, invitedAt: FieldValue.serverTimestamp(), joinedAt: FieldValue.serverTimestamp(), via: "join_request" });
    await Promise.all(list.map((appId) => upsertAppAssignment({ organizationId, userId: uid, appId, role: "MEMBER", status: "ACTIVE" })));
    const [own, legacy] = await Promise.all([adminDb().doc("customers/" + uid).get(), adminDb().doc("memberships/" + uid).get()]);
    if (!legacy.exists && !own.exists) await adminDb().doc("memberships/" + uid).set({ accountId: organizationId, profile: prof, role: "", email: request.requesterEmail || "", joinedAt: FieldValue.serverTimestamp() });
    else for (const d of [own, legacy]) if (d.exists) await d.ref.set({ multiOrg: true }, { merge: true });
    await ref.update({ status: "approved", ...decided, profile: prof, apps: list });
    await logAuditEvent({ action: "join.approve", actor, targetType: "user", targetId: uid, details: { organizationId, profile: prof, apps: list } }).catch(() => {});
    return { ok: true, profile: prof, apps: list };
  } catch (e) {
    await ref.update({ status: "pending" }).catch(() => {});
    throw e;
  }
}

// Owner-only: give or take back members.approve for an Organization Admin.
export async function setApproverPermission({ actor, acct, userId, permission, grant }) {
  if (!acct.isOwner) throw { status: 403, message: "Only the company Owner can change who may approve join requests." };
  if (permission !== MEMBERS_APPROVE) throw { status: 400, message: "Unknown permission" };
  const ref = adminDb().doc(`organizationMemberships/${acct.accountId}_${userId}`);
  const s = await ref.get();
  if (!s.exists || s.data().role !== "ADMIN") throw { status: 400, message: "Permissions can only be given to an Organization Admin of this company." };
  await ref.update({ permissions: grant ? FieldValue.arrayUnion(permission) : FieldValue.arrayRemove(permission), updatedAt: FieldValue.serverTimestamp() });
  await logAuditEvent({ action: grant ? "permission.grant" : "permission.revoke", actor, targetType: "user", targetId: userId, details: { organizationId: acct.accountId, permission } }).catch(() => {});
  return { ok: true };
}

// Owner switch: may people find this company by NAME when they search? Off by default. The company code and a join link always work for people who were given them.
export async function setDiscoverable({ actor, acct, discoverable }) {
  const a = await approverContext(acct);
  if (!a.isOwner) throw { status: 403, message: "Only the Owner can change this" };
  await adminDb().doc("customers/" + acct.accountId).set({ joinDiscoverable: discoverable === true }, { merge: true });
  await logAuditEvent({ action: discoverable ? "join.discoverable_on" : "join.discoverable_off", actor, targetType: "organization", targetId: acct.accountId, details: {} }).catch(() => {});
  return { ok: true, discoverable: discoverable === true };
}

// Search by company name. Only companies whose Owner switched discovery on, only name + code (never people, counts or addresses), at least 3 letters,
// at most 8 results and a daily cap per person, so it cannot be used to list or map the platform. A request still needs an administrator's approval.
export async function searchJoinable({ actor, q }) {
  const term = String(q || "").trim().toLowerCase();
  if (term.length < 3) return { results: [] };
  const ref = adminDb().collection("loginThrottle").doc("joinsearch_" + actor.uid);
  const over = await adminDb().runTransaction(async (tx) => {
    const sn = await tx.get(ref); const now = Date.now(); const d = sn.exists ? sn.data() : null;
    const fresh = d && now - d.windowStart < 86_400_000; const count = fresh ? d.count + 1 : 1;
    tx.set(ref, { windowStart: fresh ? d.windowStart : now, count });
    return count > 40;
  });
  if (over) throw { status: 429, message: "Too many searches. Try again tomorrow." };
  const snap = await adminDb().collection("customers").where("joinDiscoverable", "==", true).limit(300).get();
  const results = snap.docs
    .filter((d) => !["suspended", "closed"].includes(d.data().status) && d.data().companyCode && String(d.data().organizationName || "").toLowerCase().includes(term))
    .slice(0, 8).map((d) => ({ name: d.data().organizationName, code: d.data().companyCode }));
  return { results };
}
