import { NextResponse } from "next/server";
import { previewOrgDeletion } from "@/lib/orgLifecycle";
import { requireRecentAuth, requireOrgManager, adminAuth, adminDb, generateTempPassword } from "@/lib/firebaseAdmin";
import { COUNTRIES } from "@/lib/countries";
import { PROFILE_VALUES, DEFAULT_PROFILE } from "@/lib/roles";
import { FieldValue } from "firebase-admin/firestore";
import { logAuditEvent } from "@/lib/audit";
import { assignOrgAdmin } from "@/lib/orgAssignAdmin";
import { upsertOrganizationMembership, roleFromProfile } from "@/lib/organizationMembership";
import {
  INDUSTRIES, assertOrgPermission, provisionOrganization, changeOrganizationStatus,
  updateOrganizationEntitlements, resendOrgInvite, resetOrgAdminPassword, deleteOrganizationPermanently, listOrganizations,
} from "@/lib/orgProvisioning";
import {
  updateBusinessOwner, setAuthorizationStatus, verifyBusinessOwner, transferBusinessOwner, reassignPrimaryAdmin,
} from "@/lib/orgContactsAdmin";
import {
  updateOrganizationDetails, listOrgUsers, updateOrgUser, resetOrgUserPassword,
  setOrgUserDisabled, deleteOrgUser, addOrgUser,
} from "@/lib/orgManagement";

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
// Platform actions (provision / suspend / archive / reactivate /
// updateEntitlements / resendInvite / deletePermanently) are Platform Admin
// only and permission-checked in lib/orgProvisioning.js. Customer Admins
// (via /profile) keep only the legacy placeholder create/list/delete, scoped
// to records they created, and createTeamMember scoped to their own account.

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
    const c = await requireOrgManager(req);
    if (c.isSuper) {
      const url = new URL(req.url);
      const organizations = await listOrganizations({ includeArchived: url.searchParams.get("archived") === "1" });
      return NextResponse.json({ organizations, industries: INDUSTRIES });
    }
    // Customer admins (from /profile) see ONLY the placeholder records they
    // created themselves — never other tenants' organizations.
    const snap = await adminDb().collection("organizations").where("createdBy", "==", c.email).get();
    const organizations = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((o) => !o.type)
      .map((o) => ({ ...o, createdAt: toIso(o.createdAt) }));
    return NextResponse.json({ organizations });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed", ...(e.code ? { code: e.code } : {}), ...(e.blockers ? { blockers: e.blockers } : {}) }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const c = await requireOrgManager(req);
    const body = await req.json();
    const origin = new URL(req.url).origin;

    // ---- Platform Admin actions ------------------------------------------
    // Fine-grained, server-enforced permissions (lib/orgProvisioning.js).
    // The create path takes the plan from the request, never from the
    // caller's own subscription.
    if (body.action === "provision") {
      if (!c.isSuper) throw { status: 403, message: "Platform admin access required" };
      await assertOrgPermission(c, "organizations.create");
      const r = await provisionOrganization({ actor: c, body, origin });
      return NextResponse.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
    }
    if (["suspend", "archive", "reactivate"].includes(body.action)) {
      if (!c.isSuper) throw { status: 403, message: "Platform admin access required" };
      return NextResponse.json(await changeOrganizationStatus({ actor: c, organizationId: body.id, action: body.action, reason: body.reason, reasonCode: body.reasonCode }));
    }
    if (body.action === "previewDeletion") {
      if (!c.isSuper) throw { status: 403, message: "Platform admin access required" };
      return NextResponse.json(await previewOrgDeletion({ actor: c, organizationId: body.id }), { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "updateEntitlements") {
      if (!c.isSuper) throw { status: 403, message: "Platform admin access required" };
      return NextResponse.json(await updateOrganizationEntitlements({ actor: c, organizationId: body.id, body }));
    }
    if (body.action === "resendInvite") {
      if (!c.isSuper) throw { status: 403, message: "Platform admin access required" };
      await assertOrgPermission(c, "organizations.manage");
      return NextResponse.json(await resendOrgInvite({ actor: c, organizationId: body.id, origin }));
    }
    // ---- Ownership & administration (each checks its own server permission) --
    // The actor is always the authenticated session `c`; nothing in the body can
    // name a different actor. Verification and ownership transfer are Owner-only.
    const ownershipActions = {
      updateBusinessOwner: () => updateBusinessOwner({ actor: c, organizationId: body.id, owner: body.owner, reason: body.reason }),
      setAuthorization: () => setAuthorizationStatus({ actor: c, organizationId: body.id, status: body.status, reason: body.reason }),
      verifyBusinessOwner: () => verifyBusinessOwner({ actor: c, organizationId: body.id, reason: body.reason }),
      transferOwnership: () => transferBusinessOwner({ actor: c, organizationId: body.id, newOwner: body.newOwner, reason: body.reason }),
      reassignPrimaryAdmin: () => reassignPrimaryAdmin({ actor: c, organizationId: body.id, newAdminUid: body.newAdminUid, reason: body.reason }),
    };
    if (ownershipActions[body.action]) {
      if (!c.isSuper) throw { status: 403, message: "Platform admin access required" };
      return NextResponse.json(await ownershipActions[body.action](), { headers: { "Cache-Control": "no-store" } });
    }
    // ---- Manage panel: details and users ----------------------------------
    const manageActions = {
      updateDetails: () => updateOrganizationDetails({ actor: c, organizationId: body.id, body }),
      listUsers: () => listOrgUsers({ actor: c, organizationId: body.id }),
      updateUser: () => updateOrgUser({ actor: c, organizationId: body.id, uid: body.uid, body }),
      resetUserPassword: () => resetOrgUserPassword({ actor: c, organizationId: body.id, uid: body.uid, password: body.password, requirePasswordChange: body.requirePasswordChange }),
      setUserDisabled: () => setOrgUserDisabled({ actor: c, organizationId: body.id, uid: body.uid, disabled: body.disabled }),
      deleteUser: () => deleteOrgUser({ actor: c, organizationId: body.id, uid: body.uid }),
      addUser: () => addOrgUser({ actor: c, organizationId: body.id, body: body.user || {}, origin }),
    };
    if (manageActions[body.action]) {
      if (!c.isSuper) throw { status: 403, message: "Platform admin access required" };
      return NextResponse.json(await manageActions[body.action](), { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "resetAdminPassword") {
      if (!c.isSuper) throw { status: 403, message: "Platform admin access required" };
      return NextResponse.json(
        await resetOrgAdminPassword({ actor: c, organizationId: body.id, password: body.password, requirePasswordChange: body.requirePasswordChange }),
        { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "assignAdmin") {
      if (!c.isSuper) throw { status: 403, message: "Platform admin access required" };
      return NextResponse.json(
        await assignOrgAdmin({ actor: c, organizationId: body.id, admin: body.admin || {}, reason: body.reason, origin }),
        { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "deletePermanently") {
      if (!c.isSuper) throw { status: 403, message: "Platform admin access required" };
      requireRecentAuth(c); // sign-in within the last 10 minutes
      const r = await deleteOrganizationPermanently({
        actor: c, organizationId: body.id, confirmName: body.confirmName, reason: body.reason,
        reasonCode: body.reasonCode, earlyPurge: body.earlyPurge === true,
      });
      // Never report a half-finished cleanup as done.
      return NextResponse.json(r, { status: r.ok === false ? 207 : 200, headers: { "Cache-Control": "no-store" } });
    }

    // ---- Legacy: a customer Admin removes a placeholder THEY created ------
    // (used by /profile). Never touches real organizations or other tenants'.
    if (body.action === "delete") {
      if (!body.id) throw { status: 400, message: "Organization id required" };
      const ref = adminDb().doc("organizations/" + body.id);
      const snap = await ref.get();
      const d = snap.data();
      if (!snap.exists || d.type || d.createdBy !== c.email || c.isSuper) {
        throw { status: 403, message: "You can only remove placeholder organizations you created" };
      }
      await ref.delete();
      await logAuditEvent({ action: "organization.placeholder_delete", actor: c, targetType: "organization", targetId: body.id, details: { name: d.organizationName } });
      return NextResponse.json({ ok: true });
    }

    // Adds a team member (Organization Admin, Manager, Staff/Shopkeeper,
    // Viewer/Auditor) directly to an EXISTING customer account, with the
    // same "admin sets a username/password, hands it over directly" flow
    // as createAccount above — for a non-technical owner who can't be
    // expected to run their own team-invite flow, or simply doesn't have a
    // teammate with a real, reliably-checked email address. Writes both
    // customers/{accountId}/team/{id} (what the owner's own /team page
    // lists) and memberships/{uid} (what resolveAccount() actually reads
    // to know this uid's accountId/profile at sign-in) — the credentials
    // path in /api/team/route.js's own "invite" action was missing that
    // second write, which would have left a credentials-created teammate
    // unable to ever sign in; this route does it correctly from the start.
    if (body.action === "createTeamMember") {
      const accountId = String(body.accountId || "").trim();
      if (!accountId) throw { status: 400, message: "Choose which organization this login belongs to" };
      // Tenant isolation: a customer Admin may only add people to THEIR OWN
      // account; only platform staff may target any organization.
      if (!c.isSuper && accountId !== c.accountId) throw { status: 403, message: "You can only manage your own organization" };
      const accountSnap = await adminDb().doc("customers/" + accountId).get();
      if (!accountSnap.exists) throw { status: 404, message: "Organization not found" };

      const firstName = String(body.firstName || "").trim().slice(0, 60);
      if (!firstName) throw { status: 400, message: "Name is required" };
      const profile = PROFILE_VALUES.includes(body.profile) ? body.profile : DEFAULT_PROFILE;

      const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
      if (!EMAIL_RE.test(email)) {
        throw { status: 400, message: "Enter a login username in email format (e.g. name@bizzux.login) — it doesn't need to be a real inbox" };
      }

      const password = String(body.password || "").trim() || generateTempPassword();
      if (password.length < 8) throw { status: 400, message: "Password must be at least 8 characters" };
      const mustChangePassword = body.mustChangePassword !== false;

      let authUser;
      try {
        authUser = await adminAuth().createUser({ email, password, emailVerified: true, displayName: firstName });
      } catch (e) {
        if (e.code === "auth/email-already-exists") {
          throw { status: 409, message: "That login username is already in use by another account." };
        }
        throw e;
      }

      const memberRef = await adminDb().collection("customers/" + accountId + "/team").add({
        firstName, lastName: "", email, role: profile, profile,
        status: "active", uid: authUser.uid,
        invitedBy: c.email, invitedAt: FieldValue.serverTimestamp(), joinedAt: FieldValue.serverTimestamp(),
      });

      await adminDb().doc("memberships/" + authUser.uid).set({
        accountId, profile, role: profile, email, joinedAt: FieldValue.serverTimestamp(), mustChangePassword,
      });

      await upsertOrganizationMembership({
        organizationId: accountId, userId: authUser.uid,
        role: roleFromProfile(profile, false), status: "active",
      });

      await logAuditEvent({
        action: "organization.create_team_member", actor: c, targetType: "organization", targetId: accountId,
        details: { email, profile },
      });

      return NextResponse.json({ ok: true, uid: authUser.uid, teamMemberId: memberRef.id, email, password });
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

    await logAuditEvent({ action: "organization.placeholder_create", actor: c, targetType: "organization", targetId: ref.id, details: { organizationName } });
    return NextResponse.json({ ok: true, id: ref.id });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed", ...(e.code ? { code: e.code } : {}), ...(e.blockers ? { blockers: e.blockers } : {}) }, { status: e.status || 500 });
  }
}
