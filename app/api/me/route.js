import { NextResponse } from "next/server";
import { requireUser, resolveAccount, resolvePlatformRole } from "@/lib/firebaseAdmin";
import { ACCOUNT_ADMIN_PROFILES } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const c = await requireUser(req);
    let accountId = c.uid;
    let isAccountAdmin = true;
    let hasAccount = true;
    let profile = "Admin";
    let isOwner = true;
    let organizationId = null;
    let organizationRole = null;
    try {
      const acct = await resolveAccount(c.uid);
      accountId = acct.accountId;
      isAccountAdmin = ACCOUNT_ADMIN_PROFILES.includes(acct.profile);
      profile = acct.profile;
      isOwner = acct.isOwner;
      organizationId = acct.organizationId;
      organizationRole = acct.organizationRole;
    } catch {
      // /api/claim hasn't run yet for this sign-in (e.g. right after
      // Google sign-in, before the client calls it) — no account yet.
      hasAccount = false;
    }
    // Real platformAdmins-backed role (Platform Owner / Platform Admin),
    // not just the raw env-var isSuper check — see lib/firebaseAdmin.js.
    const platformRole = await resolvePlatformRole(c.uid, c.email);
    const isSuper = c.isSuper || platformRole === "OWNER" || platformRole === "ADMIN";
    // canManageOrgs mirrors requireOrgManager's gate (a platform admin, or
    // Global Admin / Admin on their own account) — used to show/hide the
    // Add Organization section on /profile.
    return NextResponse.json({
      email: c.email, superAdmin: isSuper, platformRole: platformRole || (c.isSuper ? "OWNER" : null),
      accountId, isAccountAdmin, hasAccount, profile, isOwner,
      organizationId, organizationRole,
      canManageOrgs: isSuper || isAccountAdmin,
    });
  } catch {
    return NextResponse.json({ superAdmin: false, isAccountAdmin: false, hasAccount: false, canManageOrgs: false });
  }
}
