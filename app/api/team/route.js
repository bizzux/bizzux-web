import { NextResponse } from "next/server";
import { requireAccountAdmin, adminAuth, adminDb, sendAuthEmail, generateTempPassword } from "@/lib/firebaseAdmin";
import { PROFILE_VALUES, DEFAULT_PROFILE } from "@/lib/roles";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { logAuditEvent } from "@/lib/audit";
import { upsertOrganizationMembership, setOrganizationMembershipStatus, roleFromProfile, ORGANIZATION_ROLES } from "@/lib/organizationMembership";
import { upsertAppAssignment } from "@/lib/appAccess";
import { APPS, APP_IDS } from "@/lib/appCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function toIso(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
}

function teamCollection(accountId) {
  return adminDb().collection("customers/" + accountId + "/team");
}

async function sendInvite({ accountId, teamMemberId, email, firstName, lastName, role, profile, origin }) {
  const token = randomUUID();
  await adminDb()
    .doc("invites/" + token)
    .set({
      accountId,
      teamMemberId,
      email,
      firstName,
      lastName,
      role,
      profile,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + INVITE_TTL_MS),
      used: false,
    });

  await sendAuthEmail({
    requestType: "PASSWORD_RESET",
    email,
    continueUrl: `${origin}/accept-invite?invite=${token}`,
  });
}

// Single-member detail for the "Manage roles & app access" panel: their
// org role plus per-app {granted, admin} state, computed the same way the
// list below does but scoped to one person so the panel doesn't need to
// re-fetch (or re-derive) the whole team.
async function getMemberDetail(acct, memberId) {
  const isOwner = memberId === acct.accountId;
  let uid, orgRoleFallback;
  if (isOwner) {
    uid = acct.accountId;
    orgRoleFallback = "OWNER";
  } else {
    const memberSnap = await adminDb().doc(`customers/${acct.accountId}/team/${memberId}`).get();
    if (!memberSnap.exists) throw { status: 404, message: "Not found" };
    const t = memberSnap.data();
    if (!t.uid) throw { status: 400, message: "This teammate hasn't joined yet" };
    uid = t.uid;
    orgRoleFallback = roleFromProfile(t.profile || DEFAULT_PROFILE, false);
  }

  const [membershipSnap, assignmentsSnap] = await Promise.all([
    adminDb().doc(`organizationMemberships/${acct.accountId}_${uid}`).get(),
    adminDb()
      .collection("appAssignments")
      .where("organizationId", "==", acct.accountId)
      .where("userId", "==", uid)
      .get(),
  ]);
  const orgRole = membershipSnap.exists ? membershipSnap.data().role : orgRoleFallback;
  const assignmentByAppId = new Map(assignmentsSnap.docs.map((d) => [d.data().appId, d.data()]));

  const apps = APPS.map((a) => {
    const assignment = assignmentByAppId.get(a.id);
    return {
      appId: a.id,
      name: a.name,
      granted: assignment?.status === "ACTIVE",
      admin: assignment?.status === "ACTIVE" && assignment.role === "ADMIN",
    };
  });

  return { uid, isOwner, orgRole, apps };
}

// Lists everyone on the caller's account: the owner plus every invited /
// active teammate. Global Admin / Admin profiles only.
export async function GET(req) {
  try {
    const acct = await requireAccountAdmin(req);

    const memberId = new URL(req.url).searchParams.get("memberId");
    if (memberId) {
      return NextResponse.json(await getMemberDetail(acct, memberId));
    }

    const ownerSnap = await adminDb().doc("customers/" + acct.accountId).get();
    const owner = ownerSnap.exists ? ownerSnap.data() : {};
    const teamSnap = await teamCollection(acct.accountId).get();

    // organizationMemberships is the source of truth for the generic
    // OWNER/ADMIN/MEMBER/VIEWER org role (see lib/organizationMembership.js)
    // — falls back to mapping the business profile when a member predates
    // that collection and hasn't been backfilled yet.
    const orgMembershipsSnap = await adminDb()
      .collection("organizationMemberships")
      .where("organizationId", "==", acct.accountId)
      .get();
    const orgRoleByUid = new Map(orgMembershipsSnap.docs.map((d) => [d.data().userId, d.data().role]));

    // Which apps (lib/appCatalog.js) each member currently has ACTIVE
    // AppAssignment for (see lib/appAccess.js) — purely a display column
    // here; actually granting/revoking access still happens on Team > Apps.
    const assignmentsSnap = await adminDb()
      .collection("appAssignments")
      .where("organizationId", "==", acct.accountId)
      .where("status", "==", "ACTIVE")
      .get();
    const appIdsByUid = new Map();
    assignmentsSnap.docs.forEach((d) => {
      const a = d.data();
      const list = appIdsByUid.get(a.userId) || [];
      list.push(a.appId);
      appIdsByUid.set(a.userId, list);
    });
    const appNameById = new Map(APPS.map((a) => [a.id, a.name]));
    const appAccessFor = (uid) => (appIdsByUid.get(uid) || []).map((id) => appNameById.get(id) || id);

    const members = [
      {
        id: acct.accountId,
        firstName: owner.fullName || "",
        lastName: "",
        email: owner.email || "",
        role: "Owner",
        profile: "Admin",
        orgRole: orgRoleByUid.get(acct.accountId) || "OWNER",
        appAccess: appAccessFor(acct.accountId),
        status: "active",
        isOwner: true,
        joinedAt: toIso(owner.createdAt),
      },
      ...teamSnap.docs.map((d) => {
        const t = d.data();
        return {
          id: d.id,
          firstName: t.firstName || "",
          lastName: t.lastName || "",
          email: t.email || "",
          role: t.role || "",
          profile: t.profile || DEFAULT_PROFILE,
          orgRole: (t.uid && orgRoleByUid.get(t.uid)) || roleFromProfile(t.profile || DEFAULT_PROFILE, false),
          appAccess: t.uid ? appAccessFor(t.uid) : [],
          status: t.disabled ? "disabled" : (t.status || "invited"),
          isOwner: false,
          joinedAt: toIso(t.joinedAt),
          invitedAt: toIso(t.invitedAt),
        };
      }),
    ];

    return NextResponse.json({
      organizationName: owner.organizationName || owner.companyName || null,
      members,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

// Action-based, same pattern as /api/admin/plans: { action: "invite" | "remove" | "resend", ... }
export async function POST(req) {
  try {
    const acct = await requireAccountAdmin(req);
    const body = await req.json();
    const origin = req.headers.get("origin") || new URL(req.url).origin;

    if (body.action === "invite") {
      const firstName = String(body.firstName || "").trim().slice(0, 60);
      const lastName = String(body.lastName || "").trim().slice(0, 60);
      const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
      const role = String(body.role || "").trim().slice(0, 60);
      const profile = PROFILE_VALUES.includes(body.profile) ? body.profile : DEFAULT_PROFILE;
      // Optional, purely descriptive — mirrors the M365 "Add a user" wizard's
      // Profile info section. None of these fields gate access or feed any
      // role/permission logic; they're just shown back on the teammate's
      // detail panel.
      const ci = body.contactInfo && typeof body.contactInfo === "object" ? body.contactInfo : {};
      const contactInfo = {
        jobTitle: String(ci.jobTitle || "").trim().slice(0, 100),
        department: String(ci.department || "").trim().slice(0, 100),
        office: String(ci.office || "").trim().slice(0, 100),
        officePhone: String(ci.officePhone || "").trim().slice(0, 40),
        faxNumber: String(ci.faxNumber || "").trim().slice(0, 40),
        mobilePhone: String(ci.mobilePhone || "").trim().slice(0, 40),
        streetAddress: String(ci.streetAddress || "").trim().slice(0, 200),
        city: String(ci.city || "").trim().slice(0, 100),
        state: String(ci.state || "").trim().slice(0, 100),
        zip: String(ci.zip || "").trim().slice(0, 20),
        country: String(ci.country || "").trim().slice(0, 100),
      };

      if (!firstName) throw { status: 400, message: "First name is required" };
      if (!EMAIL_RE.test(email)) throw { status: 400, message: "Enter a valid email address" };

      const dupe = await teamCollection(acct.accountId).where("email", "==", email).limit(1).get();
      if (!dupe.empty) throw { status: 409, message: "That email is already on your team" };

      // "credentials" is for a teammate with no email staff can reliably
      // reach — same rationale as /api/admin/organizations "createAccount".
      // The account owner sets (or generates) a password directly and hands
      // it over themselves; no email ever gets sent, and the membership is
      // active immediately instead of sitting in "invited" waiting on a
      // link nobody can click.
      const loginMethod = body.loginMethod === "credentials" ? "credentials" : "email";
      let password = "";

      let authUser;
      try {
        if (loginMethod === "credentials") {
          password = String(body.password || "").trim() || generateTempPassword();
          if (password.length < 8) throw { status: 400, message: "Password must be at least 8 characters" };
          authUser = await adminAuth().createUser({ email, password, emailVerified: true });
        } else {
          authUser = await adminAuth().createUser({ email, emailVerified: false });
        }
      } catch (e) {
        if (e.code === "auth/email-already-exists") {
          throw {
            status: 409,
            message: "That email already has a Bizzux account and can't be invited as a new teammate yet.",
          };
        }
        throw e;
      }

      const memberRef = await teamCollection(acct.accountId).add({
        firstName,
        lastName,
        email,
        role,
        profile,
        contactInfo,
        status: loginMethod === "credentials" ? "active" : "invited",
        uid: authUser.uid,
        invitedBy: acct.email,
        invitedAt: FieldValue.serverTimestamp(),
        joinedAt: loginMethod === "credentials" ? FieldValue.serverTimestamp() : null,
      });

      if (loginMethod === "credentials") {
        // Mirrors what /api/team/accept writes once an email-invited
        // teammate accepts — without this, resolveAccount() has nothing to
        // find for this uid (no customers/ doc, no memberships/ doc) and a
        // credentials-created teammate could never actually sign in.
        await adminDb().doc("memberships/" + authUser.uid).set({
          accountId: acct.accountId, profile, role, email, joinedAt: FieldValue.serverTimestamp(),
        });
        await upsertOrganizationMembership({
          organizationId: acct.accountId, userId: authUser.uid,
          role: roleFromProfile(profile, false), status: "active",
        });
      } else {
        // Email-invite path: the membership isn't real until /api/team/
        // accept finalizes it, but recording it now as "invited" (keyed by
        // the auth user already created above) makes the pending state
        // queryable the same way an accepted one is.
        await upsertOrganizationMembership({
          organizationId: acct.accountId, userId: authUser.uid,
          role: roleFromProfile(profile, false), status: "invited",
        });
      }

      if (loginMethod === "email") {
        await sendInvite({
          accountId: acct.accountId,
          teamMemberId: memberRef.id,
          email,
          firstName,
          lastName,
          role,
          profile,
          origin,
        });
      }

      // Which Bizzux apps this new teammate gets, and whether they admin
      // each one (AppAssignment.role: ADMIN | MEMBER — see lib/appAccess.js)
      // — chosen right in this same invite step rather than a separate
      // Team > Apps visit. Requires the org to actually be subscribed to an
      // app before granting it, same rule Team > Apps' own Manage Users
      // enforces.
      const requestedApps = Array.isArray(body.apps) ? body.apps : [];
      if (requestedApps.length > 0) {
        const subsSnap = await adminDb()
          .collection("organizationAppSubscriptions")
          .where("organizationId", "==", acct.accountId)
          .where("status", "==", "ACTIVE")
          .get();
        const subscribedAppIds = new Set(subsSnap.docs.map((d) => d.data().appId));
        await Promise.all(
          requestedApps
            .filter((a) => APP_IDS.includes(a.appId) && subscribedAppIds.has(a.appId))
            .map((a) =>
              upsertAppAssignment({
                organizationId: acct.accountId, userId: authUser.uid, appId: a.appId,
                role: a.role === "ADMIN" ? "ADMIN" : "MEMBER", status: "ACTIVE",
              })
            )
        );
      }

      await logAuditEvent({
        action: "team.invite", actor: acct, targetType: "organization", targetId: acct.accountId,
        details: { email, profile, loginMethod, apps: requestedApps.map((a) => a.appId) },
      });

      return NextResponse.json(loginMethod === "credentials" ? { ok: true, email, password } : { ok: true });
    }

    // Emails a password-reset link to an already-active teammate (distinct
    // from "resend", which only re-sends the original join invite and
    // refuses once someone has already joined).
    if (body.action === "resetPasswordEmail") {
      const id = String(body.id || "");
      if (!id) throw { status: 400, message: "Teammate id required" };
      const memberSnap = await adminDb().doc(`customers/${acct.accountId}/team/${id}`).get();
      if (!memberSnap.exists) throw { status: 404, message: "Not found" };
      const t = memberSnap.data();

      await sendAuthEmail({ requestType: "PASSWORD_RESET", email: t.email, continueUrl: `${origin}/sign-in` });

      await logAuditEvent({
        action: "team.reset_password_email", actor: acct, targetType: "organization", targetId: acct.accountId,
        details: { email: t.email },
      });

      return NextResponse.json({ ok: true });
    }

    // Sets a teammate's password directly and hands it back to the caller,
    // instead of emailing a reset link — for teammates with no working
    // email on file, or one who's called the owner because they forgot
    // their password and can't reach that inbox either.
    if (body.action === "setPassword") {
      const id = String(body.id || "");
      if (!id) throw { status: 400, message: "Teammate id required" };
      const memberSnap = await adminDb().doc(`customers/${acct.accountId}/team/${id}`).get();
      if (!memberSnap.exists) throw { status: 404, message: "Not found" };
      const t = memberSnap.data();

      const password = String(body.password || "").trim() || generateTempPassword();
      if (password.length < 8) throw { status: 400, message: "Password must be at least 8 characters" };

      await adminAuth().updateUser(t.uid, { password });

      await logAuditEvent({
        action: "team.set_password", actor: acct, targetType: "organization", targetId: acct.accountId,
        details: { email: t.email },
      });

      return NextResponse.json({ ok: true, password });
    }

    // Disable/enable: blocks (or restores) sign-in without deleting the
    // teammate outright — for a temporary leave or a dispute, where losing
    // their invite/role history would be the wrong call.
    if (body.action === "disable" || body.action === "enable") {
      const id = String(body.id || "");
      if (!id) throw { status: 400, message: "Teammate id required" };
      const memberRef = adminDb().doc(`customers/${acct.accountId}/team/${id}`);
      const memberSnap = await memberRef.get();
      if (!memberSnap.exists) throw { status: 404, message: "Not found" };
      const t = memberSnap.data();
      const disabling = body.action === "disable";

      await adminAuth().updateUser(t.uid, { disabled: disabling });
      await memberRef.update({ disabled: disabling });

      await logAuditEvent({
        action: disabling ? "team.disable" : "team.enable", actor: acct, targetType: "organization", targetId: acct.accountId,
        details: { email: t.email },
      });

      return NextResponse.json({ ok: true });
    }

    // Changes only the generic OWNER/ADMIN/MEMBER/VIEWER organization role
    // (organizationMemberships) — deliberately separate from the business
    // Profile (Manager/Staff/etc., which still drives every existing
    // permission check and isn't touched here). Ownership transfer isn't
    // supported yet, so OWNER can't be assigned through this action.
    if (body.action === "setOrgRole") {
      const id = String(body.id || "");
      const role = String(body.role || "");
      if (!id || id === acct.accountId) throw { status: 400, message: "Can't change the account owner's role" };
      if (!ORGANIZATION_ROLES.includes(role) || role === "OWNER") {
        throw { status: 400, message: "role must be one of ADMIN, MEMBER, VIEWER" };
      }
      const memberSnap = await adminDb().doc(`customers/${acct.accountId}/team/${id}`).get();
      if (!memberSnap.exists) throw { status: 404, message: "Not found" };
      const t = memberSnap.data();
      if (!t.uid) throw { status: 400, message: "This teammate hasn't joined yet" };

      await upsertOrganizationMembership({ organizationId: acct.accountId, userId: t.uid, role, status: "active" });

      await logAuditEvent({
        action: "team.set_org_role", actor: acct, targetType: "organization", targetId: acct.accountId,
        details: { email: t.email, role },
      });

      return NextResponse.json({ ok: true });
    }

    // Grants/revokes app access + admin-of-that-app for one member in one
    // call — the save action behind "Manage roles & app access". `id` is
    // the account owner's own accountId (grants to themselves — mostly for
    // symmetry, since owners already implicitly have everything) or a
    // customers/{accountId}/team/{id} roster id, same as setOrgRole above.
    if (body.action === "setAppAccess") {
      const id = String(body.id || "");
      const requestedApps = Array.isArray(body.apps) ? body.apps : [];

      let uid;
      if (id === acct.accountId) {
        uid = acct.accountId;
      } else {
        const memberSnap = await adminDb().doc(`customers/${acct.accountId}/team/${id}`).get();
        if (!memberSnap.exists) throw { status: 404, message: "Not found" };
        const t = memberSnap.data();
        if (!t.uid) throw { status: 400, message: "This teammate hasn't joined yet" };
        uid = t.uid;
      }

      const subsSnap = await adminDb()
        .collection("organizationAppSubscriptions")
        .where("organizationId", "==", acct.accountId)
        .where("status", "==", "ACTIVE")
        .get();
      const subscribedAppIds = new Set(subsSnap.docs.map((d) => d.data().appId));

      await Promise.all(
        requestedApps
          .filter((a) => APP_IDS.includes(a.appId))
          .map((a) => {
            const granted = !!a.granted && subscribedAppIds.has(a.appId);
            return upsertAppAssignment({
              organizationId: acct.accountId, userId: uid, appId: a.appId,
              role: a.admin ? "ADMIN" : "MEMBER", status: granted ? "ACTIVE" : "INACTIVE",
            });
          })
      );

      await logAuditEvent({
        action: "team.set_app_access", actor: acct, targetType: "organization", targetId: acct.accountId,
        details: { uid, apps: requestedApps },
      });

      return NextResponse.json({ ok: true });
    }

    if (body.action === "resend") {
      const id = String(body.id || "");
      const memberSnap = await adminDb().doc(`customers/${acct.accountId}/team/${id}`).get();
      if (!memberSnap.exists) throw { status: 404, message: "Not found" };
      const t = memberSnap.data();
      if (t.status === "active") throw { status: 400, message: "This teammate has already joined" };

      await sendInvite({
        accountId: acct.accountId,
        teamMemberId: id,
        email: t.email,
        firstName: t.firstName,
        lastName: t.lastName,
        role: t.role,
        profile: t.profile,
        origin,
      });

      return NextResponse.json({ ok: true });
    }

    if (body.action === "remove") {
      const id = String(body.id || "");
      if (!id || id === acct.accountId) throw { status: 400, message: "Can't remove the account owner" };
      const memberRef = adminDb().doc(`customers/${acct.accountId}/team/${id}`);
      const snap = await memberRef.get();
      if (snap.exists && snap.data().uid) {
        await adminDb()
          .doc("memberships/" + snap.data().uid)
          .delete()
          .catch(() => {});
        // Best-effort — the membership doc above is what actually revokes
        // access (resolveAccount() 404s without it), so a failure here
        // (e.g. the auth user was already gone) shouldn't block removal.
        await adminAuth().deleteUser(snap.data().uid).catch(() => {});
        await setOrganizationMembershipStatus(acct.accountId, snap.data().uid, "removed").catch(() => {});
      }
      await memberRef.delete();

      await logAuditEvent({
        action: "team.remove", actor: acct, targetType: "organization", targetId: acct.accountId,
        details: { email: snap.exists ? snap.data().email : null },
      });

      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
