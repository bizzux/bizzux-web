import { NextResponse } from "next/server";
import { requireUser, resolvePlatformRole, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createOrganization } from "@/lib/organization";
import { upsertOrganizationMembership } from "@/lib/organizationMembership";
import { upsertOrganizationAppSubscription, upsertAppAssignment } from "@/lib/appAccess";
import { APP_IDS } from "@/lib/appCatalog";
import { getUserOrganizations, resolveCurrentOrganization, setCurrentOrganization } from "@/lib/organizationContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every organization the signed-in user belongs to, plus which one is
// "current" (rule 9) — the data behind the dashboard's empty state and its
// organization switcher. Deliberately doesn't require an existing
// organization to call this (rule 1: login is free).
export async function GET(req) {
  try {
    const c = await requireUser(req);
    const [organizations, current] = await Promise.all([
      getUserOrganizations(c.uid),
      resolveCurrentOrganization(c.uid),
    ]);
    return NextResponse.json({ organizations, currentOrganizationId: current?.organizationId || null });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const c = await requireUser(req);
    const body = await req.json();

    // Explicit organization creation (used to be an automatic side effect
    // of first sign-in in /api/claim — rule 1 requires login to stay free
    // of any organization until someone actually asks to create one).
    // Always creates the caller as OWNER (rule 3) — anyone can create as
    // many organizations as they like; this is on top of whatever
    // organizations they already belong to (rule 2), not a replacement.
    if (body.action === "create") {
      const name = String(body.name || "").trim().slice(0, 160);
      if (!name) throw { status: 400, message: "Organization name is required" };

      // A brand-new organization always gets its own id — reusing the
      // caller's uid only works for their FIRST organization (matching the
      // existing customers/{uid} scheme every other route still assumes);
      // a second+ organization for the same person needs its own identity,
      // which today means its own Firebase Auth login, same as any other
      // organization owner. Kept simple for this phase: creating a second
      // organization under the same login isn't supported yet — flagged
      // clearly rather than silently doing the wrong thing.
      const already = await adminDb().doc("customers/" + c.uid).get();
      if (already.exists) {
        throw { status: 409, message: "This login already owns an organization. Creating a second one isn't supported yet — sign up with a different email for a separate organization." };
      }

      const platformRole = await resolvePlatformRole(c.uid, c.email);
      const orgType = c.isSuper || platformRole ? "INTERNAL" : "CUSTOMER";

      const settingsSnap = await adminDb().doc("portalSettings/config").get();
      const trialDays = Number(settingsSnap.exists ? settingsSnap.data().trialDays ?? 14 : 14) || 14;
      const now = Timestamp.now();
      const trialEndDate = Timestamp.fromMillis(now.toMillis() + trialDays * 24 * 60 * 60 * 1000);

      // Carries forward whatever /api/claim captured at signup (rule 1
      // means that's all it could do at the time) — same
      // fullName/phone/verification requirements a brand-new customers/
      // doc would have gotten before this phase, just applied now instead
      // of at login.
      const userSnap = await adminDb().doc("users/" + c.uid).get();
      const u = userSnap.exists ? userSnap.data() : {};

      // The dashboard's quick-setup step (asked only when someone first
      // opens a company app) is the whole onboarding now — one name field,
      // plus business type when the app is Bizzux Business, with currency
      // and time zone taken from the browser. So the org is created already
      // "onboarded"; OnboardingModal no longer pops up afterwards asking for
      // the same name again.
      const currency = ["INR", "USD", "GBP", "AED"].includes(body.currency) ? body.currency : "INR";
      const timezone = String(body.timezone || "Asia/Kolkata").trim().slice(0, 60);
      const businessType = ["shop", "travel", "medical", "services"].includes(body.businessType) ? body.businessType : null;

      await adminDb().doc("customers/" + c.uid).set({
        email: c.email,
        fullName: u.fullName || null,
        phone: u.phone || null,
        signupCountry: u.signupCountry || null,
        signupRegion: u.signupRegion || null,
        signupCity: u.signupCity || null,
        organizationName: name,
        companyName: name,
        currency,
        timezone,
        ...(businessType ? { businessType } : {}),
        // The dashboard asks for it the first time Bizzux Business is opened.
        businessTypePending: !businessType,
        createdAt: FieldValue.serverTimestamp(),
        trialStartDate: now,
        trialEndDate,
        status: "trial",
        planId: null,
        planName: null,
        onboarded: true,
        onboardedAt: FieldValue.serverTimestamp(),
        verifyEmailRequired: !!u.verifyEmailRequired,
        verifyMobileRequired: !!u.verifyMobileRequired,
        mustChangePassword: false,
        ...(u.verifyMobileRequired ? { phoneVerified: !!u.phoneVerified } : {}),
      });
      await createOrganization({ id: c.uid, name, type: orgType, createdBy: c.uid });
      await upsertOrganizationMembership({ organizationId: c.uid, userId: c.uid, role: "OWNER", status: "active" });
      await Promise.all(
        APP_IDS.map((appId) =>
          upsertOrganizationAppSubscription({
            organizationId: c.uid, appId, status: "ACTIVE",
            subscriptionType: orgType === "INTERNAL" ? "INTERNAL" : "TRIAL",
          })
        )
      );
      await Promise.all(
        APP_IDS.map((appId) => upsertAppAssignment({ organizationId: c.uid, userId: c.uid, appId, role: "OWNER", status: "ACTIVE" }))
      );
      await setCurrentOrganization(c.uid, c.uid);

      return NextResponse.json({ ok: true, organizationId: c.uid });
    }

    if (body.action === "switch") {
      const organizationId = String(body.organizationId || "");
      await setCurrentOrganization(c.uid, organizationId);
      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
