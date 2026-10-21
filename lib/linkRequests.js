// Linking an EXISTING Bizzux login (a username user) to another company, without creating a second identity.
//
// A company admin cannot attach someone just by knowing their username: that would let any admin pull any account into their company
// (and its seat bill). Instead the admin sends a request, and the person themself must accept it after signing in. Until then nothing changes
// for them. Platform Admins can still link directly (/api/admin/username-users "linkUser"), which is audited.
// Email accounts do not need this: the normal invitation (/api/team "invite") already detects an existing login and asks that person to accept.
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "./firebaseAdmin";
import { PROFILE_VALUES, DEFAULT_PROFILE } from "./roles";
import { roleFromProfile } from "./organizationMembership";
import { getOrganizationAppSubscriptions, upsertAppAssignment } from "./appAccess";
import { APP_IDS } from "./appCatalog";
import { logAuditEvent } from "./audit";
import { bindEmployeeToIdentity } from "./iam/employeeBinding";
import { LINK_TTL_DAYS, MAX_REQUESTS_PER_HOUR, linkRequestProblem, linkRequestId } from "./linkRules";

async function enabledApps(organizationId) {
  const subs = await getOrganizationAppSubscriptions(organizationId);
  return new Set(subs.filter((s) => s.status === "ACTIVE").map((s) => s.appId));
}

async function throttled(key) {
  const ref = adminDb().collection("loginThrottle").doc(key.replace(/[^a-zA-Z0-9:._-]/g, "_"));
  return adminDb().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const now = Date.now(), d = s.exists ? s.data() : null;
    const fresh = d && now - d.windowStart < 3600_000;
    const count = fresh ? d.count + 1 : 1;
    tx.set(ref, { windowStart: fresh ? d.windowStart : now, count });
    return count > MAX_REQUESTS_PER_HOUR;
  });
}

// Does the actual attach. Used by a Platform Admin's direct link and by an accepted request, so both obey the same checks:
// company exists and is active, not already a member (no duplicate identity or seat), seat limit, only apps the company owns.
export async function linkUserToOrganization({ actor, uid, username, displayName, homeOrganizationId, organizationId, profile, apps, via }) {
  const org = await adminDb().doc("customers/" + organizationId).get();
  if (!org.exists) throw { status: 404, message: "Company not found" };
  if (["suspended", "closed"].includes(org.data().status)) throw { status: 400, message: "Company is not active" };
  if (organizationId === homeOrganizationId) throw { status: 400, message: "That is already this user's company" };
  const memRef = adminDb().doc("organizationMemberships/" + organizationId + "_" + uid);
  if ((await memRef.get()).exists) throw { status: 409, message: "Already a member of that company" };
  if (org.data().allowedUsers) {
    const team = await adminDb().collection("customers/" + organizationId + "/team").count().get();
    if (team.data().count + 1 >= org.data().allowedUsers) throw { status: 400, message: "User limit reached for that company's subscription" };
  }
  const prof = PROFILE_VALUES.includes(profile) ? profile : DEFAULT_PROFILE;
  const enabled = await enabledApps(organizationId);
  const list = (Array.isArray(apps) ? apps : []).filter((a) => APP_IDS.includes(a));
  const denied = list.filter((a) => !enabled.has(a));
  if (denied.length) throw { status: 400, message: "Not enabled for that company: " + denied.join(", ") };

  await memRef.set({
    organizationId, userId: uid, role: roleFromProfile(prof, false), profile: prof, status: "active",
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  await adminDb().collection("customers/" + organizationId + "/team").add({
    firstName: displayName || username, lastName: "", email: "", username, role: prof, profile: prof,
    status: "active", uid, linkedFromOrganizationId: homeOrganizationId,
    invitedBy: actor?.email || actor?.uid || uid, invitedAt: FieldValue.serverTimestamp(), joinedAt: FieldValue.serverTimestamp(),
  });
  await Promise.all(list.map((appId) => upsertAppAssignment({ organizationId, userId: uid, appId, role: "MEMBER", status: "ACTIVE" })));
  for (const path of ["customers/" + uid, "memberships/" + uid]) {
    const d = await adminDb().doc(path).get();
    if (d.exists) await d.ref.set({ multiOrg: true }, { merge: true });
  }
  await logAuditEvent({ action: "user.link_company", actor, targetType: "user", targetId: uid, details: { organizationId, username, profile: prof, apps: list, via: via || "direct" } });
  return { profile: prof, apps: list };
}

// Admin side. ALWAYS answers the same way whether or not the username exists, so it cannot be used to discover who has an account.
export async function createLinkRequest({ actor, organizationId, username, profile, apps, bindEmployeeId }) {
  username = String(username || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw { status: 400, message: "Enter the person's exact username" };
  if (await throttled("linkreq:" + actor.uid)) throw { status: 429, message: "Too many requests. Try again later." };
  const org = await adminDb().doc("customers/" + organizationId).get();
  if (!org.exists) throw { status: 404, message: "Company not found" };
  const prof = PROFILE_VALUES.includes(profile) ? profile : DEFAULT_PROFILE;
  const enabled = await enabledApps(organizationId);
  const list = (Array.isArray(apps) ? apps : []).filter((a) => APP_IDS.includes(a));
  const denied = list.filter((a) => !enabled.has(a));
  if (denied.length) throw { status: 400, message: "Not enabled for this company: " + denied.join(", ") };

  const generic = { ok: true, message: "If that username exists, a request has been sent. They need to accept it the next time they sign in." };
  const u = await adminDb().doc("usernames/" + username).get();
  if (!u.exists || u.data().disabled) return generic;
  const targetUid = u.data().uid;
  if (u.data().organizationId === organizationId) return generic;
  if ((await adminDb().doc("organizationMemberships/" + organizationId + "_" + targetUid).get()).exists) return generic;

  const ref = adminDb().doc("linkRequests/" + linkRequestId(organizationId, targetUid));
  const existing = await ref.get();
  if (existing.exists && !linkRequestProblem({ ...existing.data(), targetUid }, targetUid)) return generic; // already waiting
  await ref.set({
    organizationId, organizationName: org.data().organizationName || org.data().companyName || "a company",
    targetUid, username, displayName: u.data().displayName || "", homeOrganizationId: u.data().organizationId,
    profile: prof, apps: list, status: "pending", ...(bindEmployeeId ? { bindEmployeeId } : {}),
    createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + LINK_TTL_DAYS * 86400_000),
  });
  await logAuditEvent({ action: "user.link_request", actor, targetType: "user", targetId: targetUid, details: { organizationId, username, profile: prof, apps: list } });
  return generic;
}

export async function listMyLinkRequests(uid) {
  const snap = await adminDb().collection("linkRequests").where("targetUid", "==", uid).where("status", "==", "pending").get();
  const now = Date.now();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => !linkRequestProblem(r, uid, now))
    .map((r) => ({ id: r.id, organizationName: r.organizationName, profile: r.profile, apps: r.apps }));
}

export async function answerLinkRequest({ uid, id, accept }) {
  const ref = adminDb().doc("linkRequests/" + String(id || ""));
  const snap = await ref.get();
  const r = snap.exists ? snap.data() : null;
  const problem = linkRequestProblem(r, uid);
  if (problem) throw { status: r && r.targetUid !== uid ? 404 : 410, message: r && r.targetUid !== uid ? "That request no longer exists." : problem };
  // Claim it first so a double tap cannot link twice.
  const won = await adminDb().runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (!cur.exists || cur.data().status !== "pending") return false;
    tx.update(ref, { status: accept ? "accepted" : "declined", answeredAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!won) throw { status: 410, message: "That request has already been answered." };
  if (!accept) {
    await logAuditEvent({ action: "user.link_declined", actor: { uid }, targetType: "user", targetId: uid, details: { organizationId: r.organizationId } });
    return { ok: true, status: "declined" };
  }
  try {
    await linkUserToOrganization({ actor: { uid }, uid, username: r.username, displayName: r.displayName, homeOrganizationId: r.homeOrganizationId, organizationId: r.organizationId, profile: r.profile, apps: r.apps, via: "accepted_request" });
  } catch (e) {
    await ref.update({ status: "pending" }).catch(() => {}); // seat limit etc.: keep it open so the admin can fix the cause
    throw e;
  }
  // Attendance Add Person asked for this person to be linked to an employee record: bind it now (tenant-scoped, idempotent, audited).
  let binding;
  if (r.bindEmployeeId) {
    binding = await bindEmployeeToIdentity({ organizationId: r.organizationId, employeeId: r.bindEmployeeId, uid, username: r.username, actor: { uid }, via: "accepted_link_request" });
    await ref.update({ binding }).catch(() => {});
  }
  return { ok: true, status: "accepted", ...(binding ? { binding } : {}) };
}
