// PURE analysis for the Bizzux login ID dry run: which existing usernames can simply gain "@bizzux", and which need a decision first.
// No I/O. Input rows are { id, uid, org } from usernames/ and attUsernames/ (ids are the stored usernames); the report never changes anything.
import { LOGIN_ID_RE, toLoginId } from "./loginId.js";

export function analyzeLoginIds({ portal = [], attendance = [], authUids = null } = {}) {
  const inPortal = new Map(portal.map((r) => [r.id, r]));
  const inAtt = new Map(attendance.map((r) => [r.id, r]));
  const bothStores = [...inPortal.keys()].filter((id) => inAtt.has(id)).sort();
  const invalid = [...new Set([...inPortal.keys(), ...inAtt.keys()])].filter((id) => !LOGIN_ID_RE.test(id)).sort();
  const sharedUid = {}; // one uid behind two different names (two logins for one person, or a data fault)
  for (const r of [...portal, ...attendance]) if (r.uid) (sharedUid[r.uid] ||= new Set()).add(r.id);
  const uidWithManyNames = Object.entries(sharedUid).filter(([, v]) => v.size > 1).map(([uid, v]) => ({ uid, names: [...v].sort() }));
  const orphans = authUids ? [...portal, ...attendance].filter((r) => r.uid && !authUids.has(r.uid)).map((r) => r.id).sort() : null; // login with no Firebase user
  const blocked = new Set([...bothStores, ...invalid]);
  const ready = [...new Set([...inPortal.keys(), ...inAtt.keys()])].filter((id) => !blocked.has(id)).sort();
  return {
    totals: { portalUsernames: portal.length, attendanceUsernames: attendance.length, distinctNames: new Set([...inPortal.keys(), ...inAtt.keys()]).size },
    readyToGainLoginId: ready.length, // keep their stored username; the Bizzux ID is just id + "@bizzux", no data change
    sampleReady: ready.slice(0, 5).map((id) => toLoginId(id)),
    needDecision: {
      bothStores, // the same name exists in the portal AND the Attendance store: two people or one person with two logins
      invalidFormat: invalid, // would not be accepted as a Bizzux ID
      uidWithManyNames,
      ...(orphans ? { noFirebaseUser: orphans } : {}),
    },
    safeToProceed: !bothStores.length && !invalid.length && !(orphans && orphans.length),
  };
}
