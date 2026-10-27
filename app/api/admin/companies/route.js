import { NextResponse } from "next/server";
import { safeSyncDirectory } from "@/lib/orgDirectory";
import { requireSuperAdmin, adminAuth, adminDb, generateTempPassword } from "@/lib/firebaseAdmin";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { logAuditEvent } from "@/lib/audit";
import { createOrganization } from "@/lib/organization";
import { upsertOrganizationMembership } from "@/lib/organizationMembership";
import { upsertOrganizationAppSubscription, upsertAppAssignment } from "@/lib/appAccess";
import { APP_IDS } from "@/lib/appCatalog";
import { COUNTRIES } from "@/lib/countries";
import { createUsernameUser } from "@/lib/usernameAuth";
import { validatePassword } from "@/lib/passwordPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Platform Admin Company Management. customers/{ownerUid} stays THE company
// record (billing/trial/plan), organizations/{id} the identity record, and
// organizationAppSubscriptions the app entitlements — kept separate from the
// subscription dates so plan changes never rewrite entitlements.
// Platform Admin only; org Admins use /api/admin/username-users for their own users.

const COMPANY_STATUSES = ["active", "suspended", "expired"];
const PLAN_TYPES = ["TRIAL", "PAID"];
const INDUSTRIES = ["Retail", "Services", "Manufacturing", "Marine & Engineering", "Hospitality", "Healthcare", "Education", "Construction", "Technology", "Other"];

const str = (v, n) => String(v ?? "").trim().slice(0, n);
const toIso = (t) => (t && typeof t.toDate === "function" ? t.toDate().toISOString() : t || null);

function parseApps(v) {
  const apps = [...new Set(Array.isArray(v) ? v : [])];
  const bad = apps.filter((a) => !APP_IDS.includes(a));
  if (bad.length) throw { status: 400, message: "Unknown application: " + bad.join(", ") };
  return apps;
}

function parseDate(v, label) {
  const d = new Date(v);
  if (!v || isNaN(d)) throw { status: 400, message: label + " is required (valid date)" };
  return Timestamp.fromDate(d);
}

// Aligns entitlements with the chosen list: enable listed, disable the rest,
// and deactivate every user's assignment for any app being switched off, so
// removed apps are denied for existing users immediately.
async function applyEntitlements(orgId, apps, subscriptionType) {
  await Promise.all(APP_IDS.map((appId) =>
    upsertOrganizationAppSubscription({
      organizationId: orgId, appId,
      status: apps.includes(appId) ? "ACTIVE" : "INACTIVE", subscriptionType,
    })));
  const removed = APP_IDS.filter((a) => !apps.includes(a));
  if (!removed.length) return;
  const snap = await adminDb().collection("appAssignments").where("organizationId", "==", orgId).get();
  await Promise.all(snap.docs.filter((d) => removed.includes(d.data().appId))
    .map((d) => d.ref.update({ status: "INACTIVE", updatedAt: FieldValue.serverTimestamp() })));
}

export async function GET(req) {
  try {
    await requireSuperAdmin(req);
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id) {
      const [c, subs, team] = await Promise.all([
        adminDb().doc("customers/" + id).get(),
        adminDb().collection("organizationAppSubscriptions").where("organizationId", "==", id).get(),
        adminDb().collection("customers/" + id + "/team").get(),
      ]);
      if (!c.exists) throw { status: 404, message: "Company not found" };
      const d = c.data();
      return NextResponse.json({
        company: { id, ...d, createdAt: toIso(d.createdAt), trialStartDate: toIso(d.trialStartDate), trialEndDate: toIso(d.trialEndDate) },
        enabledApps: subs.docs.map((s) => s.data()).filter((s) => s.status === "ACTIVE").map((s) => s.appId),
        userCount: team.size + 1,
      });
    }
    const snap = await adminDb().collection("customers").where("createdByAdmin", "==", true).limit(500).get();
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const companies = snap.docs
      .map((s) => ({ id: s.id, ...s.data() }))
      .filter((c) => !q || [c.organizationName, c.companyCode, c.industry].some((v) => String(v || "").toLowerCase().includes(q)))
      .map((c) => ({
        id: c.id, name: c.organizationName, companyCode: c.companyCode || null, industry: c.industry || null,
        status: c.companyStatus || "active", planType: c.planType || null, expiresAt: toIso(c.trialEndDate),
        allowedUsers: c.allowedUsers ?? null, createdAt: toIso(c.createdAt),
      }));
    return NextResponse.json({ companies, industries: INDUSTRIES });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const c = await requireSuperAdmin(req);
    const body = await req.json();

    if (body.action === "create") {
      const name = str(body.name, 160);
      if (!name) throw { status: 400, message: "Company name is required" };
      const countryCode = str(body.countryCode, 2).toUpperCase();
      const country = COUNTRIES.find(([code]) => code === countryCode);
      if (!country) throw { status: 400, message: "Choose a valid country" };
      const planType = PLAN_TYPES.includes(body.planType) ? body.planType : "TRIAL";
      const startsAt = parseDate(body.startDate, "Subscription start");
      const expiresAt = parseDate(body.expiryDate, "Subscription expiry");
      if (expiresAt.toMillis() <= startsAt.toMillis()) throw { status: 400, message: "Expiry must be after start" };
      const allowedUsers = Math.max(1, Math.min(100000, parseInt(body.allowedUsers, 10) || 0));
      if (!allowedUsers) throw { status: 400, message: "Allowed user count is required" };
      const apps = parseApps(body.apps);
      if (!apps.length) throw { status: 400, message: "Enable at least one application" };

      const companyCode = (str(body.companyCode, 24).toUpperCase() ||
        "BZ" + Math.random().toString(36).slice(2, 8).toUpperCase()).replace(/[^A-Z0-9-]/g, "");
      if (!companyCode) throw { status: 400, message: "Invalid company code" };
      const dup = await adminDb().collection("customers").where("companyCode", "==", companyCode).limit(1).get();
      if (!dup.empty) throw { status: 409, message: "Company code already in use" };

      const owner = body.owner || {};
      const ownerName = str(owner.fullName, 80);
      if (!ownerName) throw { status: 400, message: "Owner name is required" };
      const password = str(owner.password, 100) || generateTempPassword();

      const { uid, username } = await createUsernameUser({
        username: owner.username, password, displayName: ownerName, organizationId: null,
        mustChangePassword: owner.mustChangePassword !== false, createdBy: c.uid,
      });
      try {
        const problem = await validatePassword(uid, password).catch(() => null);
        if (problem) throw { status: 400, message: problem };
        await adminDb().doc("customers/" + uid).set({
          organizationName: name, companyName: name, companyCode,
          industry: str(body.industry, 60), businessType: str(body.businessType, 60),
          address: str(body.address, 300), state: str(body.state, 100), city: str(body.city, 100),
          countryCode, country: country[1],
          phone: str(body.phone, 20), phoneVerified: false, email: str(body.email, 200).toLowerCase(),
          owner: { name: ownerName, username, phone: str(owner.phone, 20), phoneVerified: false, email: str(owner.email, 200).toLowerCase() },
          timezone: str(body.timezone, 60) || "Asia/Kolkata", currency: str(body.currency, 10).toUpperCase() || "INR",
          planType, allowedUsers, companyStatus: "active",
          // Existing access gates read trialStartDate/trialEndDate/status, so
          // the subscription window is mirrored there.
          trialStartDate: startsAt, trialEndDate: expiresAt, status: "trial", planId: "", planName: planType === "PAID" ? "Admin-provisioned (paid)" : "Trial",
          onboarded: false, verifyEmailRequired: false, verifyMobileRequired: false,
          createdByAdmin: true, createdByAdminEmail: c.email, mustChangePassword: owner.mustChangePassword !== false,
          createdAt: FieldValue.serverTimestamp(),
        });
        await createOrganization({ id: uid, name, type: "CUSTOMER", createdBy: c.uid, registeredVia: "admin", registeredByEmail: c.email || null });
        await upsertOrganizationMembership({ organizationId: uid, userId: uid, role: "OWNER", status: "active" });
        await applyEntitlements(uid, apps, planType === "PAID" ? "PAID" : "TRIAL");
        await Promise.all(apps.map((appId) => upsertAppAssignment({ organizationId: uid, userId: uid, appId, role: "OWNER", status: "ACTIVE" })));
      } catch (err) {
        // Don't leave a half-built tenant behind.
        await adminDb().doc("usernames/" + username).delete().catch(() => {});
        await adminAuth().deleteUser(uid).catch(() => {});
        await adminDb().doc("customers/" + uid).delete().catch(() => {});
        throw err;
      }
      await logAuditEvent({
        action: "company.create", actor: c, targetType: "organization", targetId: uid,
        details: { name, companyCode, planType, apps, ownerUsername: username },
      });
      await safeSyncDirectory(uid);
      return NextResponse.json({ ok: true, id: uid, companyCode, ownerUsername: username, ownerPassword: password });
    }

    const id = str(body.id, 128);
    const snap = id ? await adminDb().doc("customers/" + id).get() : null;
    if (!snap?.exists || !snap.data().createdByAdmin) throw { status: 404, message: "Company not found" };

    if (body.action === "update") {
      const patch = {};
      for (const [k, n] of [["industry", 60], ["businessType", 60], ["address", 300], ["state", 100], ["city", 100], ["phone", 20]]) {
        if (body[k] !== undefined) patch[k] = str(body[k], n);
      }
      if (body.phone !== undefined && patch.phone !== snap.data().phone) patch.phoneVerified = false;
      if (body.allowedUsers !== undefined) patch.allowedUsers = Math.max(1, parseInt(body.allowedUsers, 10) || 1);
      if (body.expiryDate) patch.trialEndDate = parseDate(body.expiryDate, "Subscription expiry");
      if (PLAN_TYPES.includes(body.planType)) patch.planType = body.planType;
      await snap.ref.set(patch, { merge: true });
      await logAuditEvent({ action: "company.update", actor: c, targetType: "organization", targetId: id, details: { fields: Object.keys(patch) } });
      await safeSyncDirectory(id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "setStatus") {
      if (!COMPANY_STATUSES.includes(body.status)) throw { status: 400, message: "Invalid status" };
      const blocked = body.status !== "active";
      // "suspended" is what usernameLogin checks; expired maps to the same block.
      await snap.ref.set({ companyStatus: body.status, status: blocked ? (body.status === "expired" ? "expired" : "suspended") : "trial" }, { merge: true });
      await adminDb().doc("organizations/" + id).set({ status: body.status, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      if (blocked) {
        // End existing sessions too (refresh tokens), not just future logins.
        const team = await adminDb().collection("customers/" + id + "/team").get();
        const uids = [id, ...team.docs.map((d) => d.data().uid).filter(Boolean)];
        await Promise.all(uids.map((u) => adminAuth().revokeRefreshTokens(u).catch(() => {})));
      }
      await logAuditEvent({ action: "company.set_status", actor: c, targetType: "organization", targetId: id, details: { status: body.status } });
      await safeSyncDirectory(id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "setApps") {
      const apps = parseApps(body.apps);
      await applyEntitlements(id, apps, snap.data().planType === "PAID" ? "PAID" : "TRIAL");
      await logAuditEvent({ action: "company.set_apps", actor: c, targetType: "organization", targetId: id, details: { apps } });
      await safeSyncDirectory(id);
      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
