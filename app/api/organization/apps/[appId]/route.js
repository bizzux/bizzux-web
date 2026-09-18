import { NextResponse } from "next/server";
import { requireAccountAdmin, adminDb } from "@/lib/firebaseAdmin";
import { DEFAULT_PROFILE } from "@/lib/roles";
import { upsertAppAssignment, getAppAssignmentsForOrgApp } from "@/lib/appAccess";
import { APP_IDS, appName } from "@/lib/appCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The "Manage Users" panel for one app: every organization member plus
// whether they're currently assigned to this specific app. Reuses the same
// member list /api/team builds (owner + customers/{accountId}/team) so
// this never drifts from who's actually on the team.
export async function GET(req, { params }) {
  try {
    const acct = await requireAccountAdmin(req);
    const appId = params.appId;
    if (!APP_IDS.includes(appId)) throw { status: 404, message: "Unknown app" };

    const ownerSnap = await adminDb().doc("customers/" + acct.accountId).get();
    const owner = ownerSnap.exists ? ownerSnap.data() : {};
    const teamSnap = await adminDb().collection("customers/" + acct.accountId + "/team").get();
    const assignments = await getAppAssignmentsForOrgApp(acct.accountId, appId);
    const assignedByUid = new Map(assignments.map((a) => [a.userId, a.status === "ACTIVE"]));

    const members = [
      {
        id: acct.accountId,
        uid: acct.accountId,
        name: owner.fullName || owner.email || "Owner",
        email: owner.email || "",
        isOwner: true,
        assigned: assignedByUid.get(acct.accountId) ?? true, // owners default to assigned even before the record exists
      },
      ...teamSnap.docs
        .filter((d) => d.data().uid) // only members who've actually joined have a uid to assign
        .map((d) => {
          const t = d.data();
          return {
            id: d.id,
            uid: t.uid,
            name: [t.firstName, t.lastName].filter(Boolean).join(" ") || t.email,
            email: t.email || "",
            isOwner: false,
            assigned: assignedByUid.get(t.uid) ?? false,
          };
        }),
    ];

    return NextResponse.json({ appId, appName: appName(appId), members });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req, { params }) {
  try {
    const acct = await requireAccountAdmin(req);
    const appId = params.appId;
    if (!APP_IDS.includes(appId)) throw { status: 404, message: "Unknown app" };

    const body = await req.json();
    const uid = String(body.uid || "");
    const assigned = !!body.assigned;
    if (!uid) throw { status: 400, message: "uid is required" };

    // Look up their current org role/profile just to stamp a sensible
    // default onto the assignment record — not itself a permission check.
    let role = "MEMBER";
    if (uid === acct.accountId) {
      role = "OWNER";
    } else {
      const teamSnap = await adminDb()
        .collection("customers/" + acct.accountId + "/team")
        .where("uid", "==", uid)
        .limit(1)
        .get();
      role = teamSnap.empty ? DEFAULT_PROFILE : teamSnap.docs[0].data().profile || DEFAULT_PROFILE;
    }

    await upsertAppAssignment({
      organizationId: acct.accountId, userId: uid, appId, role,
      status: assigned ? "ACTIVE" : "INACTIVE",
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
