import { NextResponse } from "next/server";
import { requireAccountAdmin } from "@/lib/firebaseAdmin";
import { getOrganizationAppSubscriptions, getAppAssignmentsForOrgApp } from "@/lib/appAccess";
import { APPS } from "@/lib/appCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lists every Bizzux app with this organization's subscription status and
// how many members are currently assigned to it — the "Organization > Apps"
// screen. Global Admin / Admin only, same gate as /api/team.
export async function GET(req) {
  try {
    const acct = await requireAccountAdmin(req);
    const subscriptions = await getOrganizationAppSubscriptions(acct.accountId);
    const subscriptionByAppId = new Map(subscriptions.map((s) => [s.appId, s]));

    const apps = await Promise.all(
      APPS.map(async (a) => {
        const sub = subscriptionByAppId.get(a.id);
        const assignments = await getAppAssignmentsForOrgApp(acct.accountId, a.id);
        const assignedCount = assignments.filter((x) => x.status === "ACTIVE").length;
        return {
          appId: a.id,
          name: a.name,
          status: sub?.status || "INACTIVE",
          subscriptionType: sub?.subscriptionType || null,
          assignedCount,
        };
      })
    );

    return NextResponse.json({ apps });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
