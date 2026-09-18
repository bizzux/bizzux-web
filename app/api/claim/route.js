import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { getTwoFactorSettings } from "@/lib/twoFactor";
import { deriveVerificationSettings, deriveVerificationFlags } from "@/lib/verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called right after a successful sign-in/sign-up. Bizzux rule 1: a login
// is free and stands on its own — it no longer creates an organization
// automatically. It used to (an owner customers/ doc + Organization +
// OWNER membership + app subscriptions, all as an automatic side effect of
// first sign-in); that's now an explicit action the user takes from the
// dashboard's empty state (POST /api/organizations {action:"create"}, see
// lib/organizationContext.js). This route now just answers "does this
// login already have an organization" so the dashboard knows which view to
// show — existing users are completely unaffected, since they already
// have a customers/ or memberships/ doc from before this change.
export async function POST(req) {
  try {
    const c = await requireUser(req);
    const twoFactor = await getTwoFactorSettings(c.uid);
    const twoFactorFields = { twoFactorEnabled: !!twoFactor.enabled, twoFactorMethod: twoFactor.method || null, twoFactorRequired: !!twoFactor.required };

    const ownerSnap = await adminDb().doc("customers/" + c.uid).get();
    if (ownerSnap.exists) {
      return NextResponse.json({
        ok: true, hasOrganization: true, mustChangePassword: !!ownerSnap.data().mustChangePassword,
        ...twoFactorFields, ...deriveVerificationFlags(ownerSnap.data()),
      });
    }

    // Team members (not the account owner) never get a customers/ doc of
    // their own — their record lives in memberships/{uid} instead (see
    // resolveAccount in lib/firebaseAdmin.js).
    const memSnap = await adminDb().doc("memberships/" + c.uid).get();
    if (memSnap.exists) {
      return NextResponse.json({ ok: true, hasOrganization: true, mustChangePassword: !!memSnap.data().mustChangePassword, ...twoFactorFields });
    }

    // A genuinely new login with no organization yet — rule 1/8's
    // legitimate state. No organization is created; instead this stores
    // the "User" entity itself (users/{uid}) — signup details that used to
    // go straight onto a customers/ doc now have nowhere else to live
    // until they actually create (or are invited to) an organization. See
    // /api/organizations "create", which copies fullName/verification
    // requirements from here onto the new customers/ doc so nothing about
    // email/mobile verification behaves differently once they do.
    let body = {};
    try { body = await req.json(); } catch { /* no body sent (e.g. Google sign-in) */ }
    const fullName = typeof body.fullName === "string" ? body.fullName.trim().slice(0, 120) : "";
    const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 20) : "";

    const userRef = adminDb().doc("users/" + c.uid);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const u = userSnap.data();
      return NextResponse.json({
        ok: true, hasOrganization: false,
        verifyEmailRequired: !!u.verifyEmailRequired, verifyMobileRequired: !!u.verifyMobileRequired,
        mustChangePassword: false, ...twoFactorFields,
      });
    }

    const settingsSnap = await adminDb().doc("portalSettings/config").get();
    const settingsData = settingsSnap.exists ? settingsSnap.data() : {};
    const { verifyEmail, verifyMobile } = deriveVerificationSettings(settingsData);
    // Same reasoning as the old inline comment here: stamped once at
    // signup so a later change to the global setting never affects an
    // account already past this gate. Google sign-ins skip the mobile
    // gate (no phone collected, and Google already verifies email).
    const verifyEmailRequired = verifyEmail;
    const verifyMobileRequired = verifyMobile && !!phone;

    const ipCountry = req.headers.get("x-vercel-ip-country-name") || null;
    const ipCity = req.headers.get("x-vercel-ip-city") ? decodeURIComponent(req.headers.get("x-vercel-ip-city")) : null;
    const ipRegion = req.headers.get("x-vercel-ip-country-region") || null;

    await userRef.set({
      email: c.email,
      fullName: fullName || null,
      phone: phone || null,
      signupCountry: ipCountry,
      signupRegion: ipRegion,
      signupCity: ipCity,
      createdAt: FieldValue.serverTimestamp(),
      verifyEmailRequired,
      verifyMobileRequired,
      ...(verifyMobileRequired ? { phoneVerified: false } : {}),
    });

    return NextResponse.json({ ok: true, hasOrganization: false, verifyEmailRequired, verifyMobileRequired, mustChangePassword: false, ...twoFactorFields });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
