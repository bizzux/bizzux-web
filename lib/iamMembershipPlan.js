// Pure planner for the canonical-membership backfill (scripts/iam-backfill-memberships.mjs). No I/O.
// Goal: every legacy owner/member has an organizationMemberships/{org}_{uid} record in schema v2, WITHOUT changing anyone's access:
//   - only creates missing records and fills fields that are absent; never overwrites role, status or profile that already has a value;
//   - never touches a record whose role is OWNER or whose status is suspended/removed beyond filling absent bookkeeping fields;
//   - links nothing by email; identity is always the Firebase uid already stored in the legacy record.
// Inputs: customers:[{id,status}] memberships:[{uid,accountId,profile,status}] team:[{org,uid,profile,disabled,status}]
//         orgMemberships:[{id,organizationId,userId,role,status,profile,schemaVersion,source}]
export const SCHEMA_VERSION = 2;

export function roleFromProfile(profile, isOwner) {
  if (isOwner) return "OWNER";
  if (profile === "Global Admin" || profile === "Admin") return "ADMIN";
  if (profile === "Viewer/Auditor") return "VIEWER";
  return "MEMBER";
}

export function planBackfill({ customers, memberships, team, orgMemberships }) {
  const ops = [], skipped = [];
  const companies = new Map(customers.map((c) => [c.id, c]));
  const have = new Map(orgMemberships.map((m) => [m.id || m.organizationId + "_" + m.userId, m]));
  const teamByKey = new Map(team.filter((t) => t.uid).map((t) => [t.org + "_" + t.uid, t]));
  const legacyProfile = new Map();
  for (const t of team) if (t.uid && t.profile) legacyProfile.set(t.org + "_" + t.uid, t.profile);
  for (const m of memberships) if (m.profile) legacyProfile.set(m.accountId + "_" + m.uid, m.profile);

  const want = new Map(); // id -> intended canonical fields
  for (const c of customers) {
    if (c.status === "closed") { skipped.push({ id: c.id + "_" + c.id, why: "company closed" }); continue; }
    want.set(c.id + "_" + c.id, { organizationId: c.id, userId: c.id, role: "OWNER", profile: "Admin", status: "active", source: "owner" });
  }
  for (const m of memberships) {
    const id = m.accountId + "_" + m.uid;
    if (!companies.has(m.accountId)) { skipped.push({ id, why: "legacy membership points at a missing company" }); continue; }
    if (m.uid === m.accountId) continue; // owner handled above
    const t = teamByKey.get(id);
    const profile = m.profile || t?.profile || "Staff/Shopkeeper";
    const status = t?.disabled ? "suspended" : "active";
    want.set(id, { organizationId: m.accountId, userId: m.uid, role: roleFromProfile(profile, false), profile, status, source: "backfill" });
  }

  for (const [id, w] of want) {
    const cur = have.get(id);
    if (!cur) { ops.push({ type: "create", id, data: { ...w, schemaVersion: SCHEMA_VERSION } }); continue; }
    const fill = {};
    if (!cur.profile) fill.profile = legacyProfile.get(id) || w.profile;
    if (!cur.schemaVersion) fill.schemaVersion = SCHEMA_VERSION;
    if (!cur.source) fill.source = w.source;
    if (Object.keys(fill).length) ops.push({ type: "fill", id, fields: fill });
  }
  // Canonical records with no legacy counterpart are reported, never changed here.
  for (const [id, cur] of have) if (!want.has(id) && !cur.schemaVersion) ops.push({ type: "fill", id, fields: { schemaVersion: SCHEMA_VERSION } });
  return { ops, skipped };
}

// Undo plan for a journal produced by the runner: delete what was created (if still unchanged), remove only the fields that were filled.
export function planRollback(journal, currentById) {
  const undo = [];
  for (const j of journal) {
    const cur = currentById.get(j.id);
    if (j.type === "create") { if (cur && cur.source === j.data.source && cur.role === j.data.role && cur.status === j.data.status) undo.push({ type: "delete", id: j.id }); else if (cur) undo.push({ type: "skip", id: j.id, why: "changed since backfill" }); }
    else if (j.type === "fill") {
      const remove = Object.keys(j.fields).filter((k) => cur && cur[k] === j.fields[k]);
      if (remove.length) undo.push({ type: "unfill", id: j.id, fields: remove });
    }
  }
  return undo;
}
