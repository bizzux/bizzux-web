import { NextResponse } from "next/server";
import { requireOrgManager } from "@/lib/firebaseAdmin";
import { listRemoved } from "@/lib/iam/membershipLifecycle";
import { resolveOrganizationId } from "@/lib/iam/identityService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/iam/removed[?organizationId=] -> people removed from this company who can still be restored (60 days). Company admins: own company only.
export async function GET(req) {
  try {
    const c = await requireOrgManager(req);
    const organizationId = resolveOrganizationId(c, new URL(req.url).searchParams.get("organizationId") || "");
    return NextResponse.json({ organizationId, removed: await listRemoved({ actor: c, organizationId }) });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
