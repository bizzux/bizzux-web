// Server side of organization authorization: loads the caller's standing in their ACTIVE company and turns it into the pure policy's subject.
// Reads live on every call (the admin routes are low volume), so a demotion or suspension takes effect on the very next request: no cache here.
import { effectiveOrgRole } from "./policy.js";

export async function loadOrgSubject(db, acct, uid) {
  let canonical = null;
  if (!acct.isOwner) {
    const s = await db.doc(`organizationMemberships/${acct.accountId}_${uid}`).get();
    canonical = s.exists ? s.data() : null;
  }
  const eff = effectiveOrgRole({ isOwner: !!acct.isOwner, canonical, profile: acct.profile });
  return { ...eff, permissions: Array.isArray(canonical?.permissions) ? canonical.permissions : [], uid, accountId: acct.accountId };
}
