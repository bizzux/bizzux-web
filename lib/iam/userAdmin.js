// Reset password (drawer) and user details (drawer) for the Admin Center. Both are scoped to ONE company and authorized by the organization role.
import { adminAuth, adminDb, generateTempPassword } from "../firebaseAdmin";
import { logAuditEvent } from "../audit";
import { getOrganizationAppSubscriptions } from "../appAccess";
import { setUsernamePassword, tempExpiry } from "../usernameAuth";
import { validatePassword } from "../passwordPolicy";
import { loadOrgSubject } from "../authz/orgAuthz";
import { effectiveOrgRole, explainAccess, orgCan } from "../authz/policy.js";
import { resolveOrganizationId } from "./identityService";
import { cleanContactInfo } from "./contactInfo";
import { cleanExpiry } from "../accountExpiry";

// Reset the password of a Bizzux USERNAME login homed in this company (pending or active). Google or email-and-password identities are managed by their
// own provider and are refused. Authorized by users.reset_password, never the Owner or oneself, signs the person out everywhere, optionally forces a
// change at next sign-in, audited. The password is returned once and never stored in clear text.
export async function resetUsernamePassword({ actor: c, organizationId: requestedOrg, uid, password, mustChange = true }) {
  const organizationId = resolveOrganizationId(c, requestedOrg);
  const db = adminDb();
  if (!c.isSuper) {
    const subject = c.orgSubject || (await loadOrgSubject(db, { accountId: organizationId, isOwner: c.isOwner, profile: c.profile }, c.uid));
    if (!orgCan(subject, "users.reset_password")) throw { status: 403, message: "You can't reset passwords" };
    if (uid === c.uid) throw { status: 403, message: "Use change password for your own account" };
  }
  if (uid === organizationId) throw { status: 403, message: "The Owner's password can't be reset here" };
  const member = await db.doc(`organizationMemberships/${organizationId}_${uid}`).get();
  if (!member.exists || member.data().status === "removed") throw { status: 404, message: "That person is not a member of this company" };
  const q = await db.collection("usernames").where("uid", "==", uid).limit(1).get();
  if (q.empty) throw { status: 400, message: "This person signs in with a Google or email account. Their password is managed by that provider, not by Bizzux." };
  const d = q.docs[0].data();
  if (d.organizationId !== organizationId) throw { status: 403, message: "This login belongs to another company; its own administrators manage the password" };
  const custom = String(password || "").trim();
  const pw = custom || generateTempPassword();
  const problem = await validatePassword(organizationId, pw);
  if (problem) throw { status: 400, message: problem };
  const force = mustChange !== false;
  await setUsernamePassword(uid, pw, force, { tempExpiresAt: force ? tempExpiry() : null });
  await db.doc("memberships/" + uid).set({ mustChangePassword: force }, { merge: true });
  await logAuditEvent({ action: "user.reset_password", actor: c, targetType: "user", targetId: uid, details: { organizationId, mustChange: force, custom: !!custom } });
  return { ok: true, username: q.docs[0].id, password: pw, mustChange: force };
}

const clip = (v, n) => String(v || "").trim().slice(0, n);

// Edit a person's company record, scoped to ONE company, needing the same right as adding a user. Only the fields present in `fields` are touched:
//   descriptive: branch, employeeId, contactInfo {jobTitle, department, employmentType, office, officePhone, mobilePhone, streetAddress, city, state, zip, country}
//   identity details (only for a Bizzux username login HOMED in this company): firstName, lastName, displayName (required when sent), accountExpiresAt ("" clears)
// Never the login ID, email, password, roles or app access. Every value is trimmed and length-limited here; the audit entry lists the changed field NAMES
// (and the old/new expiry date, which is not sensitive), never other values.
export async function updateUserProfile({ actor: c, organizationId: requestedOrg, uid, fields }) {
  const organizationId = resolveOrganizationId(c, requestedOrg);
  const db = adminDb();
  if (!c.isSuper) {
    const subject = c.orgSubject || (await loadOrgSubject(db, { accountId: organizationId, isOwner: c.isOwner, profile: c.profile }, c.uid));
    if (!orgCan(subject, "users.create")) throw { status: 403, message: "You can't edit users" };
  }
  const mem = await db.doc(`organizationMemberships/${organizationId}_${uid}`).get();
  if (!mem.exists || mem.data().status === "removed") throw { status: 404, message: "That person is not a member of this company" };
  const q = await db.collection(`customers/${organizationId}/team`).where("uid", "==", uid).limit(1).get();
  if (q.empty) throw { status: 404, message: "This person has no team record in this company to edit" };
  const x = fields && typeof fields === "object" ? fields : {};
  const teamRef = q.docs[0].ref;
  const before = q.docs[0].data();
  const prevCi = before.contactInfo && typeof before.contactInfo === "object" ? before.contactInfo : {};
  const changed = [];
  const teamUpdate = {};
  const batch = db.batch();

  // Descriptive profile. A group that is not sent is left alone (previously a PATCH without contactInfo would have blanked it).
  if ("contactInfo" in x || "branch" in x || "employeeId" in x) {
    const ci = "contactInfo" in x ? cleanContactInfo(x.contactInfo) : cleanContactInfo(prevCi);
    if (!(x.contactInfo && typeof x.contactInfo === "object" && "faxNumber" in x.contactInfo)) ci.faxNumber = clip(prevCi.faxNumber, 40); // no fax field in the form: keep it
    const prev = (k) => String(prevCi[k] ?? (k === "jobTitle" ? before.designation : k === "department" ? before.department : k === "mobilePhone" ? before.mobile : "") ?? "");
    for (const k of Object.keys(ci)) if (ci[k] !== prev(k)) changed.push(k);
    const branch = "branch" in x ? clip(x.branch, 100) : String(before.branch || "");
    const employeeId = "employeeId" in x ? clip(x.employeeId, 50) : String(before.employeeId || "");
    if (branch !== String(before.branch || "")) changed.push("branch");
    if (employeeId !== String(before.employeeId || "")) changed.push("employeeId");
    Object.assign(teamUpdate, {
      designation: ci.jobTitle, department: ci.department, branch, employeeId,
      employmentType: ci.employmentType === "Contractor" ? "Contractor" : "Employee", mobile: ci.mobilePhone.slice(0, 20), contactInfo: ci,
    });
  }

  // Identity details live on the login, so they can only be edited where this company owns that login.
  const wantsName = ["firstName", "lastName", "displayName"].some((k) => k in x);
  const wantsExpiry = "accountExpiresAt" in x;
  const audit = {};
  if (wantsName || wantsExpiry) {
    const uq = await db.collection("usernames").where("uid", "==", uid).limit(1).get();
    if (uq.empty || uq.docs[0].data().organizationId !== organizationId) {
      throw { status: 400, message: "Name and account expiry can't be changed here: this person's sign-in is managed by their own Google or email account, or by another company." };
    }
    const unameRef = uq.docs[0].ref;
    const ud = uq.docs[0].data();
    const exp = wantsExpiry ? cleanExpiry(x.accountExpiresAt) : null; // validated before anything is written
    if (exp && !exp.ok) throw { status: 400, message: exp.message };
    if (exp && uid === c.uid && exp.value !== String(ud.accountExpiresAt || "")) throw { status: 403, message: "You can't change your own account expiry" };
    if (wantsName) {
      const authUser = await adminAuth().getUser(uid).catch(() => null);
      const curDisplay = authUser?.displayName || ud.displayName || "";
      const firstName = "firstName" in x ? clip(x.firstName, 60) : String(before.firstName || "");
      const lastName = "lastName" in x ? clip(x.lastName, 60) : String(before.lastName || "");
      const displayName = "displayName" in x ? clip(x.displayName, 80) : curDisplay; // never rebuilt from first + last behind the administrator's back
      if ("displayName" in x && !displayName) throw { status: 400, message: "Display name is required" };
      if (firstName !== String(before.firstName || "")) changed.push("firstName");
      if (lastName !== String(before.lastName || "")) changed.push("lastName");
      const displayChanged = displayName !== curDisplay;
      if (displayChanged) changed.push("displayName");
      Object.assign(teamUpdate, { firstName, lastName, displayName });
      if (displayChanged) {
        if (authUser) await adminAuth().updateUser(uid, { displayName }); // first: it is the step most likely to fail, before any record is written
        batch.set(unameRef, { displayName }, { merge: true });
      }
    }
    if (exp) {
      const prevExpiry = String(ud.accountExpiresAt || "");
      if (exp.value !== prevExpiry) {
        changed.push("accountExpiresAt");
        audit.accountExpiresAt = { from: prevExpiry, to: exp.value };
        batch.set(unameRef, { accountExpiresAt: exp.value }, { merge: true });
        teamUpdate.accountExpiresAt = exp.value;
        if (exp.value && Date.parse(exp.value + "T23:59:59.999Z") < Date.now()) await adminAuth().revokeRefreshTokens(uid); // already past: end live sessions
      }
    }
  }

  if (!changed.length) return { ok: true, changed };
  batch.set(teamRef, teamUpdate, { merge: true });
  await batch.commit();
  await logAuditEvent({ action: "user.update_profile", actor: c, targetType: "user", targetId: uid, details: { organizationId, changed, ...audit } });
  return { ok: true, changed };
}

// Everything the details drawer shows, in one round trip, limited to THIS company: its membership, the person's login facts, effective access per
// app, their company profile and the last audit events about them in this company. Other companies are reported only as a count.
export async function getUserDetails({ actor: c, organizationId: requestedOrg, uid }) {
  const organizationId = resolveOrganizationId(c, requestedOrg);
  const db = adminDb();
  const subject = c.isSuper ? null : (c.orgSubject || (await loadOrgSubject(db, { accountId: organizationId, isOwner: c.isOwner, profile: c.profile }, c.uid)));
  if (!c.isSuper && !orgCan(subject, "users.view")) throw { status: 403, message: "You can't view users" };
  const memSnap = await db.doc(`organizationMemberships/${organizationId}_${uid}`).get();
  if (!memSnap.exists || memSnap.data().status === "removed") throw { status: 404, message: "That person is not a member of this company" };
  const m = memSnap.data();
  const [authUser, unameQ, assigns, subList, teamQ, legacy, others, audit] = await Promise.all([
    adminAuth().getUser(uid).catch(() => null),
    db.collection("usernames").where("uid", "==", uid).limit(1).get(),
    db.collection("appAssignments").where("organizationId", "==", organizationId).where("userId", "==", uid).get(),
    getOrganizationAppSubscriptions(organizationId),
    db.collection(`customers/${organizationId}/team`).where("uid", "==", uid).limit(1).get(),
    db.doc("memberships/" + uid).get(),
    db.collection("organizationMemberships").where("userId", "==", uid).count().get(),
    db.collection("auditLogs").where("targetId", "==", uid).limit(60).get(),
  ]);
  const un = unameQ.empty ? null : { name: unameQ.docs[0].id, ...unameQ.docs[0].data() };
  const team = teamQ.empty ? {} : teamQ.docs[0].data();
  const profile = legacy.exists ? legacy.data().profile || "" : team.profile || "";
  const eff = effectiveOrgRole({ isOwner: uid === organizationId, canonical: m, profile });
  const subs = Object.fromEntries(subList.map((s) => [s.appId, s]));
  const assignBy = Object.fromEntries(assigns.docs.map((d) => [d.data().appId, d.data()]));
  const ex = explainAccess({ orgSubject: eff, apps: Object.keys(subs).sort(), subscriptions: subs, assignments: assignBy, membership: { status: m.status || "active" } });
  const isHome = !!un && un.organizationId === organizationId;
  const loginKind = un ? "username" : authUser?.providerData?.some((p) => p.providerId === "google.com") ? "google" : authUser?.email ? "email" : "unknown";
  const events = audit.docs.map((d) => d.data()).filter((x) => (x.details?.organizationId || organizationId) === organizationId)
    .map((x) => ({ at: x.createdAt?.toMillis?.() || 0, action: x.action, by: x.actorEmail || (x.actorUid ? "an administrator" : "the person") }))
    .sort((a, b) => b.at - a.at).slice(0, 20);
  return {
    uid, name: authUser?.displayName || un?.displayName || [team.firstName, team.lastName].filter(Boolean).join(" "), email: authUser?.email || "", username: un?.name || "",
    loginKind, disabled: !!authUser?.disabled || m.status === "suspended", status: m.status || "active", created: authUser?.metadata?.creationTime || null, lastSignIn: authUser?.metadata?.lastSignInTime || null,
    account: {
      homeCompany: isHome, canEditIdentity: !!un && isHome, accountExpiresAt: un?.accountExpiresAt || "", locked: !!(un?.lockedUntil && un.lockedUntil.toMillis() > Date.now()), pendingActivation: !!un?.mustChangePassword,
      hasRecoveryCodes: !!un && (un.recovery || []).some((r) => !r.used),
      canResetPassword: !!un && isHome && uid !== organizationId && uid !== c.uid && (!!c.isSuper || orgCan(subject, "users.reset_password")),
    },
    nameInfo: { firstName: team.firstName || "", lastName: team.lastName || "" },
    organization: { role: eff.role, roleSource: eff.source, status: m.status || "active", profile, otherOrganizations: Math.max(0, (others.data().count || 1) - 1) },
    profileInfo: { jobTitle: team.designation || team.contactInfo?.jobTitle || "", department: team.department || team.contactInfo?.department || "", branch: team.branch || "", employeeId: team.employeeId || "", employmentType: team.employmentType || team.contactInfo?.employmentType || "", contactInfo: team.contactInfo || null },
    apps: ex.apps,
    activity: events,
  };
}
