// Pure (no Firebase, safe for client and server): the organization CONTACT and
// ADMINISTRATION model.
//
// Four separate ideas that used to be one "owner / administrator" field:
//   requester       who asked Bizzux for the organization (a contact, not a login)
//   businessOwner   the business-ownership contact (a contact; may be unknown; may have no login)
//   primaryAdmin    the sign-in identity responsible for customer administration (an ACCESS role)
//   createdBy       the authenticated actor who really created the record (audit, immutable)
//
// Nothing here infers one from another. A manager who requests an account is
// not the owner; the first admin is not the owner; an unknown owner stays unknown.

export const REQUESTER_TYPES = ["owner", "manager", "employee_other"];
export const REQUESTER_LABEL = { owner: "Business Owner", manager: "Manager / Authorized Representative", employee_other: "Employee / Other Contact" };
export const OWNER_STATUS = ["not_provided", "declared", "verified"];
export const OWNER_STATUS_LABEL = { not_provided: "Not Provided", declared: "Declared (not verified)", verified: "Verified" };
export const AUTH_STATUS = ["not_required", "pending", "verified", "rejected"];
export const AUTH_STATUS_LABEL = { not_required: "Not Required for Current Stage", pending: "Pending Verification", verified: "Verified", rejected: "Rejected" };
export const ADMIN_STATUS = ["pending_activation", "active", "suspended"];
export const ADMIN_STATUS_LABEL = { pending_activation: "Pending Activation", active: "Active", suspended: "Suspended", unmapped: "Needs review" };
export const ONBOARDING_METHOD_LABEL = { self_service: "Self-service sign-up", bizzux_managed: "Bizzux-managed", legacy: "Existing account (before this record existed)" };
export const ONBOARDING_STATUS_LABEL = {
  draft: "Draft (no administrator yet)", pending_activation: "Awaiting activation", awaiting_first_login: "Awaiting first login", completed: "Completed",
};

// An employee / other contact never gets a full-authority organization on their
// say-so: trial only, small seat cap, verification pending until Bizzux confirms.
export const RESTRICTED_MAX_SEATS = 5;
export const ACTIVE_WINDOW_DAYS = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\-.\s0-9]{6,20}$/;
const s = (v, n) => String(v ?? "").trim().slice(0, n);
const fail = (message) => { throw { status: 400, message }; };

// One contact. `required` = name must be present. Returns null for an empty
// optional contact so nothing is invented.
export function parseContact(raw, label, { required = false } = {}) {
  const c = raw || {};
  const name = s(c.name ?? c.fullName, 80);
  const email = s(c.email, 200).toLowerCase();
  const phone = s(c.phone, 20);
  const jobTitle = s(c.jobTitle, 80);
  if (!name && !email && !phone && !jobTitle) {
    if (required) fail(label + ": full name is required");
    return null;
  }
  if (!name) fail(label + ": full name is required");
  if (email && !EMAIL_RE.test(email)) fail(label + ": enter a valid email address");
  if (phone && !PHONE_RE.test(phone)) fail(label + ": enter a valid phone number");
  return { name, email: email || null, phone: phone || null, jobTitle: jobTitle || null, userId: null };
}

// Validates the Contacts & Administration section of the create request.
//   body.requester            { name, email, phone, jobTitle, type }
//   body.requesterIsAdmin     boolean
//   body.ownerKnown           boolean; false/absent = Business Owner not provided
//   body.businessOwner        { name, email, phone, jobTitle }  (only when ownerKnown)
// `admin` is the already-parsed administrator person (or null for ORG_ONLY).
export function parseContacts(body, { hasAdmin }) {
  const reqIn = body.requester || {};
  const type = reqIn.type;
  if (!REQUESTER_TYPES.includes(type)) fail("Choose who requested this organization");
  const requester = parseContact(reqIn, "Requester", { required: true });
  if (!requester.email && !requester.phone) fail("Requester: provide an email address or a phone number");
  requester.type = type;

  const requesterIsAdmin = body.requesterIsAdmin === true;
  if (requesterIsAdmin && !hasAdmin) fail("Choose a setup that creates an administrator, or untick \"Requester is also the Primary Organization Admin\"");

  let businessOwner = null;
  if (body.ownerKnown === true) {
    const o = parseContact(body.businessOwner, "Business Owner", { required: true });
    // Declared, never verified at creation: only Bizzux verification sets "verified".
    businessOwner = { ...o, status: "declared" };
  }
  // The requester saying "I am the owner" prefills the owner contact but it
  // stays a self-declaration. It is never copied from the administrator.
  if (!businessOwner && type === "owner" && body.ownerKnown !== false) {
    businessOwner = { name: requester.name, email: requester.email, phone: requester.phone, jobTitle: requester.jobTitle, userId: null, status: "declared" };
  }
  return { requester, requesterIsAdmin, businessOwner };
}

// Default verification stage. Manager / employee requests, and any paid
// commitment, start as pending; an owner starting a trial needs nothing yet.
export function defaultAuthorizationStatus({ requesterType, planType }) {
  if (requesterType !== "owner") return "pending";
  if (planType === "PAID") return "pending";
  return "not_required";
}

// Policy for requests that must not get full authority yet.
export function checkRequesterPolicy({ requesterType, planType, seats }) {
  if (requesterType !== "employee_other") return { restricted: false };
  if (planType !== "TRIAL") fail("An employee / other contact can only start a Trial until their authority is verified");
  if (seats > RESTRICTED_MAX_SEATS) fail("Until verified, an organization requested by an employee / other contact is limited to " + RESTRICTED_MAX_SEATS + " seats");
  return { restricted: true };
}

export const maskPhone = (p) => (p ? String(p) : null);

// --- Read side -------------------------------------------------------------
const ms = (t) => (t?.toMillis ? t.toMillis() : t?.toDate ? t.toDate().getTime() : t ? new Date(t).getTime() : null);
const iso = (t) => { const v = ms(t); return v ? new Date(v).toISOString() : null; };

// Builds the Overview's ownership / administration view from the stored
// organization, falling back (read-only, never written) for legacy records.
//   members: [{ uid, name, email, username, role: "OWNER"|"ADMIN", status, lastLoginAt, mustChangePassword, disabled }]
export function buildOwnershipView({ org, customer, members = [] }) {
  const contactsV2 = org.contactsVersion === 2;
  const businessOwner = org.businessOwner
    ? { name: org.businessOwner.name, email: org.businessOwner.email || null, phone: org.businessOwner.phone || null, jobTitle: org.businessOwner.jobTitle || null, status: org.businessOwner.status || "declared" }
    : null;
  const requester = org.requester
    ? { name: org.requester.name, email: org.requester.email || null, phone: org.requester.phone || null, jobTitle: org.requester.jobTitle || null, type: org.requester.type }
    : null;

  // Primary admin: stored pointer first; otherwise the legacy adminUid, then a
  // single OWNER-role member. Anything else is "needs review" rather than a guess.
  const byUid = Object.fromEntries(members.map((m) => [m.uid, m]));
  const ptr = org.primaryAdmin || null;
  const legacyUid = org.adminUid || null;
  let primaryAdmin = null;
  const uid = ptr?.userId || legacyUid;
  const m = uid ? byUid[uid] : null;
  if (ptr || legacyUid) {
    primaryAdmin = {
      userId: uid || null,
      name: ptr?.displayName || org.adminName || m?.name || "",
      loginIdentifier: ptr?.loginIdentifier || org.adminUsername || org.adminContact || m?.username || m?.email || "",
      status: accountStatus(m, ptr?.status),
      lastLoginAt: m?.lastLoginAt || null,
      legacy: !ptr,
    };
  } else {
    const owners = members.filter((x) => x.role === "OWNER");
    if (owners.length === 1) {
      const o = owners[0];
      primaryAdmin = { userId: o.uid, name: o.name, loginIdentifier: o.username || o.email || "", status: accountStatus(o), lastLoginAt: o.lastLoginAt || null, legacy: true };
    }
  }
  const additionalAdmins = members
    .filter((x) => (x.role === "ADMIN" || x.role === "OWNER") && x.uid !== primaryAdmin?.userId)
    .map((x) => ({ userId: x.uid, name: x.name, loginIdentifier: x.username || x.email || "", role: x.role, status: accountStatus(x), lastLoginAt: x.lastLoginAt || null }));

  const createdBy = org.createdBy && typeof org.createdBy === "object"
    ? { actorUserId: org.createdBy.actorUserId || null, actorType: org.createdBy.actorType || null, actorEmail: org.createdBy.actorEmail || null }
    : org.provisionedBy
      ? { actorUserId: org.provisionedBy, actorType: "platform_admin", actorEmail: org.provisionedByEmail || null }
      : typeof org.createdBy === "string" && org.type && org.createdBy
        ? { actorUserId: org.createdBy, actorType: "customer", actorEmail: null }
        : null;

  const onboardingMethod = org.onboardingMethod
    || (org.provisionedVia === "platform-admin" || customer?.createdByAdmin ? "bizzux_managed" : org.type ? "self_service" : "legacy");

  return {
    contactsVersion: contactsV2 ? 2 : 1,
    businessOwner, businessOwnerStatus: businessOwner ? businessOwner.status : "not_provided",
    requester, primaryAdmin, additionalAdmins,
    requesterIsPrimaryAdmin: !!org.requesterIsPrimaryAdmin,
    authorizationStatus: org.authorizationStatus || "not_required",
    restrictedAccess: !!org.restrictedAccess,
    onboardingMethod, createdBy,
    // Legacy text from before the split, kept for reference only.
    legacyOwnerAdministrator: contactsV2 ? null : (org.adminName || customer?.owner?.name || null),
    needsAdminReview: !primaryAdmin || (primaryAdmin.legacy && !primaryAdmin.userId),
    updatedBy: org.updatedBy || null,
    updatedAt: iso(org.updatedAt),
    createdAt: iso(org.createdAt),
  };
}

function accountStatus(m, stored) {
  if (!m) return stored || "unmapped";
  if (m.disabled || m.status === "disabled" || m.status === "suspended") return "suspended";
  // Provisioned but never signed in = pending activation, never "active".
  if (!m.lastLoginAt) return "pending_activation";
  return "active";
}

// Seat and activity definitions, in one place so the UI and tests agree:
//  provisioned = people with a membership (any state)
//  accepted    = signed in at least once (not pending activation)
//  active      = signed in within ACTIVE_WINDOW_DAYS
// A provisioned-but-never-signed-in user is never counted active.
export function seatMetrics({ members = [], licensedSeats = null, now = Date.now() }) {
  const live = members.filter((m) => !(m.disabled || m.status === "disabled" || m.status === "suspended"));
  const accepted = live.filter((m) => !!m.lastLoginAt);
  const cutoff = now - ACTIVE_WINDOW_DAYS * 864e5;
  const active = accepted.filter((m) => new Date(m.lastLoginAt).getTime() >= cutoff);
  const last = accepted.map((m) => new Date(m.lastLoginAt).getTime()).filter(Boolean).sort((a, b) => b - a)[0] || null;
  return {
    provisionedSeats: members.length, licensedSeats,
    acceptedUsers: accepted.length, activeUsers: active.length, activeWindowDays: ACTIVE_WINDOW_DAYS,
    lastSuccessfulLogin: last ? new Date(last).toISOString() : null,
  };
}

// Onboarding status (stored value is only the starting point; completion is
// derived from real sign-in so no login path has to remember to update it).
export function deriveOnboardingStatus({ org, primaryAdmin }) {
  if (!primaryAdmin) return "draft";
  if (primaryAdmin.lastLoginAt) return "completed";
  if (primaryAdmin.status === "pending_activation" && org.adminLoginMethod === "EMAIL_INVITE") return "pending_activation";
  return "awaiting_first_login";
}
