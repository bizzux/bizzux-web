import { NextResponse } from "next/server";
import { requireOrgManager } from "@/lib/firebaseAdmin";
import { createUsernameIdentity, requestLinkToOrganization, setUserApps, usernameAvailability, bindExistingMemberToEmployee, setOrganizationRole, reissueTemporaryPassword, resolveOrganizationId, validateNewUsernameIdentity }
 from "@/lib/iam/identityService";
import { restoreMember, removeMember } from "@/lib/iam/membershipLifecycle";
import { resetUsernamePassword } from "@/lib/iam/userAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?checkUsername=name -> { ok, problem }: is this Bizzux username valid and free in the ONE platform-wide namespace? Admins only.
export async function GET(req) {
  try {
    const c = await requireOrgManager(req);
    const q = new URL(req.url).searchParams;
    return NextResponse.json(await usernameAvailability(q.get("checkUsername"), { organizationId: c.accountId, idempotencyKey: q.get("idempotencyKey") || "" }));
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

// The shared IAM entry point used by the Admin Center AND by other apps (Attendance Add Person) with the caller's Bearer token.
//   POST { kind: "username", fullName, username, password?, profile?, apps?, ... }  -> new username login (temporary password returned ONCE)
//   POST { kind: "link", username, profile?, apps? }                                -> ask an existing login to join; the person accepts
//   POST { kind: "apps", uid, apps }                                                 -> replace the person's application access
// The caller identity always comes from the verified token, never from the body; a company admin can only act on their own company.
export async function POST(req) {
  try {
    const c = await requireOrgManager(req);
    const b = await req.json();
    const organizationId = b.organizationId;
    if (b.kind === "username") return NextResponse.json({ ok: true, ...(await createUsernameIdentity({ ...b, organizationId, actor: c })) });
    if (b.kind === "link") return NextResponse.json(await requestLinkToOrganization({ actor: c, organizationId, username: b.username, profile: b.profile, apps: b.apps, bindEmployeeId: b.bindEmployeeId }));
    if (b.kind === "apps") return NextResponse.json(await setUserApps({ actor: c, organizationId, uid: String(b.uid || ""), apps: b.apps }));
    if (b.kind === "orgRole") return NextResponse.json(await setOrganizationRole({ actor: c, organizationId, uid: String(b.uid || ""), role: b.role }));
    if (b.kind === "reissue") return NextResponse.json(await reissueTemporaryPassword({ actor: c, organizationId, uid: String(b.uid || "") }));
    if (b.kind === "resetPassword") return NextResponse.json(await resetUsernamePassword({ actor: c, organizationId, uid: String(b.uid || ""), password: b.password, mustChange: b.mustChange }));
    if (b.kind === "validate") return NextResponse.json(await validateNewUsernameIdentity({ ...b, organizationId, actor: c }));
    if (b.kind === "restore") return NextResponse.json(await restoreMember({ actor: c, organizationId: resolveOrganizationId(c, organizationId), id: String(b.id || "") }));
    if (b.kind === "remove") return NextResponse.json(await removeMember({ actor: c, organizationId: resolveOrganizationId(c, organizationId), teamDocId: String(b.id || "") }));
    if (b.kind === "bindEmployee") return NextResponse.json(await bindExistingMemberToEmployee({ actor: c, organizationId, who: b.who, employeeId: b.employeeId }));
    throw { status: 400, message: "Unknown kind" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
