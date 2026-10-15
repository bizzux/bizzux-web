import { NextResponse } from "next/server";
import { requireOrgManager, adminAuth, adminDb, generateTempPassword } from "@/lib/firebaseAdmin";
import { PROFILE_VALUES, DEFAULT_PROFILE } from "@/lib/roles";
import { FieldValue } from "firebase-admin/firestore";
import { logAuditEvent } from "@/lib/audit";
import { upsertOrganizationMembership, roleFromProfile } from "@/lib/organizationMembership";
import { getOrganizationAppSubscriptions, upsertAppAssignment } from "@/lib/appAccess";
import { APP_IDS } from "@/lib/appCatalog";
import { createUsernameUser, usernameForUid, setUsernamePassword } from "@/lib/usernameAuth";
import { validatePassword } from "@/lib/passwordPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-provisioned username logins (no email, no fake mailbox). Callable by
// a Platform Admin for any organization, or by an organization's own
// Admin/Global Admin for THEIR organization only — the tenant check below is
// the isolation boundary and must run before anything else touches the org.

function assertTenant(c, organizationId) {
  if (c.isSuper) return;
  if (c.accountId !== organizationId) throw { status: 403, message: "You can only manage users in your own company" };
}

async function loadTarget(c, uid) {
  const doc = await usernameForUid(uid);
  if (!doc) throw { status: 404, message: "Username login not found" };
  assertTenant(c, doc.data().organizationId);
  return doc;
}

const toIso = (t) => (t && typeof t.toDate === "function" ? t.toDate().toISOString() : null);

// User directory. Platform admins: all companies (or one via ?organizationId=).
// Company admins: always forced to their own company. Never returns hashes.
export async function GET(req) {
  try {
    const c = await requireOrgManager(req);
    const url = new URL(req.url);
    let organizationId = url.searchParams.get("organizationId") || "";
    if (!c.isSuper) organizationId = c.accountId;
    else if (organizationId) assertTenant(c, organizationId);
    let q = adminDb().collection("usernames");
    if (organizationId) q = q.where("organizationId", "==", organizationId);
    const snap = await q.limit(500).get();
    const docs = snap.docs.map((d) => ({ username: d.id, ...d.data() }));
    const orgIds = [...new Set(docs.map((d) => d.organizationId))];
    const [orgSnaps, memSnaps, assigns] = await Promise.all([
      orgIds.length ? adminDb().getAll(...orgIds.map((id) => adminDb().doc("customers/" + id))) : [],
      docs.length ? adminDb().getAll(...docs.map((d) => adminDb().doc("memberships/" + d.uid))) : [],
      organizationId ? adminDb().collection("appAssignments").where("organizationId", "==", organizationId).get() : null,
    ]);
    const orgName = Object.fromEntries(orgSnaps.map((s) => [s.id, s.data()?.organizationName || s.id]));
    const profile = Object.fromEntries(memSnaps.map((s) => [s.id, s.exists ? s.data().profile : "Owner"]));
    const apps = {};
    assigns?.docs.forEach((a) => { const x = a.data(); if (x.status === "ACTIVE") (apps[x.userId] ||= []).push(x.appId); });
    const now = Date.now();
    const users = docs.map((d) => ({
      uid: d.uid, username: d.username, name: d.displayName || "", organizationId: d.organizationId,
      company: orgName[d.organizationId], role: profile[d.uid] || "Staff/Shopkeeper",
      status: d.disabled ? "suspended" : d.mustChangePassword ? "pending activation" : "active",
      locked: !!(d.lockedUntil && d.lockedUntil.toMillis() > now),
      apps: organizationId ? apps[d.uid] || [] : undefined, lastLoginAt: toIso(d.lastLoginAt),
    }));
    return NextResponse.json({ users });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const c = await requireOrgManager(req);
    const body = await req.json();

    if (body.action === "create") {
      const organizationId = String(body.organizationId || c.accountId || "").trim();
      if (!organizationId) throw { status: 400, message: "Select a company" };
      assertTenant(c, organizationId);
      const org = await adminDb().doc("customers/" + organizationId).get();
      if (!org.exists) throw { status: 404, message: "Company not found" };
      if (["suspended", "closed"].includes(org.data().status)) throw { status: 400, message: "Company is not active" };

      if (org.data().allowedUsers) {
        const team = await adminDb().collection("customers/" + organizationId + "/team").count().get();
        if (team.data().count + 1 >= org.data().allowedUsers) {
          throw { status: 400, message: "User limit reached for this company's subscription" };
        }
      }

      const fullName = String(body.fullName || "").trim().slice(0, 80);
      if (!fullName) throw { status: 400, message: "Full name is required" };
      const profile = PROFILE_VALUES.includes(body.profile) ? body.profile : DEFAULT_PROFILE;
      const password = String(body.password || "").trim() || generateTempPassword();
      const problem = await validatePassword(organizationId, password);
      if (problem) throw { status: 400, message: problem };

      // Only apps the company is actually entitled to can be assigned.
      const subs = await getOrganizationAppSubscriptions(organizationId);
      const enabled = new Set(subs.filter((s) => s.status === "ACTIVE").map((s) => s.appId));
      const apps = (Array.isArray(body.apps) ? body.apps : []).filter((a) => APP_IDS.includes(a));
      const denied = apps.filter((a) => !enabled.has(a));
      if (denied.length) throw { status: 400, message: "Not enabled for this company: " + denied.join(", ") };

      const { uid, username } = await createUsernameUser({
        username: body.username, password, displayName: fullName, organizationId,
        mustChangePassword: body.mustChangePassword !== false, createdBy: c.uid,
      });

      const memberRef = await adminDb().collection("customers/" + organizationId + "/team").add({
        firstName: fullName, lastName: "", email: "", username, role: profile, profile,
        employeeId: String(body.employeeId || "").slice(0, 40),
        department: String(body.department || "").slice(0, 80),
        branch: String(body.branch || "").slice(0, 80),
        designation: String(body.designation || "").slice(0, 80),
        mobile: String(body.mobile || "").slice(0, 20), mobileVerified: false,
        status: "active", uid,
        invitedBy: c.email || c.uid, invitedAt: FieldValue.serverTimestamp(), joinedAt: FieldValue.serverTimestamp(),
      });
      await adminDb().doc("memberships/" + uid).set({
        accountId: organizationId, profile, role: profile, username,
        joinedAt: FieldValue.serverTimestamp(), mustChangePassword: body.mustChangePassword !== false,
      });
      await upsertOrganizationMembership({
        organizationId, userId: uid, role: roleFromProfile(profile, false), status: "active",
      });
      await Promise.all(apps.map((appId) => upsertAppAssignment({ organizationId, userId: uid, appId, role: "MEMBER", status: "ACTIVE" })));

      await logAuditEvent({
        action: "user.create_username", actor: c, targetType: "user", targetId: uid,
        details: { organizationId, username, profile, apps },
      });
      // The password is returned once for secure hand-over and never stored in plaintext.
      return NextResponse.json({ ok: true, uid, teamMemberId: memberRef.id, username, password });
    }

    const uid = String(body.uid || "");
    if (!uid) throw { status: 400, message: "uid required" };
    const target = await loadTarget(c, uid);
    const orgId = target.data().organizationId;

    if (body.action === "resetPassword") {
      const password = String(body.password || "").trim() || generateTempPassword();
      const problem = await validatePassword(orgId, password);
      if (problem) throw { status: 400, message: problem };
      await setUsernamePassword(uid, password, true);
      await adminDb().doc("memberships/" + uid).set({ mustChangePassword: true }, { merge: true });
      await logAuditEvent({ action: "user.reset_username_password", actor: c, targetType: "user", targetId: uid, details: { orgId } });
      return NextResponse.json({ ok: true, password });
    }

    if (body.action === "unlock") {
      await target.ref.update({ failedCount: 0, lockedUntil: null });
      await logAuditEvent({ action: "user.unlock_username", actor: c, targetType: "user", targetId: uid, details: { orgId } });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "setApps") {
      // Change a user's applications without recreating the account; only
      // company-enabled apps may be granted, the rest are switched off.
      const apps = new Set((Array.isArray(body.apps) ? body.apps : []).filter((a) => APP_IDS.includes(a)));
      const subs = await getOrganizationAppSubscriptions(orgId);
      const enabled = new Set(subs.filter((s) => s.status === "ACTIVE").map((s) => s.appId));
      const denied = [...apps].filter((a) => !enabled.has(a));
      if (denied.length) throw { status: 400, message: "Not enabled for this company: " + denied.join(", ") };
      await Promise.all(APP_IDS.map((appId) =>
        apps.has(appId)
          ? upsertAppAssignment({ organizationId: orgId, userId: uid, appId, role: "MEMBER", status: "ACTIVE" })
          : adminDb().doc(`appAssignments/${orgId}_${uid}_${appId}`).get().then((s) => s.exists && s.ref.update({ status: "INACTIVE", updatedAt: FieldValue.serverTimestamp() }))));
      await logAuditEvent({ action: "user.set_apps", actor: c, targetType: "user", targetId: uid, details: { organizationId: orgId, apps: [...apps] } });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "suspend" || body.action === "activate") {
      const suspend = body.action === "suspend";
      await adminAuth().updateUser(uid, { disabled: suspend });
      if (suspend) await adminAuth().revokeRefreshTokens(uid);
      await target.ref.update({ disabled: suspend });
      await adminDb().doc("organizationMemberships/" + orgId + "_" + uid)
        .set({ status: suspend ? "suspended" : "active", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await logAuditEvent({ action: suspend ? "user.suspend" : "user.activate", actor: c, targetType: "user", targetId: uid, details: { orgId } });
      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
