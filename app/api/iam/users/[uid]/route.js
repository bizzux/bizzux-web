import { NextResponse } from "next/server";
import { requireOrgManager } from "@/lib/firebaseAdmin";
import { getUserDetails } from "@/lib/iam/userAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/iam/users/{uid}[?organizationId=] -> the details drawer for one member of the caller's company (404 for anyone else).
export async function GET(req, { params }) {
  try {
    const c = await requireOrgManager(req);
    const org = new URL(req.url).searchParams.get("organizationId") || "";
    return NextResponse.json(await getUserDetails({ actor: c, organizationId: org, uid: String(params.uid || "") }));
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
