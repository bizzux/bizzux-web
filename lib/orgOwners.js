// SERVER ONLY. Finds who actually owns / administers an organization from the
// real relationships, never from guessed or invented records:
//   - organizationMemberships/{org}_{user}  role OWNER (or ADMIN), status active
//   - the sign-in account (Firebase Auth) for display name and email
//   - the org/customer record only as a last-resort label when a membership
//     exists but the account has no name of its own
// Returns null owner when no active OWNER membership exists (shown as
// "No owner on record", not fabricated).
import { adminAuth, adminDb } from "./firebaseAdmin";

async function authInfo(uids) {
  const out = {};
  for (let i = 0; i < uids.length; i += 100) {
    try {
      const r = await adminAuth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
      r.users.forEach((u) => { out[u.uid] = { name: u.displayName || "", email: u.email || "", lastSignInAt: u.metadata?.lastSignInTime || null }; });
    } catch { /* best-effort: missing identities just have no name */ }
  }
  return out;
}

// Resolves owners/admins for many organizations. Costs one membership query
// per organization (aggregate-free, equality filters only) plus Auth lookups,
// which are not Firestore reads.
export async function resolveOrgOwners(orgIds, { includeAdmins = false } = {}) {
  const db = adminDb();
  const result = {};
  const memberLists = await Promise.all(orgIds.map(async (id) => {
    const snap = await db.collection("organizationMemberships").where("organizationId", "==", id).where("status", "==", "active").get();
    const docs = snap.docs.map((d) => d.data());
    return [id, docs.filter((m) => m.role === "OWNER" || (includeAdmins && m.role === "ADMIN"))];
  }));
  const uids = [...new Set(memberLists.flatMap(([, ms]) => ms.map((m) => m.userId)))];
  const info = await authInfo(uids);
  for (const [id, owners] of memberLists) {
    const list = owners.map((m) => ({ uid: m.userId, role: m.role, ...(info[m.userId] || { name: "", email: "" }) }));
    const owner = list.find((o) => o.role === "OWNER") || null;
    result[id] = { owner, admins: list.filter((o) => o.role === "ADMIN") };
  }
  return result;
}
