import { NextResponse } from "next/server";
import { requireUser, resolveAccount } from "@/lib/firebaseAdmin";
import { createHmac } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
const SHOP_URL = process.env.SHOP_URL || "https://shop.bizzux.com";

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

    let role;
    if (c.isSuper) {
      role = "super";
    } else {
      const acct = await resolveAccount(c.uid);
      role = acct.isOwner ? "owner" : PROFILE_TO_SHOP_ROLE[acct.profile] || "shopkeeper";
    }

    const payload = {
      email: c.email,
      role,
      iat: Date.now(),
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", secret).update(payloadB64).digest("hex");
    const token = payloadB64 + "." + sig;

    return NextResponse.json({ url: `${SHOP_URL}/sso?token=${token}` });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
