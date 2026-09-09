import { NextResponse } from "next/server";
import { requireOrgManager, adminAuth, adminDb, generateTempPassword } from "@/lib/firebaseAdmin";
import { COUNTRIES } from "@/lib/countries";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Provisioning of a brand-new customer organization — deliberately a
// separate `organizations` collection, NOT `customers`. `customers/{uid}`
// docs are keyed by a real Firebase Auth uid created through the actual
// signup flow (see /api/claim); an organization provisioned here doesn't
// have a signed-in owner yet, so it can't safely reuse that collection or
// its id scheme without risking collisions with (or being mistaken for) a
// real account. Turning one of these into an actual `customers/{uid}`
// account, once someone signs up and claims it, is a separate step not
// built yet.
//
// Gated by requireOrgManager: the Super Admin, plus anyone holding the
// Global Admin or Admin profile on their own account (see
// lib/firebaseAdmin.js for why that's intentional, not a loophole).

const USER_RANGES = ["1-10", "11-20", "21-50", "51-100", "101-200", "201-500", "500+"];
const COUNTRY_CODES = new Set(COUNTRIES.map(([code]) => code));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toIso(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
}

// The Profile (plan) a new organization gets is never taken from the
// request body — it's always the CALLER's own current subscription, so
// nobody can label a new organization with a plan they aren't actually on.
// requireOrgManager() already attaches `customer` for account owners; for
// team members (Global Admin/Admin via membership) and for a Super Admin
// who also happens to hold their own customer account, fall back to
// reading customers/{accountId} directly. Returns null if the caller has
// no subscription (trial or paid) on file at all.
async function resolveOwnPlan(c) {
  let customer = c.customer || null;
  const accountId = c.accountId || c.uid;
  if (!customer) {
    const snap = await adminDb().doc("customers/" + accountId).get();
    if (snap.exists) customer = snap.data();
  }
  if (!customer) return null;
  const status = customer.status || "trial";
  if (status === "trial" || !customer.planId) return { planId: "", planName: "Trial" };
  return { planId: customer.planId, planName: customer.planName || "" };
}

export async function GET(req) {
  try {
    await requireOrgManager(req);
    const snap = await adminDb().collection("organizations").orderBy("createdAt", "desc").get();
    const organizations = snap.docs.map((d) => {
      const data = d.data();
      return { id: d.id, ...data, createdAt: toIso(data.createdAt) };
    });
    return NextResponse.json({ organizations });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const c = await requireOrgManager(req);
    const body = await req.json();

    if (body.action === "delete") {
      if (!body.id) throw { status: 400, message: "Organization id required" };
      await adminDb().doc("organizations/" + body.id).delete();
      return NextResponse.json({ ok: true });
    }

    // Direct onboarding for businesses whose owner has no email address
    // staff can reliably reach (small shops, etc.) — creates a REAL
    // customers/{uid} account immediately, with a login username (any
    // valid-looking email string — it never has to receive mail) and
    // password set by the admin or generated here, instead of leaving a
    // "pending" organizations/ placeholder for someone to self-serve sign
    // up into later. No verification gate is stamped on these accounts:
    // the Platform Admin creating the login IS the verification.
    if (body.action === "createAccount") {
      const organizationName = String(body.organizationName || "").trim().slice(0, 160);
      if (!organizationName) throw { status: 400, message: "Business/shop name is required" };

      const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
      if (!EMAIL_RE.test(email)) {
        throw { status: 400, message: "Enter a login username in email format (e.g. shopname@bizzux.login) — it doesn't need to be a real inbox" };
      }

      const countryCode = String(body.countryCode || "").trim().toUpperCase();
      const country = COUNTRIES.find(([code]) => code === countryCode);
      if (!country) throw { status: 400, message: "Choose a valid country" };

      const state = String(body.state || "").trim().slice(0, 100);

      const timezone = String(body.timezone || "").trim().slice(0, 60);
      if (!timezone) throw { status: 400, message: "Time zone is required" };

      const currency = String(body.currency || "").trim().toUpperCase().slice(0, 10);
      if (!currency) throw { status: 400, message: "Currency is required" };

      const userRange = String(body.userRange || "");
      if (!USER_RANGES.includes(userRange)) throw { status: 400, message: "Choose a valid number of users" };

      const password = String(body.password || "").trim() || generateTempPassword();
      if (password.length < 8) throw { status: 400, message: "Password must be at least 8 characters" };

      const ownPlan = await resolveOwnPlan(c);
      if (!ownPlan) {
        throw { status: 400, message: "Your account doesn't have an active plan or trial on file, so a Profile can't be set for this business." };
      }
      const { planId, planName } = ownPlan;

      let authUser;
      try {
        authUser = await adminAuth().createUser({ email, password, emailVerified: true, displayName: organizationName });
      } catch (e) {
        if (e.code === "auth/email-already-exists") {
          throw { status: 409, message: "That login username is already in use by another account." };
        }
        throw e;
      }

      const settingsSnap = await adminDb().doc("portalSettings/config").get();
      const trialDays = Number((settingsSnap.exists ? settingsSnap.data().trialDays : null) ?? 14) || 14;
      const now = Timestamp.now();
      const trialEndDate = Timestamp.fromMillis(now.toMillis() + trialDays * 24 * 60 * 60 * 1000);

      await adminDb().doc("customers/" + authUser.uid).set({
        email,
        organizationName,
        companyName: organizationName,
        countryCode,
        country: country[1],
        state,
        timezone,
        currency,
        userRange,
        createdAt: FieldValue.serverTimestamp(),
        trialStartDate: now,
        trialEndDate,
        status: "trial",
        planId,
        planName,
        onboarded: false,
        // No verification gates — this login was created and vouched for
        // directly by a Platform Admin, not through self-serve signup.
        verifyEmailRequired: false,
        verifyMobileRequired: false,
        createdByAdmin: true,
        createdByAdminEmail: c.email,
      });

      await logAuditEvent({
        action: "organization.create_account", actor: c, targetType: "organization", targetId: authUser.uid,
        details: { organizationName, email },
      });

      return NextResponse.json({ ok: true, uid: authUser.uid, email, password });
    }

    // create (the only other supported action)
    const organizationName = String(body.organizationName || "").trim().slice(0, 160);
    if (!organizationName) throw { status: 400, message: "Organization name is required" };

    const countryCode = String(body.countryCode || "").trim().toUpperCase();
    const country = COUNTRIES.find(([code]) => code === countryCode);
    if (!country) throw { status: 400, message: "Choose a valid country" };

    const state = String(body.state || "").trim().slice(0, 100);

    const timezone = String(body.timezone || "").trim().slice(0, 60);
    if (!timezone) throw { status: 400, message: "Time zone is required" };

    const currency = String(body.currency || "").trim().toUpperCase().slice(0, 10);
    if (!currency) throw { status: 400, message: "Currency is required" };

    const userRange = String(body.userRange || "");
    if (!USER_RANGES.includes(userRange)) throw { status: 400, message: "Choose a valid number of users" };

    const ownPlan = await resolveOwnPlan(c);
    if (!ownPlan) {
      throw { status: 400, message: "Your account doesn't have an active plan or trial on file, so a Profile can't be set for this organization." };
    }
    const { planId, planName } = ownPlan;

    const ref = await adminDb().collection("organizations").add({
      organizationName,
      countryCode,
      countryName: country[1],
      state,
      timezone,
      currency,
      userRange,
      planId,
      planName,
      status: "pending", // not yet claimed by a real signed-in account
      createdBy: c.email,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, id: ref.id });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
