import { NextResponse } from "next/server";
import { requirePlatformPermission } from "@/lib/platformRoles";
import {
  requestSupportAccess, approveSupportAccess, denySupportAccess, revokeSupportAccess, listSupportAccess,
  SUPPORT_DURATIONS, SUPPORT_APPS,
} from "@/lib/supportAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Approved, scoped, time-limited support access (lib/supportAccess.js).
// Request: any role with support.access.request. Approve / deny: Platform
// Owner only. Every step is audited. Opening an app with a grant happens in
// the existing SSO routes (?asOrg=<org>&grant=<id>).

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const pending = url.searchParams.get("pending") === "1";
    const c = await requirePlatformPermission(req, pending ? "support.access.approve" : "support.access.request");
    const r = await listSupportAccess({ actor: c, organizationId: url.searchParams.get("org"), pending });
    return NextResponse.json({ ...r, durations: SUPPORT_DURATIONS, apps: SUPPORT_APPS, isOwner: c.platformRole === "OWNER", me: c.uid }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const perm = body.action === "approve" || body.action === "deny" ? "support.access.approve" : "support.access.request";
    const c = await requirePlatformPermission(req, perm);
    if (body.action === "request") {
      return NextResponse.json({ ok: true, grant: await requestSupportAccess({ actor: c, organizationId: body.organizationId, apps: body.apps, minutes: body.minutes, reason: body.reason }) });
    }
    if (body.action === "approve") return NextResponse.json(await approveSupportAccess({ actor: c, grantId: body.grantId, minutes: body.minutes }));
    if (body.action === "deny") return NextResponse.json(await denySupportAccess({ actor: c, grantId: body.grantId, reason: body.reason }));
    if (body.action === "revoke") return NextResponse.json(await revokeSupportAccess({ actor: c, grantId: body.grantId }));
    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
