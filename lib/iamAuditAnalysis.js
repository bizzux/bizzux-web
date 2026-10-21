// Pure analysis for the IAM consistency audit (scripts/iam-audit.mjs). No I/O, no Firestore: give it the scanned rows, get findings back.
// Findings never merge or change anything; they only describe. Inputs are plain arrays of small objects (secrets are never loaded).
// customers:[{id,status,multiOrg}] memberships:[{uid,accountId,profile,status,multiOrg}] orgMemberships:[{id,organizationId,userId,role,status,profile}]
// assignments:[{id,organizationId,userId,appId,role,status}] subs:[{organizationId,appId,status}] usernames:[{name,uid,organizationId,disabled}]
// attUsernames:[{name,uid,accountId,status}] team:[{org,id,uid,profile,status}] employees:[{org,id,userId,loginUsername,status,organizationId,hasLoginEmail}]
// authUsers:[{uid,email,providers:[...],disabled}]

const lower = (s) => String(s || "").trim().toLowerCase();

// Same mapping as lib/organizationMembership.js roleFromProfile (kept in step by test/iamAuditAnalysis.test.mjs).
export function roleFromProfile(profile, isOwner) {
  if (isOwner) return "OWNER";
  if (profile === "Global Admin" || profile === "Admin") return "ADMIN";
  if (profile === "Viewer/Auditor") return "VIEWER";
  return "MEMBER";
}
const isActive = (s) => ["active", "ACTIVE"].includes(s);
const uidKind = (u) => (String(u).startsWith("att_") ? "att_username" : String(u).length === 28 ? "firebase_uid" : "other_id");

export function analyze(d) {
  const out = [];
  const add = (code, org, user, detail) => out.push({ code, org: org || "", user: user || "", detail: detail || "" });
  const customers = new Map(d.customers.map((c) => [c.id, c]));
  const omById = new Map(d.orgMemberships.map((m) => [m.organizationId + "_" + m.userId, m]));
  const authByUid = new Map((d.authUsers || []).map((u) => [u.uid, u]));
  const asgKey = (o, u, a) => `${o}_${u}_${a}`;
  const asgByKey = new Map(d.assignments.map((a) => [asgKey(a.organizationId, a.userId, a.appId), a]));
  const subByKey = new Map(d.subs.map((s) => [s.organizationId + "_" + s.appId, s]));

  // 1. Duplicate identities
  const byEmail = new Map();
  for (const u of d.authUsers || []) { const e = lower(u.email); if (e) { if (!byEmail.has(e)) byEmail.set(e, []); byEmail.get(e).push(u.uid); } }
  for (const [e, uids] of byEmail) if (uids.length > 1) add("DUP_EMAIL", "", uids[0], `${uids.length} auth users share one email`);
  const attNames = new Map(d.attUsernames.map((u) => [u.name, u]));
  for (const u of d.usernames) {
    const a = attNames.get(u.name);
    if (a) add("DUP_USERNAME_CROSS_STORE", u.organizationId, u.uid, "same username in portal and Attendance stores" + (a.uid === u.uid ? " (same uid)" : " (different uids)"));
  }
  const portalByUid = new Map(d.usernames.map((u) => [u.uid, u]));
  for (const a of d.attUsernames) if (portalByUid.has(a.uid) && !attNames.has(portalByUid.get(a.uid).name)) add("UID_IN_BOTH_USERNAME_STORES", a.accountId, a.uid, "one uid has a portal and an Attendance username");
  for (const u of d.authUsers || []) {
    const hasAny = d.memberships.some((m) => m.uid === u.uid) || customers.has(u.uid) || d.orgMemberships.some((m) => m.userId === u.uid) || d.employees.some((e) => e.userId === u.uid);
    if (!hasAny && !u.disabled) add("ORPHAN_AUTH_USER", "", u.uid, `auth user with no company, membership or employee; providers=${(u.providers || []).join("+") || "none"}`);
  }

  // 2. Missing organization memberships
  for (const c of d.customers) if (!omById.has(c.id + "_" + c.id) && c.status !== "closed") add("OWNER_NO_ORG_MEMBERSHIP", c.id, c.id, `owner has no organizationMemberships record; company status=${c.status || "none"}`);
  for (const m of d.memberships) if (!omById.has(m.accountId + "_" + m.uid)) add("MEMBERSHIP_NO_ORG_MEMBERSHIP", m.accountId, m.uid, `legacy memberships/{uid} has no organizationMemberships record; status=${m.status || "none"}; company ${customers.has(m.accountId) ? "exists" : "MISSING"}`);
  for (const t of d.team) if (t.uid && !omById.has(t.org + "_" + t.uid)) add("TEAM_NO_ORG_MEMBERSHIP", t.org, t.uid, "team member has no organizationMemberships record");
  const legacyKeys = new Set([...d.memberships.map((m) => m.accountId + "_" + m.uid), ...d.team.filter((t) => t.uid).map((t) => t.org + "_" + t.uid), ...d.customers.map((c) => c.id + "_" + c.id)]);
  for (const m of d.orgMemberships) {
    if (!customers.has(m.organizationId)) add("ORG_MEMBERSHIP_UNKNOWN_ORG", m.organizationId, m.userId, `organizationMemberships points at a company that does not exist; selfOrg=${m.organizationId === m.userId}; role=${m.role}; status=${m.status}`);
    if (!legacyKeys.has(m.organizationId + "_" + m.userId)) add("ORG_MEMBERSHIP_NO_LEGACY", m.organizationId, m.userId, `canonical record without a legacy counterpart; role=${m.role}; status=${m.status}; source=${m.userId === m.organizationId ? "owner" : "member"}`);
  }

  // 3. Orphaned Attendance profiles
  const attNamesByName = attNames;
  for (const e of d.employees) {
    if (e.organizationId && e.organizationId !== e.org) add("EMPLOYEE_ORG_MISMATCH", e.org, e.userId, "attEmployees.organizationId differs from its company");
    if (e.userId) {
      if (d.authUsers && !authByUid.has(e.userId)) add("EMPLOYEE_USER_NOT_IN_AUTH", e.org, e.userId, `attEmployees.userId has no Firebase user; idKind=${uidKind(e.userId)}; hasUsername=${!!e.loginUsername}; status=${e.status}`);
      if (!omById.has(e.org + "_" + e.userId) && !d.memberships.some((m) => m.uid === e.userId && m.accountId === e.org) && e.userId !== e.org) add("EMPLOYEE_USER_NOT_MEMBER", e.org, e.userId, "employee's login is not a member of the company");
      if (!asgByKey.has(asgKey(e.org, e.userId, "bizzux-attendance")) && e.userId !== e.org && e.status !== "inactive") add("EMPLOYEE_NO_ATTENDANCE_ASSIGNMENT", e.org, e.userId, `employee has a login but no Attendance app assignment; idKind=${uidKind(e.userId)}; status=${e.status}`);
    }
    if (e.loginUsername && !attNamesByName.has(e.loginUsername)) add("EMPLOYEE_USERNAME_MISSING", e.org, e.userId, "loginUsername has no attUsernames record");
  }
  const empUids = new Set(d.employees.map((e) => e.userId).filter(Boolean));
  for (const a of d.attUsernames) if (!empUids.has(a.uid) && a.status !== "disabled") add("ATT_USERNAME_NO_EMPLOYEE", a.accountId, a.uid, "Attendance username without an employee profile");

  // 4. Conflicting roles
  const owners = new Map();
  for (const m of d.orgMemberships) if (m.role === "OWNER") { if (!owners.has(m.organizationId)) owners.set(m.organizationId, []); owners.get(m.organizationId).push(m.userId); }
  for (const [org, us] of owners) if (us.length > 1) add("MULTIPLE_OWNERS", org, us[0], `${us.length} OWNER memberships`);
  for (const m of d.orgMemberships) if (m.userId === m.organizationId && m.role !== "OWNER") add("OWNER_ROLE_CONFLICT", m.organizationId, m.userId, `company owner stored as ${m.role}`);
  const legacyProfile = new Map();
  for (const t of d.team) if (t.uid && t.profile) legacyProfile.set(t.org + "_" + t.uid, t.profile);
  for (const m of d.memberships) if (m.profile) { const k = m.accountId + "_" + m.uid; const tp = legacyProfile.get(k); if (tp && tp !== m.profile) add("PROFILE_CONFLICT_TEAM_VS_MEMBERSHIP", m.accountId, m.uid, `team=${tp} memberships=${m.profile}`); legacyProfile.set(k, m.profile); }
  for (const m of d.orgMemberships) {
    const lp = legacyProfile.get(m.organizationId + "_" + m.userId);
    if (lp && m.userId !== m.organizationId && roleFromProfile(lp, false) !== m.role) add("ROLE_CONFLICT_LEGACY_VS_CANONICAL", m.organizationId, m.userId, `legacy profile ${lp} implies ${roleFromProfile(lp, false)}, canonical role ${m.role}`);
    if (lp && m.profile && lp !== m.profile) add("PROFILE_CONFLICT_LEGACY_VS_CANONICAL", m.organizationId, m.userId, `legacy=${lp} canonical=${m.profile}`);
  }

  // 5. App assignments
  for (const a of d.assignments) {
    const sub = subByKey.get(a.organizationId + "_" + a.appId);
    if (isActive(a.status) && a.status === "ACTIVE" && (!sub || sub.status !== "ACTIVE")) add("ASSIGNMENT_NO_ACTIVE_SUBSCRIPTION", a.organizationId, a.userId, `${a.appId}: assignment active, subscription ${sub ? sub.status : "missing"}`);
    if (a.userId !== a.organizationId && !omById.has(a.organizationId + "_" + a.userId) && !d.memberships.some((m) => m.uid === a.userId && m.accountId === a.organizationId)) add("ASSIGNMENT_NON_MEMBER", a.organizationId, a.userId, `${a.appId}: assigned user is not a member`);
    if (!["ACTIVE", "INACTIVE"].includes(a.status)) add("STATUS_VOCAB_ASSIGNMENT", a.organizationId, a.userId, `assignment status "${a.status}"`);
  }
  for (const m of d.orgMemberships) if (!["active", "suspended", "removed", "invited"].includes(m.status)) add("STATUS_VOCAB_MEMBERSHIP", m.organizationId, m.userId, `membership status "${m.status}"`);

  // 6. Multi-org
  const orgsByUid = new Map();
  for (const m of d.orgMemberships) if (isActive(m.status)) { if (!orgsByUid.has(m.userId)) orgsByUid.set(m.userId, new Set()); orgsByUid.get(m.userId).add(m.organizationId); }
  const flagged = new Set([...d.memberships.filter((m) => m.multiOrg).map((m) => m.uid), ...d.customers.filter((c) => c.multiOrg).map((c) => c.id)]);
  for (const [uid, orgs] of orgsByUid) if (orgs.size > 1 && !flagged.has(uid)) add("MULTI_ORG_WITHOUT_FLAG", "", uid, `${orgs.size} active organizations but multiOrg is not set; ownsOwnCompany=${customers.has(uid)}`);
  return out;
}

export function summarize(findings) {
  const counts = {};
  for (const f of findings) counts[f.code] = (counts[f.code] || 0) + 1;
  return counts;
}
