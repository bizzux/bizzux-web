import { NextResponse } from "next/server";
import { requireOrgManager } from "@/lib/firebaseAdmin";
import { listDirectory } from "@/lib/iam/identityService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/iam/directory[?organizationId=]  -> the unified user list of ONE company (canonical memberships + logins + apps).
// Company admins are confined to their own company; a Platform Admin may pass organizationId.
export async function GET(req) {
  try {
    const c = await requireOrgManager(req);
    const org = new URL(req.url).searchParams.get("organizationId") || "";
    return NextResponse.json(await listDirectory({ actor: c, organizationId: org }));
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
