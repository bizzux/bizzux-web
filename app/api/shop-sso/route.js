import { NextResponse } from "next/server";
import { requireUser, resolveAccount, resolvePlatformRole, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { appDenialFor } from "@/lib/firebaseAdmin";
import { createHmac } from "crypto";
import { CORS_HEADERS, corsPreflight } from "@/lib/cors";
import { logAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lets the in-app "switch apps" launcher inside bizzux-notes/files/projects
// call this cross-origin directly, instead of only ever being reachable
// from bizzux.com's own dashboard tile.
export async function OPTIONS() {
  return corsPreflight();
}

// Bizzux Shop is its own, separate Firebase project (potentially one per
// customer down the line) — this app has no Admin SDK access to it, so
// sign-on can't be done with a Firebase custom token minted here. Instead
// this mints a short-lived, HMAC-signed hand-off token that Shop's own
// /api/sso route verifies (both sides share SHOP_SSO_SECRET) and uses to
// create/sign in the matching account in ITS project.
//
// SHOP_URL lets this point at a local Shop dev server for testing (e.g.
// SHOP_URL=http://localhost:3000 in .env.local) — leave it unset in
// production/Vercel and it falls back to the real deployed Shop.
const SHOP_URL = process.env.SHOP_URL || "https://business.bizzux.com";

// Bizzux Shop's role model has 5 tiers, all decided here — bizzux-apps is
// the single source of truth for roles, Shop no longer manages its own.
// Mapping from a bizzux-apps profile (see lib/roles.js) to a Shop role:
//   - Super Admin (SUPER_ADMIN_EMAIL, this app)      -> Shop "super"
//   - Account Owner (owns the customers/ doc)        -> Shop "owner"
//   - Global Admin / Admin                            -> Shop "owner"
//   - Manager                                         -> Shop "manager"
//   - Viewer/Auditor                                  -> Shop "viewer"
//   - Staff/Shopkeeper (or anything unrecognized)        -> Shop "shopkeeper"
// Global Admin currently gets the same Shop access as Admin (full, visible
// "Owner" access to whichever shop they sign into) rather than Shop's
// hidden Super Admin tier — it's not automatic platform-wide Shop access,
// just parity with Admin. Revisit if Global Admins need more than that.
//
// Super admins may have no customers/ or memberships/ doc at all (they don't
// need to be a customer), so that check must run first and skip
// resolveAccount entirely — resolveAccount would otherwise 404 on them.
const PROFILE_TO_SHOP_ROLE = {
  "Global Admin": "owner",
  Admin: "owner",
  Manager: "manager",
  "Viewer/Auditor": "viewer",
  "Staff/Shopkeeper": "shopkeeper",
};

export async function GET(req) {
  try {
    const c = await requireUser(req);
    const secret = process.env.SHOP_SSO_SECRET;
    if (!secret) throw { status: 500, message: "SHOP_SSO_SECRET is not configured" };

    const asOrg = new URL(req.url).searchParams.get("asOrg");
    if (asOrg) {
      // Platform-Admin-only support tool — see app-sso's own asOrg comment
      // for the full rationale. Shop already has a "super" role concept
      // (see below) that isn't tied to a specific person's identity, so
      // impersonation here is simpler: just point orgId at the chosen
      // organization instead of resolving the caller's own.
      const platformRole = await resolvePlatformRole(c.uid, c.email);
      if (!c.isSuper && !platformRole) throw { status: 403, message: "Platform admin access required" };
      const orgSnap = await adminDb().doc("customers/" + asOrg).get();
      if (!orgSnap.exists) throw { status: 404, message: "Organization not found" };
      await logAuditEvent({
        action: "organization.impersonate_app_open", actor: c, targetType: "organization", targetId: asOrg,
        details: { app: "juicechatjunction" },
      });
      const payload = { email: c.email, role: "super", orgId: asOrg, iat: Date.now() };
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const sig = createHmac("sha256", secret).update(payloadB64).digest("hex");
      const token = payloadB64 + "." + sig;
      return NextResponse.json({ url: `${SHOP_URL}/sso?token=${token}` }, { headers: CORS_HEADERS });
    }

    let role;
    // The tenant boundary Shop scopes ALL its data by — every sale, menu
    // item, expense, etc. gets stamped with this on write and every read is
    // filtered by it. Always the bizzux-web accountId (the organization
    // owner's own uid), regardless of which teammate is signing in, so a
    // whole organization's team shares one Shop tenant. A "pure" Super
    // Admin with no customers/ or memberships/ doc of their own (who'd
    // otherwise 404 out of resolveAccount) falls back to their own uid as a
    // personal org — same fallback shape as requireAccountWithAppsAccess.
    let orgId = c.uid;
    // Shop's real main tabs this account's plan allows (see lib/apps.js's
    // APP_CATALOG "features" list, edited from Admin > Plan Apps). Left
    // undefined — meaning "don't restrict" — for a Super Admin, or whenever
    // the current plan hasn't configured a tab list for Shop at all, so an
    // unconfigured plan behaves exactly like before this existed.
    let features;
    // Controls which admin tabs Shop shows this org (see Shop's
    // app/admin/page.js) — "travel"/"medical"/"services" unlock the
    // Enquiry -> Quotation -> Invoice billing module instead of the
    // default Shop/POS tab set. Set via bizzux-web's onboarding wizard
    // (components/OnboardingModal.jsx -> customers/{uid}.businessType).
    let businessType;
    if (c.isSuper) {
      role = "super";
      try {
        const acct = await resolveAccount(c.uid);
        orgId = acct.accountId;
      } catch {
        // No account of their own — keep the personal-org fallback above.
      }
    } else {
      const acct = await resolveAccount(c.uid);
      orgId = acct.accountId;

      // Defense in depth — dashboard/page.js already blocks this in the UI
      // via the same canAccessApps() check (lib/trial.js) before it ever
      // calls this endpoint, but a signed-in user could still hit it
      // directly, so trial/subscription status is enforced here too. Team
      // members don't carry the customer doc on their own account record
      // (resolveAccount only gives that to the owner), so look it up by
      // accountId when needed.
      const customer = acct.isOwner
        ? acct.customer
        : (await adminDb().doc("customers/" + acct.accountId).get()).data();
      const denial = await appDenialFor(customer, "juicechatjunction");
      if (denial) {
        // A Platform Admin created later via the portal (not in
        // SUPER_ADMIN_EMAIL, so c.isSuper missed them above) should never be
        // blocked by their own account's trial/plan status — check
        // platformAdmins before rejecting. Only reached once the cheap
        // trial check has already failed, so this extra Firestore read
        // never lands on the common case (an in-trial or paying customer).
        const platformRole = await resolvePlatformRole(c.uid, c.email);
        if (platformRole !== "OWNER" && platformRole !== "ADMIN") throw denial;
        role = "super";
      } else {
        role = acct.isOwner ? "owner" : PROFILE_TO_SHOP_ROLE[acct.profile] || "shopkeeper";
        // No per-plan tab limits any more: a paid App or Suite unlocks the
        // whole app. (The old plans/{id}.appAccess feature lists are no
        // longer read; `features` is simply never sent.)
        businessType = customer?.businessType || null;
      }
    }

    // Same best-effort "last opened" stamp app-sso does for its apps (see
    // that route) — keyed "juicechatjunction" to match APP_CATALOG/dashboard's
    // key for Shop, so the admin Apps Used column can use one lookup table.
    adminDb()
      .doc("customers/" + orgId)
      .update({ ["appUsage.juicechatjunction"]: FieldValue.serverTimestamp() })
      .catch(() => {});

    const payload = {
      email: c.email,
      role,
      orgId,
      iat: Date.now(),
      ...(features ? { features } : {}),
      ...(businessType ? { businessType } : {}),
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", secret).update(payloadB64).digest("hex");
    const token = payloadB64 + "." + sig;

    return NextResponse.json({ url: `${SHOP_URL}/sso?token=${token}` }, { headers: CORS_HEADERS });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed", ...(e.code ? { code: e.code } : {}) }, { status: e.status || 500, headers: CORS_HEADERS });
  }
}
