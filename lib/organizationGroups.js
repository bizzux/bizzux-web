// Organization Groups: a named set of existing team members, used purely
// to grant app access to several people at once (see "grantApps" in
// app/api/organization/groups/[id]/route.js) — a one-time bulk action, not
// a live permission-inheritance system. Adding someone to a group later
// does NOT retroactively grant them whatever the group was once given;
// re-run "Grant apps" after changing membership if that's what you want.
// Kept deliberately this simple rather than building live inheritance,
// which would need to recompute every member's AppAssignment on every
// membership change.
import { adminDb } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

function groupsCollection(organizationId) {
  return adminDb().collection("organizations").doc(organizationId).collection("groups");
}
// Top-level, not nested under the group doc, so a member can be looked up
// or removed without needing the group's full path memorized elsewhere —
// mirrors organizationMemberships' own top-level-with-deterministic-id shape.
function memberDocId(groupId, userId) {
  return groupId + "_" + userId;
}
function membersCollection() {
  return adminDb().collection("organizationGroupMembers");
}

export async function createGroup(organizationId, name) {
  const ref = await groupsCollection(organizationId).add({
    organizationId, name,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function getGroups(organizationId) {
  const [groupsSnap, membersSnap] = await Promise.all([
    groupsCollection(organizationId).orderBy("createdAt", "desc").get(),
    membersCollection().where("organizationId", "==", organizationId).get(),
  ]);
  const countByGroupId = new Map();
  membersSnap.docs.forEach((d) => {
    const gid = d.data().groupId;
    countByGroupId.set(gid, (countByGroupId.get(gid) || 0) + 1);
  });
  return groupsSnap.docs.map((d) => ({ id: d.id, name: d.data().name, memberCount: countByGroupId.get(d.id) || 0 }));
}

export async function deleteGroup(organizationId, groupId) {
  const membersSnap = await membersCollection().where("groupId", "==", groupId).get();
  const batch = adminDb().batch();
  membersSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(groupsCollection(organizationId).doc(groupId));
  await batch.commit();
}

export async function addGroupMember(organizationId, groupId, userId) {
  await membersCollection().doc(memberDocId(groupId, userId)).set({
    groupId, organizationId, userId, createdAt: FieldValue.serverTimestamp(),
  });
}

export async function removeGroupMember(groupId, userId) {
  await membersCollection().doc(memberDocId(groupId, userId)).delete();
}

export async function getGroupMemberIds(groupId) {
  const snap = await membersCollection().where("groupId", "==", groupId).get();
  return snap.docs.map((d) => d.data().userId);
}
