import { NextResponse } from "next/server";
import { requireUser, resolveAccount, resolvePlatformRole } from "@/lib/firebaseAdmin";
import { ACCOUNT_ADMIN_PROFILES } from "@/lib/roles";
import { getTwoFactorSettings } from "@/lib/twoFactor";

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
    let mustChangePassword = false;
    try {
      const acct = await resolveAccount(c.uid);
      accountId = acct.accountId;
      isAccountAdmin = ACCOUNT_ADMIN_PROFILES.includes(acct.profile);
      profile = acct.profile;
      isOwner = acct.isOwner;
      organizationId = acct.organizationId;
      organizationRole = acct.organizationRole;
      // Admin-created logins (Create Business Login, or an admin-created
      // team member) can be flagged to force a password change on first
      // sign-in — checked again here (not just right after sign-in) so a
      // bookmarked /dashboard link can't skip it. See /change-password.
      mustChangePassword = !!(acct.customer?.mustChangePassword || acct.membership?.mustChangePassword);
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
    const resolvedPlatformRole = platformRole || (c.isSuper ? "OWNER" : null);
    // accountType distinguishes a Bizzux platform account from a customer
    // organization account, per the two-layer model — a platform role
    // always wins (a Platform Owner/Admin also happening to own a
    // customers/ doc is still fundamentally a platform account).
    const accountType = resolvedPlatformRole ? "PLATFORM_USER" : "ORGANIZATION_USER";
    // Keyed on the uid alone (twoFactor/{uid}), not nested under
    // customers/memberships — so this works identically for an
    // organization owner, a team member, or a Platform Admin/Owner who has
    // no customers/ doc at all. See lib/twoFactor.js.
    const twoFactor = await getTwoFactorSettings(c.uid);
    return NextResponse.json({
      email: c.email, superAdmin: isSuper, platformRole: resolvedPlatformRole, accountType,
      accountId, isAccountAdmin, hasAccount, profile, isOwner,
      organizationId, organizationRole, mustChangePassword,
      twoFactorEnabled: !!twoFactor.enabled, twoFactorMethod: twoFactor.method || null, twoFactorRequired: !!twoFactor.required,
      canManageOrgs: isSuper || isAccountAdmin,
    });
  } catch {
    return NextResponse.json({ superAdmin: false, isAccountAdmin: false, hasAccount: false, canManageOrgs: false });
  }
}
