import { NextResponse } from "next/server";
import { requireUser, resolveAccount, resolvePlatformRole, adminDb } from "@/lib/firebaseAdmin";
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
    let fullName = null;
    // A login can both own its own Bizzux account AND be staff on someone
    // else's team (resolveAccount() picks one, defaulting to their own
    // account) — these three fields describe that duality so Nav's account
    // switcher can offer to flip between the two. dualContext is false for
    // the overwhelmingly common single-context case.
    let dualContext = false;
    let useMembershipContext = false;
    let ownAccountEmail = null;
    let membershipOrgEmail = null;
    // The org/company name typed into the "Getting Started" wizard
    // (OnboardingModal -> api/onboarding) — shown in Nav and in every
    // satellite app's sidebar (Projects, Chat, Notes, Files) so a member
    // always knows which company's workspace they're in, not just "Bizzux"
    // (the platform brand). null until the owner has completed onboarding.
    let organizationName = null;
    try {
      const acct = await resolveAccount(c.uid);
      accountId = acct.accountId;
      isAccountAdmin = ACCOUNT_ADMIN_PROFILES.includes(acct.profile);
      profile = acct.profile;
      isOwner = acct.isOwner;
      organizationId = acct.organizationId;
      organizationRole = acct.organizationRole;
      // Owner's own doc is already in hand; a team member's isn't (acct only
      // carries their membership doc), so fetch the org's customers/ doc.
      const orgCustomer = acct.isOwner ? acct.customer : (await adminDb().doc("customers/" + acct.accountId).get()).data();
      organizationName = orgCustomer?.organizationName || orgCustomer?.companyName || null;
      // The real first+last name, when there is one on file — Firebase
      // Auth's own displayName is only ever set for a Google sign-in, so
      // an email/password login (the common case for an invited teammate)
      // would otherwise have no name to greet them by at all.
      fullName = acct.isOwner
        ? acct.customer?.fullName || null
        : [acct.membership?.firstName, acct.membership?.lastName].filter(Boolean).join(" ") || null;
      // Admin-created logins (Create Business Login, or an admin-created
      // team member) can be flagged to force a password change on first
      // sign-in — checked again here (not just right after sign-in) so a
      // bookmarked /dashboard link can't skip it. See /change-password.
      mustChangePassword = !!(acct.customer?.mustChangePassword || acct.membership?.mustChangePassword);

      if (acct.isOwner && acct.hasMembership) {
        dualContext = true;
        ownAccountEmail = c.email;
        const memSnap = await adminDb().doc("memberships/" + c.uid).get();
        const orgSnap = memSnap.exists ? await adminDb().doc("customers/" + memSnap.data().accountId).get() : null;
        membershipOrgEmail = orgSnap?.exists ? orgSnap.data().email : null;
      } else if (!acct.isOwner && acct.hasOwnAccount) {
        dualContext = true;
        useMembershipContext = true;
        ownAccountEmail = c.email;
        const orgSnap = await adminDb().doc("customers/" + acct.accountId).get();
        membershipOrgEmail = orgSnap.exists ? orgSnap.data().email : null;
      }
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
      organizationId, organizationRole, organizationName, mustChangePassword,
      dualContext, useMembershipContext, ownAccountEmail, membershipOrgEmail,
      twoFactorEnabled: !!twoFactor.enabled, twoFactorMethod: twoFactor.method || null, twoFactorRequired: !!twoFactor.required,
      canManageOrgs: isSuper || isAccountAdmin,
    });
  } catch {
    return NextResponse.json({ superAdmin: false, isAccountAdmin: false, hasAccount: false, canManageOrgs: false });
  }
}
