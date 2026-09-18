import { NextResponse } from "next/server";
import { requireAccountAdmin, adminDb } from "@/lib/firebaseAdmin";
import { addGroupMember, removeGroupMember, getGroupMemberIds } from "@/lib/organizationGroups";
import { upsertAppAssignment } from "@/lib/appAccess";
import { APP_IDS } from "@/lib/appCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every org member (owner + team roster), with name/email — the same
// shape /api/organization/apps/[appId] builds for its own "Manage Users"
// panel, reused here to list a group's current members and who else could
// be added.
async function getOrgMembers(accountId) {
  const [ownerSnap, teamSnap] = await Promise.all([
    adminDb().doc("customers/" + accountId).get(),
    adminDb().collection("customers/" + accountId + "/team").get(),
  ]);
  const owner = ownerSnap.exists ? ownerSnap.data() : {};
  const members = [{ uid: accountId, name: owner.fullName || owner.email || "Owner", email: owner.email || "" }];
  teamSnap.docs.forEach((d) => {
    const t = d.data();
    if (!t.uid) return;
    members.push({ uid: t.uid, name: [t.firstName, t.lastName].filter(Boolean).join(" ") || t.email, email: t.email || "" });
  });
  return members;
}

export async function GET(req, { params }) {
  try {
    const acct = await requireAccountAdmin(req);
    const [orgMembers, memberIds] = await Promise.all([
      getOrgMembers(acct.accountId),
      getGroupMemberIds(params.id),
    ]);
    const memberIdSet = new Set(memberIds);
    const members = orgMembers.filter((m) => memberIdSet.has(m.uid));
    const availableToAdd = orgMembers.filter((m) => !memberIdSet.has(m.uid));
    return NextResponse.json({ members, availableToAdd });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req, { params }) {
  try {
    const acct = await requireAccountAdmin(req);
    const body = await req.json();
    const groupId = params.id;

    if (body.action === "addMember") {
      const userId = String(body.userId || "");
      if (!userId) throw { status: 400, message: "userId is required" };
      await addGroupMember(acct.accountId, groupId, userId);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "removeMember") {
      const userId = String(body.userId || "");
      if (!userId) throw { status: 400, message: "userId is required" };
      await removeGroupMember(groupId, userId);
      return NextResponse.json({ ok: true });
    }

    // One-time bulk grant: gives every CURRENT member of this group the
    // selected apps (re-validated against the org's active subscriptions).
    // Not a live binding — someone added to the group later doesn't
    // retroactively get this; re-run it if that's what's wanted. See
    // lib/organizationGroups.js's file comment for why.
    if (body.action === "grantApps") {
      const apps = Array.isArray(body.apps) ? body.apps : [];
      const memberIds = await getGroupMemberIds(groupId);
      if (memberIds.length === 0) throw { status: 400, message: "This group has no members yet" };

      const subsSnap = await adminDb()
        .collection("organizationAppSubscriptions")
        .where("organizationId", "==", acct.accountId)
        .where("status", "==", "ACTIVE")
        .get();
      const subscribedAppIds = new Set(subsSnap.docs.map((d) => d.data().appId));

      const validApps = apps.filter((a) => APP_IDS.includes(a.appId) && subscribedAppIds.has(a.appId));
      await Promise.all(
        memberIds.flatMap((userId) =>
          validApps.map((a) =>
            upsertAppAssignment({
              organizationId: acct.accountId, userId, appId: a.appId,
              role: a.admin ? "ADMIN" : "MEMBER", status: "ACTIVE",
            })
          )
        )
      );
      return NextResponse.json({ ok: true, memberCount: memberIds.length, appCount: validApps.length });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
