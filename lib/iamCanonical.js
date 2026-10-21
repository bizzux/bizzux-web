// Canonical-membership fallback for account resolution. Identical copy in every Bizzux app (tests/phase0Wiring.test.mjs checks that).
// Today an account is found through customers/{uid} (owner) or the legacy memberships/{uid}. A person who has ONLY a canonical
// organizationMemberships record (for example admitted through a join request or created by a service that no longer writes the legacy record)
// used to get "No Bizzux account found". This finds their company from the canonical record instead, so the legacy records can be retired.
// It never overrides a legacy or owner result, never returns a suspended/removed membership, and never returns a company that is not active.
const ROLE_RANK = { OWNER: 0, ADMIN: 1, MEMBER: 2, VIEWER: 3 };
const PROFILE_FOR_ROLE = { ADMIN: "Admin", VIEWER: "Viewer/Auditor", MEMBER: "Staff/Shopkeeper" };

export function profileFromCanonical(m) {
  return m.profile || PROFILE_FOR_ROLE[m.role] || "Staff/Shopkeeper";
}

// rows: [{organizationId, role, profile, status}]; companyOk(orgId) -> boolean. Best usable membership, or null.
export function pickCanonical(uid, rows, companyOk) {
  return rows
    .filter((m) => m.organizationId && m.organizationId !== uid && m.status === "active" && m.role !== "OWNER" && companyOk(m.organizationId))
    .sort((a, b) => (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9) || a.organizationId.localeCompare(b.organizationId))[0] || null;
}

// db = firebase-admin Firestore. Returns null when there is nothing usable.
export async function canonicalOnlyAccount(db, uid) {
  const snap = await db.collection("organizationMemberships").where("userId", "==", uid).where("status", "==", "active").limit(10).get();
  const rows = snap.docs.map((d) => d.data());
  if (!rows.length) return null;
  const companies = new Map();
  await Promise.all([...new Set(rows.map((r) => r.organizationId))].filter(Boolean).map(async (id) => {
    const c = await db.doc("customers/" + id).get();
    companies.set(id, c.exists && !["suspended", "closed"].includes(c.data().status));
  }));
  const m = pickCanonical(uid, rows, (id) => companies.get(id) === true);
  if (!m) return null;
  const profile = profileFromCanonical(m);
  return { accountId: m.organizationId, profile, isOwner: false, membership: { accountId: m.organizationId, profile, role: "", via: "canonical" }, hasOwnAccount: false };
}
