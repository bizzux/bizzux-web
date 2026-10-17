// SERVER ONLY. Platform Admin organization provisioning and lifecycle for
// Super Admin -> Organizations.
//
// Uses the SAME data model as self-service onboarding and the Companies tab:
//   customers/{ownerUid}                billing/trial/plan record (admin modes)
//   organizations/{id}                  identity record (id == ownerUid when an admin exists)
//   organizationMemberships/{org}_{uid} who belongs
//   organizationAppSubscriptions/...    which apps the org is entitled to
//   appAssignments/...                  which member may use which app
// Nothing here changes how self-service organizations are created or read.
//
// Safety properties implemented here (and covered by test/orgProvisioning.test.mjs):
//  - Idempotent: a client-supplied requestId maps to provisioningRequests/{id};
//    a retry never creates a second tenant. organizationNameKeys/{hash} is an
//    atomic create-lock so two different requests can't make the same org.
//  - All-or-nothing: any failure rolls back every Auth user / doc written.
//  - No stored plaintext passwords: temp passwords are random, hashed by
//    createUsernameUser (scrypt), returned once to the authorized caller and
//    never written to Firestore or audit logs. mustChangePassword is forced.
//  - Plan is chosen explicitly; the caller's own subscription is never copied.
import { createHash } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb, requireSuperAdmin, generateTempPassword } from "./firebaseAdmin";
import { COUNTRIES } from "./countries";
import { PROFILE_VALUES, DEFAULT_PROFILE } from "./roles";
import { APP_IDS } from "./appCatalog";
import { logAuditEvent } from "./audit";
import { createOrganization } from "./organization";
import { upsertOrganizationMembership, roleFromProfile } from "./organizationMembership";
import { upsertOrganizationAppSubscription, upsertAppAssignment } from "./appAccess";
import { createUsernameUser, usernameForUid, setUsernamePassword, USERNAME_RE, normalizeUsername, tempExpiry } from "./usernameAuth";
import { newAccountInviteEmailHtml } from "./emailTemplates";

export const SETUP_MODES = ["ORG_ONLY", "ORG_ADMIN", "ORG_ADMIN_USERS"];
export const LOGIN_METHODS = ["USERNAME_TEMP", "EMAIL_INVITE"];
// TEST: for Bizzux's own testing, behaves like a real customer but with no trial
// clock and no billing (reuses the existing complimentary-license mechanics:
// status "active" + billing "complimentary", never counted as paying).
// INTERNAL: Bizzux's own company and sister concerns. Same free/no-expiry
// mechanics as TEST, but a real company: org type INTERNAL, never flagged as
// test, left out of customer revenue, deletable only by the Platform Owner.
export const PLAN_TYPES = ["TRIAL", "PAID", "TEST", "INTERNAL"];
const noExpiry = (t) => t === "TEST" || t === "INTERNAL";
export const subscriptionTypeFor = (planType) => (planType === "PAID" ? "PAID" : noExpiry(planType) ? "INTERNAL" : "TRIAL");
// Bizzux's pre-existing own organization (created outside this page) stays
// untouchable here; group companies provisioned here are manageable.
const isProtectedInternal = (org) => org.type === "INTERNAL" && org.provisionedVia !== "platform-admin";

// customers/{id} fields that realize a plan choice. Existing access gates read
// status/trialEndDate, so TRIAL/PAID keep the status "trial" window as before.
// forCreate omits the delete-sentinels (only legal in merge/update writes).
function customerPlanFields(planType, expiresAt, now, forCreate = false) {
  const del = (o) => (forCreate ? {} : o);
  if (noExpiry(planType)) {
    return {
      planType, status: "active", billing: "complimentary", planId: "", planName: planType === "TEST" ? "Test" : "Internal",
      isTestAccount: planType === "TEST", isInternal: planType === "INTERNAL", trialStartDate: now, ...del({ compUntil: FieldValue.delete(), trialEndDate: FieldValue.delete() }),
    };
  }
  return {
    planType, status: "trial", planId: "", planName: planType === "PAID" ? "Admin-provisioned (paid)" : "Trial",
    isTestAccount: false, isInternal: false, trialStartDate: now, trialEndDate: expiresAt,
    ...del({ billing: FieldValue.delete(), compUntil: FieldValue.delete() }),
  };
}
export const INDUSTRIES = [
  "Retail", "Services", "Manufacturing", "Marine & Engineering", "Hospitality",
  "Healthcare", "Education", "Construction", "Technology", "Other",
];
export const MAX_BATCH_USERS = 50;

// --- Platform permissions ------------------------------------------------
// platformAdmins/{uid}.permissions was always written (null) but never read.
// null = the default set below; an array = exactly those permissions. The
// Owner always has everything EXCEPT hard delete is Owner-only by design.
export const ORG_PERMISSIONS = [
  "organizations.create", "organizations.manage", "organizations.suspend",
  "organizations.archive", "organizations.delete", "organizations.delete_test",
];
export const DEFAULT_ADMIN_ORG_PERMISSIONS = [
  "organizations.create", "organizations.manage", "organizations.suspend", "organizations.archive",
  "organizations.delete_test",
];

export async function requireOrgPermission(req, perm) {
  const c = await requireSuperAdmin(req);
  return assertOrgPermission(c, perm);
}

export async function assertOrgPermission(c, perm) {
  if (c.platformRole === "OWNER") return c;
  if (perm === "organizations.delete") {
    throw { status: 403, message: "Only the Platform Owner can permanently delete an organization" };
  }
  const snap = await adminDb().doc("platformAdmins/" + c.uid).get();
  const stored = snap.exists ? snap.data().permissions : null;
  const perms = Array.isArray(stored) ? stored : DEFAULT_ADMIN_ORG_PERMISSIONS;
  if (!perms.includes(perm)) throw { status: 403, message: "You don't have permission for this action (" + perm + ")" };
  return c;
}

// --- helpers --------------------------------------------------------------
const str = (v, n) => String(v ?? "").trim().slice(0, n);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const toIso = (t) => (t && typeof t.toDate === "function" ? t.toDate().toISOString() : t || null);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function nameKeyFor(name, countryCode) {
  return String(name).toLowerCase().replace(/\s+/g, " ").trim() + "|" + countryCode;
}
const lockRef = (nameKey) =>
  adminDb().doc("organizationNameKeys/" + createHash("sha256").update(nameKey).digest("hex").slice(0, 40));

function parseApps(v) {
  const apps = [...new Set(Array.isArray(v) ? v : [])];
  const bad = apps.filter((a) => !APP_IDS.includes(a));
  if (bad.length) throw { status: 400, message: "Unknown application: " + bad.join(", ") };
  return apps;
}

function parseExpiry(v) {
  const d = new Date(v);
  if (!v || isNaN(d)) throw { status: 400, message: "Subscription expiry date is required" };
  if (d.getTime() <= Date.now()) throw { status: 400, message: "Subscription expiry must be in the future" };
  return Timestamp.fromDate(d);
}

function parsePerson(p, label, { emailRequiredFor = "EMAIL_INVITE" } = {}) {
  p = p || {};
  const fullName = str(p.fullName, 80);
  if (!fullName) throw { status: 400, message: label + ": full name is required" };
  const loginMethod = LOGIN_METHODS.includes(p.loginMethod) ? p.loginMethod : null;
  if (!loginMethod) throw { status: 400, message: label + ": choose a login provisioning method" };
  const email = str(p.email, 200).toLowerCase();
  if (email && !EMAIL_RE.test(email)) throw { status: 400, message: label + ": enter a valid email address" };
  if (loginMethod === emailRequiredFor && !email) throw { status: 400, message: label + ": email is required for an email invitation" };
  let username = null;
  if (loginMethod === "USERNAME_TEMP") {
    username = normalizeUsername(p.username);
    if (!USERNAME_RE.test(username)) {
      throw { status: 400, message: label + ": username must be 3-32 characters (letters, numbers, dot, dash, underscore)" };
    }
  }
  // Whether the person must choose a new password at first login is the
  // platform admin's choice (default on). Only meaningful for temp-password logins.
  const requirePasswordChange = p.requirePasswordChange !== false;
  // Password: generated by default, or typed by the admin (never echoed back
  // or stored in plaintext; only the scrypt hash is kept).
  const manualPassword = loginMethod === "USERNAME_TEMP" && p.passwordMode === "MANUAL";
  let password = null;
  if (manualPassword) {
    password = String(p.password || "");
    if (password.length < 8 || password.length > 100) throw { status: 400, message: label + ": password must be 8-100 characters" };
  }
  return { fullName, loginMethod, email, username, phone: str(p.phone, 20), requirePasswordChange, password };
}

export function validateProvisionInput(body) {
  const setupMode = body.setupMode;
  if (!SETUP_MODES.includes(setupMode)) throw { status: 400, message: "Choose a setup mode" };

  const requestId = String(body.requestId || "");
  if (!REQUEST_ID_RE.test(requestId)) throw { status: 400, message: "A valid requestId is required" };

  const organizationName = str(body.organizationName, 160);
  if (!organizationName) throw { status: 400, message: "Organization name is required" };
  const industry = str(body.industry, 60);
  if (!INDUSTRIES.includes(industry)) throw { status: 400, message: "Choose an industry / business category" };

  const countryCode = str(body.countryCode, 2).toUpperCase();
  const country = COUNTRIES.find(([code]) => code === countryCode);
  if (!country) throw { status: 400, message: "Choose a valid country" };
  const timezone = str(body.timezone, 60);
  if (!timezone) throw { status: 400, message: "Time zone is required" };
  const currency = str(body.currency, 10).toUpperCase();
  if (!currency) throw { status: 400, message: "Currency is required" };

  const planType = body.planType;
  if (!PLAN_TYPES.includes(planType)) throw { status: 400, message: "Choose a subscription plan (Trial, Paid, Test or Internal)" };
  const expiresAt = noExpiry(planType) ? null : parseExpiry(body.expiryDate);
  const seats = parseInt(body.licensedSeats, 10);
  if (!(seats >= 1 && seats <= 100000)) throw { status: 400, message: "Licensed seats must be between 1 and 100000" };
  const apps = parseApps(body.apps);
  if (!apps.length) throw { status: 400, message: "Enable at least one application" };

  let admin = null;
  let users = [];
  if (setupMode !== "ORG_ONLY") {
    admin = parsePerson(body.admin, "Organization admin");
  }
  if (setupMode === "ORG_ADMIN_USERS") {
    const list = Array.isArray(body.users) ? body.users : [];
    if (!list.length) throw { status: 400, message: "Add at least one user, or choose a different setup mode" };
    if (list.length > MAX_BATCH_USERS) throw { status: 400, message: "At most " + MAX_BATCH_USERS + " users can be created at once" };
    users = list.map((u, i) => {
      const person = parsePerson(u, "User " + (i + 1));
      const profile = PROFILE_VALUES.includes(u.profile) ? u.profile : DEFAULT_PROFILE;
      const userApps = parseApps(u.apps).filter((a) => apps.includes(a));
      return { ...person, profile, apps: userApps };
    });
  }
  if (1 + users.length > seats && admin) {
    throw { status: 400, message: "Licensed seats (" + seats + ") is smaller than the number of users being created (" + (1 + users.length) + ")" };
  }
  const everyone = [admin, ...users].filter(Boolean);
  const names = everyone.filter((p) => p.username).map((p) => p.username);
  const mails = everyone.filter((p) => p.email).map((p) => p.email);
  if (new Set(names).size !== names.length) throw { status: 400, message: "Duplicate username in this request" };
  if (new Set(mails).size !== mails.length) throw { status: 400, message: "Duplicate email in this request" };

  return {
    setupMode, requestId, organizationName, industry,
    countryCode, countryName: country[1], state: str(body.state, 100), city: str(body.city, 100),
    timezone, currency, planType, expiresAt, seats, apps,
    contactEmail: str(body.contactEmail, 200).toLowerCase(), contactPhone: str(body.contactPhone, 20),
    admin, users,
  };
}

async function applyEntitlements(orgId, apps, subscriptionType) {
  await Promise.all(APP_IDS.map((appId) =>
    upsertOrganizationAppSubscription({
      organizationId: orgId, appId,
      status: apps.includes(appId) ? "ACTIVE" : "INACTIVE", subscriptionType,
    })));
  const removed = APP_IDS.filter((a) => !apps.includes(a));
  if (!removed.length) return;
  const snap = await adminDb().collection("appAssignments").where("organizationId", "==", orgId).get();
  await Promise.all(snap.docs.filter((d) => removed.includes(d.data().appId))
    .map((d) => d.ref.update({ status: "INACTIVE", updatedAt: FieldValue.serverTimestamp() })));
}

// Real email invitation: the person gets a Firebase password-setup link via
// Resend (same delivery path as team invites). No password exists until they
// choose one, so nothing secret is ever generated or stored for this method.
export async function sendOrgInviteEmail({ email, orgName, origin }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Email delivery isn't configured");
  const { Resend } = await import("resend");
  const link = await adminAuth().generatePasswordResetLink(email, { url: origin + "/sign-in", handleCodeInApp: true });
  const from = process.env.RESEND_FROM_EMAIL || "Bizzux <verify@verify.bizzux.com>";
  const { error } = await new Resend(apiKey).emails.send({
    from, to: email,
    subject: `You've been invited to ${orgName}`,
    html: newAccountInviteEmailHtml({ orgName: esc(orgName), link }),
  });
  if (error) throw new Error(error.message || "Could not send invite email");
}

// --- Provisioning ---------------------------------------------------------
// deps.sendInvite is injectable for tests.
export async function provisionOrganization({ actor, body, origin }, deps = {}) {
  const sendInvite = deps.sendInvite || sendOrgInviteEmail;
  await assertOrgPermission(actor, "organizations.create");
  const input = validateProvisionInput(body);
  const db = adminDb();

  // 1) Idempotency claim.
  const reqRef = db.doc("provisioningRequests/" + input.requestId);
  const replay = await db.runTransaction(async (tx) => {
    const s = await tx.get(reqRef);
    if (s.exists) {
      const d = s.data();
      if (d.actorUid !== actor.uid) throw { status: 409, message: "Request id already used" };
      if (d.status === "done") return d;
      if (d.status === "in_progress" && Date.now() - d.startedAt.toMillis() < 120000) {
        throw { status: 409, message: "This request is already being processed" };
      }
    }
    tx.set(reqRef, { actorUid: actor.uid, status: "in_progress", startedAt: Timestamp.now(), setupMode: input.setupMode });
    return null;
  });
  if (replay) {
    return { replay: true, organizationId: replay.organizationId, summary: replay.summary || {}, credentials: [], invites: replay.invites || [] };
  }

  // 2) Atomic name lock — two requests can never both create the same org.
  // TEST accounts deliberately skip the lock: testers create many look-alike customers.
  const nameKey = nameKeyFor(input.organizationName, input.countryCode);
  const lock = lockRef(nameKey);
  const useLock = input.planType !== "TEST";
  try {
    if (useLock) await lock.create({ requestId: input.requestId, nameKey, createdAt: FieldValue.serverTimestamp() });
  } catch (e) {
    const cur = await lock.get();
    if (!(cur.exists && cur.data().requestId === input.requestId)) {
      await reqRef.set({ status: "failed", error: "duplicate name", finishedAt: FieldValue.serverTimestamp() }, { merge: true });
      throw { status: 409, message: "An organization with this name already exists in that country" };
    }
  }

  const written = { authUids: [], usernames: [], refs: [], orgId: null };
  try {
    const result = await build({ actor, input, written, sendInvite, origin });
    await reqRef.set({
      status: "done", organizationId: result.organizationId, summary: result.summary,
      invites: result.invites, finishedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { replay: false, ...result };
  } catch (e) {
    await rollback(written);
    if (useLock) await lock.delete().catch(() => {});
    await reqRef.set({ status: "failed", error: String(e?.message || e).slice(0, 300), finishedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw e;
  }
}

async function rollback(w) {
  const db = adminDb();
  if (w.orgId) {
    for (const col of ["organizationAppSubscriptions", "appAssignments", "organizationMemberships"]) {
      const snap = await db.collection(col).where("organizationId", "==", w.orgId).get().catch(() => null);
      if (snap) await Promise.all(snap.docs.map((d) => d.ref.delete().catch(() => {})));
    }
    const team = await db.collection("customers/" + w.orgId + "/team").get().catch(() => null);
    if (team) await Promise.all(team.docs.map((d) => d.ref.delete().catch(() => {})));
    await db.doc("organizations/" + w.orgId).delete().catch(() => {});
  }
  await Promise.all(w.refs.map((r) => r.delete().catch(() => {})));
  await Promise.all(w.usernames.map((u) => db.doc("usernames/" + u).delete().catch(() => {})));
  await Promise.all(w.authUids.map((u) => adminAuth().deleteUser(u).catch(() => {})));
}

// Creates the sign-in identity for one person. Returns the uid plus, for the
// temp-password method, the one-time password (never persisted).
async function createIdentity(person, { organizationId, actor, written }) {
  if (person.loginMethod === "USERNAME_TEMP") {
    const manual = !!person.password;
    const password = manual ? person.password : generateTempPassword();
    const { uid, username } = await createUsernameUser({
      username: person.username, password, displayName: person.fullName,
      organizationId, mustChangePassword: person.requirePasswordChange, createdBy: actor.uid,
      tempExpiresAt: person.requirePasswordChange ? tempExpiry() : null,
    });
    written.authUids.push(uid);
    written.usernames.push(username);
    return { uid, credential: { fullName: person.fullName, username, passwordSource: manual ? "MANUAL" : "GENERATED", ...(manual ? {} : { temporaryPassword: password }), mustChangePassword: person.requirePasswordChange, expiresInHours: person.requirePasswordChange ? 72 : null } };
  }
  try {
    const u = await adminAuth().createUser({ email: person.email, displayName: person.fullName, emailVerified: false });
    written.authUids.push(u.uid);
    return { uid: u.uid, credential: null };
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      throw { status: 409, message: person.email + " already has a Bizzux sign-in. Use a different email, or have them create the organization themselves." };
    }
    throw e;
  }
}

async function build({ actor, input, written, sendInvite, origin }) {
  const db = adminDb();
  const now = Timestamp.now();
  const subscriptionType = subscriptionTypeFor(input.planType);
  const isTest = input.planType === "TEST";
  const orgType = input.planType === "INTERNAL" ? "INTERNAL" : "CUSTOMER";
  const credentials = [];
  const inviteTargets = [];
  let orgId;

  const common = {
    organizationName: input.organizationName, name: input.organizationName,
    industry: input.industry, countryCode: input.countryCode, countryName: input.countryName,
    state: input.state, city: input.city, timezone: input.timezone, currency: input.currency,
    planType: input.planType, allowedUsers: input.seats, expiresAt: input.expiresAt,
    apps: input.apps, setupMode: input.setupMode, isTestAccount: isTest,
    nameKey: isTest ? null : nameKeyFor(input.organizationName, input.countryCode),
    provisionedVia: "platform-admin", provisionedBy: actor.uid, provisionedByEmail: actor.email,
  };

  if (input.setupMode === "ORG_ONLY") {
    orgId = db.collection("organizations").doc().id;
    written.orgId = orgId;
    await createOrganization({ id: orgId, name: input.organizationName, type: orgType, createdBy: actor.uid });
    await db.doc("organizations/" + orgId).set({
      ...common, status: "pending_admin", adminUid: null, adminName: null,
      contactEmail: input.contactEmail, contactPhone: input.contactPhone,
    }, { merge: true });
    await applyEntitlements(orgId, input.apps, subscriptionType);
  } else {
    const admin = input.admin;
    const { uid, credential } = await createIdentity(admin, { organizationId: null, actor, written });
    orgId = uid;
    written.orgId = orgId;
    if (credential) credentials.push({ role: "Organization Admin", ...credential });
    else inviteTargets.push({ email: admin.email, fullName: admin.fullName, role: "Organization Admin" });

    const companyCode = "BZ" + Math.random().toString(36).slice(2, 8).toUpperCase();
    const mustChange = admin.loginMethod === "USERNAME_TEMP" && admin.requirePasswordChange;
    const ref = db.doc("customers/" + uid);
    written.refs.push(ref);
    await ref.set({
      organizationName: input.organizationName, companyName: input.organizationName, companyCode,
      industry: input.industry, state: input.state, city: input.city,
      countryCode: input.countryCode, country: input.countryName,
      phone: input.contactPhone, phoneVerified: false, email: input.contactEmail || admin.email || "",
      owner: {
        name: admin.fullName, username: admin.username || "", phone: admin.phone, phoneVerified: false,
        email: admin.email, loginMethod: admin.loginMethod,
      },
      timezone: input.timezone, currency: input.currency,
      planType: input.planType, allowedUsers: input.seats, companyStatus: "active",
      // Existing access gates read trialStartDate/trialEndDate/status.
      ...customerPlanFields(input.planType, input.expiresAt, now, true),
      onboarded: false, verifyEmailRequired: false, verifyMobileRequired: false,
      createdByAdmin: true, createdByAdminEmail: actor.email, mustChangePassword: mustChange,
      createdAt: FieldValue.serverTimestamp(),
    });
    await createOrganization({ id: uid, name: input.organizationName, type: orgType, createdBy: actor.uid });
    await db.doc("organizations/" + uid).set({
      ...common, status: "active", adminUid: uid, adminName: admin.fullName,
      adminLoginMethod: admin.loginMethod, adminContact: admin.email || admin.username, adminUsername: admin.username || null,
      companyCode, contactEmail: input.contactEmail, contactPhone: input.contactPhone,
    }, { merge: true });
    await upsertOrganizationMembership({ organizationId: uid, userId: uid, role: "OWNER", status: "active" });
    await applyEntitlements(uid, input.apps, subscriptionType);
    await Promise.all(input.apps.map((appId) =>
      upsertAppAssignment({ organizationId: uid, userId: uid, appId, role: "OWNER", status: "ACTIVE" })));

    for (const u of input.users) {
      const ident = await createIdentity(u, { organizationId: orgId, actor, written });
      if (ident.credential) credentials.push({ role: u.profile, ...ident.credential });
      else inviteTargets.push({ email: u.email, fullName: u.fullName, role: u.profile });
      const userMustChange = u.loginMethod === "USERNAME_TEMP" && u.requirePasswordChange;
      await db.collection("customers/" + orgId + "/team").add({
        firstName: u.fullName, lastName: "", email: u.email, username: u.username || "",
        role: u.profile, profile: u.profile, mobile: u.phone, mobileVerified: false,
        status: "active", uid: ident.uid,
        invitedBy: actor.email || actor.uid, invitedAt: FieldValue.serverTimestamp(), joinedAt: FieldValue.serverTimestamp(),
      });
      await db.doc("memberships/" + ident.uid).set({
        accountId: orgId, profile: u.profile, role: u.profile, email: u.email, username: u.username || "",
        joinedAt: FieldValue.serverTimestamp(), mustChangePassword: userMustChange,
      });
      written.refs.push(db.doc("memberships/" + ident.uid));
      await upsertOrganizationMembership({ organizationId: orgId, userId: ident.uid, role: roleFromProfile(u.profile, false), status: "active" });
      await Promise.all(u.apps.map((appId) =>
        upsertAppAssignment({ organizationId: orgId, userId: ident.uid, appId, role: "MEMBER", status: "ACTIVE" })));
    }
  }

  // Everything is durable; only now send emails (a mail failure must not undo
  // a correctly provisioned organization — the admin can resend).
  const invites = [];
  for (const t of inviteTargets) {
    try {
      await sendInvite({ email: t.email, orgName: input.organizationName, origin });
      invites.push({ email: t.email, role: t.role, sent: true });
    } catch (e) {
      invites.push({ email: t.email, role: t.role, sent: false, error: String(e?.message || e).slice(0, 200) });
    }
  }

  const summary = {
    setupMode: input.setupMode, planType: input.planType, seats: input.seats, apps: input.apps,
    adminName: input.admin?.fullName || null, userCount: input.users.length,
  };
  // Audit: never includes passwords. Admin assignment and entitlements are
  // recorded as their own events so each is independently queryable.
  await logAuditEvent({
    action: "organization.provision", actor, targetType: "organization", targetId: orgId,
    details: { name: input.organizationName, setupMode: input.setupMode, planType: input.planType, seats: input.seats, requestId: input.requestId },
  });
  if (input.admin) {
    await logAuditEvent({
      action: "organization.admin_assigned", actor, targetType: "organization", targetId: orgId,
      details: { adminUid: orgId, adminName: input.admin.fullName, loginMethod: input.admin.loginMethod, usersCreated: input.users.length },
    });
  }
  await logAuditEvent({
    action: "organization.entitlements_set", actor, targetType: "organization", targetId: orgId,
    details: { apps: input.apps, planType: input.planType, seats: input.seats },
  });

  return { organizationId: orgId, summary, credentials, invites };
}

// Reset the organization admin's password (username logins). Generated by
// default; returned once, never stored. Also unlocks a locked-out account.
export async function resetOrgAdminPassword({ actor, organizationId, password, requirePasswordChange = true }) {
  await assertOrgPermission(actor, "organizations.manage");
  const { id, org, customer, custRef } = await loadOrg(organizationId);
  if (!org.adminUid || !customer) throw { status: 400, message: "This organization has no administrator login to reset" };
  const doc = await usernameForUid(org.adminUid);
  if (!doc) throw { status: 400, message: "The administrator signs in by email; use Resend invite so they can set a new password" };
  const manual = !!String(password || "").trim();
  const pw = manual ? String(password).trim() : generateTempPassword();
  if (pw.length < 8 || pw.length > 100) throw { status: 400, message: "Password must be 8-100 characters" };
  const must = requirePasswordChange !== false;
  await setUsernamePassword(org.adminUid, pw, must, { tempExpiresAt: must ? tempExpiry() : null });
  await doc.ref.update({ failedCount: 0, lockedUntil: null });
  await custRef.set({ mustChangePassword: must }, { merge: true });
  await logAuditEvent({
    action: "organization.admin_password_reset", actor, targetType: "organization", targetId: id,
    details: { adminUid: org.adminUid, source: manual ? "MANUAL" : "GENERATED", requirePasswordChange: must },
  });
  return { ok: true, username: doc.id, mustChangePassword: must, ...(manual ? {} : { temporaryPassword: pw }) };
}

export async function resendOrgInvite({ actor, organizationId, origin }, deps = {}) {
  const send = deps.sendInvite || sendOrgInviteEmail;
  const org = await adminDb().doc("organizations/" + organizationId).get();
  if (!org.exists || org.data().adminLoginMethod !== "EMAIL_INVITE") {
    throw { status: 400, message: "This organization's administrator was not set up by email invitation" };
  }
  const email = org.data().adminContact;
  await send({ email, orgName: org.data().organizationName || org.data().name, origin });
  await logAuditEvent({ action: "organization.invite_resent", actor, targetType: "organization", targetId: organizationId, details: { email } });
  return { ok: true, email };
}

// --- Lifecycle ------------------------------------------------------------
// Admin-provisioned (or placeholder) orgs are fully editable; self-service
// orgs keep their own billing, so only status changes are allowed on them.
function isAdminManaged(org, customer) {
  if (!org.type) return true; // legacy placeholder
  if (org.provisionedVia === "platform-admin") return true;
  return !!customer?.createdByAdmin;
}

async function loadOrg(organizationId) {
  const id = str(organizationId, 128);
  if (!id) throw { status: 400, message: "Organization id required" };
  const [orgSnap, custSnap] = await Promise.all([
    adminDb().doc("organizations/" + id).get(),
    adminDb().doc("customers/" + id).get(),
  ]);
  if (!orgSnap.exists) throw { status: 404, message: "Organization not found" };
  return { id, org: orgSnap.data(), orgRef: orgSnap.ref, customer: custSnap.exists ? custSnap.data() : null, custRef: custSnap.ref };
}

async function memberUids(id) {
  const team = await adminDb().collection("customers/" + id + "/team").get();
  return [id, ...team.docs.map((d) => d.data().uid).filter(Boolean)];
}

export async function changeOrganizationStatus({ actor, organizationId, action }) {
  const map = { suspend: "organizations.suspend", archive: "organizations.archive", reactivate: "organizations.suspend" };
  if (!map[action]) throw { status: 400, message: "Unknown status action" };
  await assertOrgPermission(actor, map[action]);
  const { id, org, orgRef, customer, custRef } = await loadOrg(organizationId);
  if (isProtectedInternal(org)) throw { status: 400, message: "Bizzux's own organization can't be changed here" };
  const cur = org.status || "active";
  const patch = { updatedAt: FieldValue.serverTimestamp() };
  const custPatch = {};

  if (action === "reactivate") {
    if (!["suspended", "archived"].includes(cur)) throw { status: 400, message: "Organization is not suspended or archived" };
    if (cur === "archived" && org.nameKey) {
      try {
        await lockRef(org.nameKey).create({ requestId: "reactivate-" + id, nameKey: org.nameKey, createdAt: FieldValue.serverTimestamp() });
      } catch {
        throw { status: 409, message: "Another organization now uses this name; rename before reactivating" };
      }
    }
    patch.status = !org.type ? "pending" : customer || org.adminUid ? "active" : "pending_admin";
    patch.archivedAt = FieldValue.delete();
    if (customer) {
      custPatch.companyStatus = "active";
      custPatch.status = customer.prevStatus || "trial";
      custPatch.prevStatus = FieldValue.delete();
      custPatch.archived = FieldValue.delete();
    }
  } else {
    if (cur === "archived") throw { status: 400, message: "Organization is already archived" };
    if (action === "suspend" && cur === "suspended") throw { status: 400, message: "Organization is already suspended" };
    patch.status = action === "archive" ? "archived" : "suspended";
    if (action === "archive") {
      patch.archivedAt = FieldValue.serverTimestamp();
      patch.archivedBy = actor.uid;
      if (org.nameKey) await lockRef(org.nameKey).delete().catch(() => {});
    }
    if (customer) {
      if (!["suspended", "expired"].includes(customer.status)) custPatch.prevStatus = customer.status || "trial";
      custPatch.companyStatus = "suspended";
      custPatch.status = "suspended";
      if (action === "archive") custPatch.archived = true;
    }
  }
  await orgRef.set(patch, { merge: true });
  if (customer && Object.keys(custPatch).length) await custRef.set(custPatch, { merge: true });
  if (customer && action !== "reactivate") {
    // End live sessions too, not just future logins.
    const uids = await memberUids(id);
    await Promise.all(uids.map((u) => adminAuth().revokeRefreshTokens(u).catch(() => {})));
  }
  await logAuditEvent({
    action: "organization." + action, actor, targetType: "organization", targetId: id,
    details: { from: cur, to: patch.status },
  });
  return { ok: true, status: patch.status };
}

export async function updateOrganizationEntitlements({ actor, organizationId, body }) {
  await assertOrgPermission(actor, "organizations.manage");
  const { id, org, orgRef, customer, custRef } = await loadOrg(organizationId);
  if (!isAdminManaged(org, customer)) {
    throw { status: 400, message: "Self-service organizations manage their own plan and apps; only status can be changed here" };
  }
  const before = { apps: org.apps || null, planType: org.planType || null, seats: org.allowedUsers ?? null };
  const patch = { updatedAt: FieldValue.serverTimestamp() };
  const custPatch = {};
  let newExpiry = null;
  if (body.expiryDate) newExpiry = parseExpiry(body.expiryDate);
  if (body.planType !== undefined && body.planType !== (org.planType || null)) {
    if (!PLAN_TYPES.includes(body.planType)) throw { status: 400, message: "Invalid plan" };
    if (["suspended", "archived"].includes(org.status)) throw { status: 400, message: "Reactivate the organization before changing its plan" };
    const expiry = newExpiry || customer?.trialEndDate || null;
    if ((body.planType === "INTERNAL") !== (org.planType === "INTERNAL")) throw { status: 400, message: "An organization can't be switched to or from the Internal plan" };
    if (!noExpiry(body.planType) && !expiry) throw { status: 400, message: "Set an expiry date for a Trial or Paid plan" };
    patch.planType = body.planType; patch.isTestAccount = body.planType === "TEST";
    patch.nameKey = body.planType === "TEST" ? null : org.nameKey || null;
    patch.expiresAt = noExpiry(body.planType) ? null : expiry;
    if (customer) Object.assign(custPatch, customerPlanFields(body.planType, expiry, customer.trialStartDate || Timestamp.now()));
    newExpiry = null;
  }
  if (body.licensedSeats !== undefined) {
    const n = parseInt(body.licensedSeats, 10);
    if (!(n >= 1 && n <= 100000)) throw { status: 400, message: "Licensed seats must be between 1 and 100000" };
    patch.allowedUsers = n; custPatch.allowedUsers = n;
  }
  if (newExpiry && !noExpiry(patch.planType || org.planType)) {
    patch.expiresAt = newExpiry; custPatch.trialEndDate = newExpiry;
  }
  let apps = null;
  if (body.apps !== undefined) {
    apps = parseApps(body.apps);
    if (!apps.length) throw { status: 400, message: "Enable at least one application" };
    patch.apps = apps;
  }
  await orgRef.set(patch, { merge: true });
  if (customer && Object.keys(custPatch).length) await custRef.set(custPatch, { merge: true });
  if (patch.planType && !apps) apps = org.apps || null;
  if (apps) {
    const planType = patch.planType || org.planType;
    await applyEntitlements(id, apps, subscriptionTypeFor(planType));
  }
  await logAuditEvent({
    action: "organization.entitlements_set", actor, targetType: "organization", targetId: id,
    details: { before, after: { apps: apps || before.apps, planType: patch.planType || before.planType, seats: patch.allowedUsers ?? before.seats } },
  });
  return { ok: true };
}

// Permanent deletion: Platform Owner only, archived (or never-claimed
// placeholder) organizations only, and only when no user accounts hang off
// it. Anything with real users must go through the account close/purge flow.
// Test organizations (isTestAccount) can be wiped, users and data included, by
// any Platform Admin holding organizations.delete_test, after typing the name.
// Everything else stays Owner-only and users-must-be-gone.
export async function deleteOrganizationPermanently({ actor, organizationId, confirmName }, deps = {}) {
  const { id, org, orgRef, customer } = await loadOrg(organizationId);
  if (org.isTestAccount === true && (!customer || customer.isTestAccount !== false)) {
    await assertOrgPermission(actor, "organizations.delete_test");
    return deleteTestOrganization({ actor, id, org, customer, confirmName }, deps);
  }
  await assertOrgPermission(actor, "organizations.delete");
  if (org.type === "INTERNAL") throw { status: 400, message: "Internal organizations can't be deleted here" };
  const name = org.organizationName || org.name || "";
  if (!["archived", "pending", "pending_admin"].includes(org.status || "")) {
    throw { status: 400, message: "Archive the organization before permanently deleting it" };
  }
  if (customer) {
    throw { status: 400, message: "This organization has user accounts. Close them via Customers first; permanent deletion is only for organizations with no users." };
  }
  if (String(confirmName || "").trim() !== name) throw { status: 400, message: "Type the organization name exactly to confirm" };
  const db = adminDb();
  for (const col of ["organizationAppSubscriptions", "appAssignments", "organizationMemberships"]) {
    const snap = await db.collection(col).where("organizationId", "==", id).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  if (org.nameKey) await lockRef(org.nameKey).delete().catch(() => {});
  await orgRef.delete();
  await logAuditEvent({ action: "organization.delete", actor, targetType: "organization", targetId: id, details: { name } });
  return { ok: true };
}

async function deleteTestOrganization({ actor, id, org, customer, confirmName }, deps) {
  const name = org.organizationName || org.name || "";
  if (String(confirmName || "").trim() !== name) throw { status: 400, message: "Type the organization name exactly to confirm" };
  const db = adminDb();
  const purge = deps.purgeUser || (await import("./userPurge")).purgeUser;
  const report = { users: 0, skipped: [] };
  if (customer) {
    const team = await db.collection("customers/" + id + "/team").get();
    for (const m of team.docs) {
      const uid = m.data().uid;
      if (!uid) continue;
      const r = await purge({ uid, email: m.data().email || "", ownsBusiness: false, memberOf: { accountId: id } });
      report.users++;
      report.skipped.push(...(r?.skipped || []));
    }
    const r = await purge({ uid: id, email: customer.email || "", ownsBusiness: true, memberOf: null });
    report.users++;
    report.skipped.push(...(r?.skipped || []));
  }
  // Username logins, and anything left in the org's own collections.
  const names = await db.collection("usernames").where("organizationId", "==", id).get();
  await Promise.all(names.docs.map((d) => d.ref.delete()));
  for (const col of ["organizationAppSubscriptions", "appAssignments", "organizationMemberships"]) {
    const snap = await db.collection(col).where("organizationId", "==", id).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await db.recursiveDelete(db.doc("customers/" + id));
  await db.doc("organizations/" + id).delete();
  await logAuditEvent({
    action: "organization.delete_test", actor, targetType: "organization", targetId: id,
    details: { name, usersRemoved: report.users, skipped: report.skipped },
  });
  return { ok: true, usersRemoved: report.users, skipped: report.skipped };
}

// --- Listing --------------------------------------------------------------
export function normalizeOrganizationRow(id, org, customer, activeUsers) {
  const kind = !org.type ? "placeholder" : org.provisionedVia === "platform-admin" || customer?.createdByAdmin ? "admin-provisioned" : "self-service";
  // Real orgs store `name`; legacy placeholders store `organizationName`.
  const name = org.organizationName || org.name || customer?.organizationName || customer?.companyName || "(unnamed)";
  const planType = org.planType || customer?.planType || null;
  const planLabel = planType === "INTERNAL" ? "Internal" : planType === "TEST" ? "Test" : planType === "PAID" ? "Paid"
    : planType === "TRIAL" ? "Trial"
    : customer ? (customer.status === "trial" || !customer.planId ? "Trial" : customer.planName || "—")
    : org.planName || "—";
  const adminName = org.adminName || customer?.owner?.name || customer?.fullName || customer?.displayName || "";
  return {
    id, name, kind,
    status: org.status || "active",
    adminName, adminContact: org.adminContact || customer?.owner?.username || customer?.email || "",
    adminUsername: org.adminUsername || customer?.owner?.username || null,
    adminLoginMethod: org.adminLoginMethod || null,
    awaitingActivation: !!(customer?.mustChangePassword),
    planLabel, planType,
    licensedSeats: org.allowedUsers ?? customer?.allowedUsers ?? null,
    estimatedUsers: org.userRange || customer?.userRange || null,
    activeUsers,
    industry: org.industry || customer?.industry || "",
    country: org.countryName || customer?.country || "",
    appCount: Array.isArray(org.apps) ? org.apps.length : null,
    apps: Array.isArray(org.apps) ? org.apps : null,
    expiresAt: toIso(org.expiresAt || customer?.trialEndDate),
    createdAt: toIso(org.createdAt),
    editable: kind !== "self-service" && !isProtectedInternal(org),
    internal: isProtectedInternal(org),
    isInternalCompany: org.planType === "INTERNAL",
    isTest: org.isTestAccount === true || customer?.isTestAccount === true,
  };
}

export async function listOrganizations({ includeArchived = false } = {}) {
  const db = adminDb();
  const snap = await db.collection("organizations").orderBy("createdAt", "desc").limit(300).get();
  const orgs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  const withCust = orgs.filter((o) => o.data.type);
  const custSnaps = withCust.length ? await db.getAll(...withCust.map((o) => db.doc("customers/" + o.id))) : [];
  const customers = Object.fromEntries(custSnaps.map((s) => [s.id, s.exists ? s.data() : null]));
  // Live active-user count per organization (aggregate query: ~1 read each).
  const counts = {};
  for (let i = 0; i < withCust.length; i += 25) {
    await Promise.all(withCust.slice(i, i + 25).map(async (o) => {
      const r = await db.collection("organizationMemberships")
        .where("organizationId", "==", o.id).where("status", "==", "active").count().get();
      counts[o.id] = r.data().count;
    }));
  }
  const rows = orgs
    .map((o) => normalizeOrganizationRow(o.id, o.data, customers[o.id], o.data.type ? counts[o.id] ?? 0 : 0))
    .filter((r) => includeArchived || r.status !== "archived");
  return rows;
}
