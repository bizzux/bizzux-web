import { NextResponse } from "next/server";
import { requirePlatformAdmin, adminAuth, adminDb, sendAuthEmail, generateTempPassword } from "@/lib/firebaseAdmin";
import { logAuditEvent } from "@/lib/audit";
import { findCountryByPhone } from "@/lib/countryCodes";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { ACCOUNT_ADMIN_PROFILES } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRIAL_EXTEND_UNITS = ["days", "weeks", "months", "years"];

function toIso(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  return ts;
}

// "Trial" / "New" / "Renewal" for the Customers list — paymentCount is
// incremented by the Razorpay/Stripe webhooks on every successful charge
// (see app/api/webhooks/razorpay/route.js and .../stripe/route.js), so
// this reflects real billing history, not a guess from status alone.
function customerType(data) {
  const paymentCount = Number(data.paymentCount) || 0;
  if (paymentCount >= 2) return "Renewal";
  if (paymentCount === 1) return "New (paid)";
  return "Trial";
}

// Detail mode (?id=<accountId>): who this org's Owner + Organization Admins
// are, read on demand rather than fetched for every row in the bulk list
// below (would be an N+1 read per customer otherwise).
async function loadOrgAdmins(accountId, ownerEmail) {
  const teamSnap = await adminDb().collection("customers/" + accountId + "/team").get();
  const admins = [{ email: ownerEmail, profile: "Admin", role: "Organization Owner", isOwner: true, uid: accountId }];
  teamSnap.docs.forEach((d) => {
    const t = d.data();
    if (ACCOUNT_ADMIN_PROFILES.includes(t.profile) && t.status === "active") {
      admins.push({ email: t.email, profile: t.profile, role: "Organization Admin", isOwner: false, uid: t.uid || null });
    }
  });

  // Each admin/manager is their own Firebase Auth user with their own
  // metadata.lastSignInTime — looked up individually here (only fetched on
  // demand, for one org at a time) rather than in the bulk list below,
  // which uses the same field but batched for every customer at once.
  await Promise.all(
    admins.map(async (a) => {
      if (!a.uid) { a.lastLoginAt = null; return; } // invited but hasn't accepted/signed in yet
      try {
        const u = await adminAuth().getUser(a.uid);
        a.lastLoginAt = u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).toISOString() : null;
      } catch {
        a.lastLoginAt = null;
      }
    })
  );

  return admins;
}

export async function GET(req) {
  try {
    await requirePlatformAdmin(req);

    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      const snap = await adminDb().doc("customers/" + id).get();
      if (!snap.exists) throw { status: 404, message: "Customer not found" };
      const data = snap.data();
      const admins = await loadOrgAdmins(id, data.email);
      return NextResponse.json({ admins });
    }

    const snap = await adminDb().collection("customers").get();

    // Firebase Auth already tracks every user's own last successful
    // sign-in (metadata.lastSignInTime) — reused here instead of a
    // separate write-on-login mechanism. This is the account OWNER's own
    // login only; a manager/team member's last login is a separate person
    // with their own uid, shown in the "View admins" modal instead (see
    // loadOrgAdmins below) rather than fetched for every row here.
    // getUsers() caps out at 100 identifiers per call.
    const lastLoginByUid = new Map();
    const uids = snap.docs.map((d) => d.id);
    for (let i = 0; i < uids.length; i += 100) {
      try {
        const result = await adminAuth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
        result.users.forEach((u) => {
          if (u.metadata.lastSignInTime) lastLoginByUid.set(u.uid, new Date(u.metadata.lastSignInTime).toISOString());
        });
      } catch {
        // Best-effort — a failed chunk just leaves those rows' lastLoginAt null.
      }
    }

    const customers = snap.docs.map((d) => {
      const data = d.data();
      // Prefer the country Vercel's edge saw at signup (accurate for every
      // account, not just ones with a phone number) — falls back to the
      // phone-code guess for accounts created before this was added.
      const country = data.signupCountry || findCountryByPhone(data.phone)?.name || null;
      const appUsage = data.appUsage || {};
      return {
        id: d.id,
        email: data.email || "",
        fullName: data.fullName || null,
        organizationName: data.organizationName || data.companyName || null,
        phone: data.phone || null,
        country,
        region: data.signupRegion || null,
        city: data.signupCity || null,
        status: data.status || "trial",
        customerType: customerType(data),
        planName: data.planName || null,
        createdAt: toIso(data.createdAt),
        trialEndDate: toIso(data.trialEndDate),
        lastLoginAt: lastLoginByUid.get(d.id) || null,
        // { juicechatjunction: "2026-..." , notes: "2026-..." , ... } — every
        // key that's ever had an SSO hand-off minted for it (see
        // appUsage.<key> stamps in app-sso/route.js and shop-sso/route.js).
        // Empty object means this account has never opened any app yet.
        appUsage: Object.fromEntries(Object.entries(appUsage).map(([k, v]) => [k, toIso(v)])),
      };
    });
    customers.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return NextResponse.json({ customers });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const c = await requirePlatformAdmin(req);
    const body = await req.json();

    if (body.action === "extendTrial") {
      const id = String(body.id || "");
      const amount = Number(body.amount);
      const unit = String(body.unit || "");
      if (!id) throw { status: 400, message: "Customer id required" };
      if (!Number.isFinite(amount) || amount <= 0) throw { status: 400, message: "Enter a positive amount" };
      if (!TRIAL_EXTEND_UNITS.includes(unit)) throw { status: 400, message: "Invalid unit" };

      const ref = adminDb().doc("customers/" + id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Customer not found" };
      const data = snap.data();

      const now = new Date();
      const currentEnd = data.trialEndDate?.toDate ? data.trialEndDate.toDate() : null;
      const base = currentEnd && currentEnd > now ? currentEnd : now;

      const newEnd = new Date(base);
      if (unit === "days") newEnd.setDate(newEnd.getDate() + amount);
      else if (unit === "weeks") newEnd.setDate(newEnd.getDate() + amount * 7);
      else if (unit === "months") newEnd.setMonth(newEnd.getMonth() + amount);
      else if (unit === "years") newEnd.setFullYear(newEnd.getFullYear() + amount);

      const update = { trialEndDate: Timestamp.fromDate(newEnd) };
      if (data.status !== "active") update.status = "trial";
      await ref.update(update);

      await logAuditEvent({
        action: "customer.extend_trial", actor: c, targetType: "organization", targetId: id,
        details: { amount, unit, newTrialEndDate: newEnd.toISOString() },
      });

      return NextResponse.json({ ok: true, trialEndDate: newEnd.toISOString() });
    }

    // Sends the same Firebase password-reset email already used for team
    // invites (sendAuthEmail in lib/firebaseAdmin.js) — no new email
    // infrastructure, just a new call site for an existing, already-active
    // account rather than a fresh invite.
    if (body.action === "resetPassword") {
      const id = String(body.id || "");
      if (!id) throw { status: 400, message: "Customer id required" };
      const ref = adminDb().doc("customers/" + id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Customer not found" };
      const email = snap.data().email;
      if (!email) throw { status: 400, message: "This customer has no email on file" };

      const origin = req.headers.get("origin") || new URL(req.url).origin;
      await sendAuthEmail({ requestType: "PASSWORD_RESET", email, continueUrl: `${origin}/sign-in` });

      await logAuditEvent({
        action: "customer.reset_password", actor: c, targetType: "organization", targetId: id, details: { email },
      });

      return NextResponse.json({ ok: true });
    }

    // Sets the account's password directly and hands it back to the
    // Platform Admin, instead of emailing a reset link — for accounts that
    // have no working email on file (e.g. created via
    // /api/admin/organizations "createAccount") or whose owner has called
    // support because they forgot it and can't reach their inbox either.
    if (body.action === "setPassword") {
      const id = String(body.id || "");
      if (!id) throw { status: 400, message: "Customer id required" };
      const ref = adminDb().doc("customers/" + id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Customer not found" };

      const password = String(body.password || "").trim() || generateTempPassword();
      if (password.length < 8) throw { status: 400, message: "Password must be at least 8 characters" };

      await adminAuth().updateUser(id, { password });

      await logAuditEvent({
        action: "customer.set_password", actor: c, targetType: "organization", targetId: id,
        details: { email: snap.data().email },
      });

      return NextResponse.json({ ok: true, password });
    }

    // Records a payment taken outside the online checkout flow (cash, bank
    // transfer, etc.) — sets the same fields the Razorpay/Stripe webhooks
    // set on a real charge (see app/api/webhooks/razorpay/route.js), so this
    // account is indistinguishable from an online payer everywhere else in
    // the app (status, plan gating, the Customers list's Type column).
    if (body.action === "markPaid") {
      const id = String(body.id || "");
      if (!id) throw { status: 400, message: "Customer id required" };
      const planId = String(body.planId || "");
      if (!planId) throw { status: 400, message: "Choose a plan" };

      const ref = adminDb().doc("customers/" + id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Customer not found" };

      const planSnap = await adminDb().doc("plans/" + planId).get();
      if (!planSnap.exists) throw { status: 400, message: "That plan no longer exists" };
      const plan = planSnap.data();

      const notes = String(body.notes || "").trim().slice(0, 300);

      await ref.set(
        {
          status: "active",
          subscriptionGateway: "manual",
          planId,
          planName: plan.name || "",
          paymentCount: FieldValue.increment(1),
          lastChargedAt: FieldValue.serverTimestamp(),
          lastPaymentMethod: "manual",
          lastPaymentNotes: notes || null,
          lastPaymentRecordedBy: c.email,
        },
        { merge: true }
      );

      await logAuditEvent({
        action: "customer.mark_paid", actor: c, targetType: "organization", targetId: id,
        details: { planId, planName: plan.name || "", notes },
      });

      return NextResponse.json({ ok: true });
    }

    if (body.action === "suspend" || body.action === "reactivate") {
      const id = String(body.id || "");
      if (!id) throw { status: 400, message: "Customer id required" };
      const ref = adminDb().doc("customers/" + id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Customer not found" };

      if (body.action === "suspend") {
        await ref.update({
          status: "suspended",
          statusBeforeSuspend: snap.data().status || "trial",
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        const data = snap.data();
        if (data.status !== "suspended") throw { status: 400, message: "This organization isn't suspended" };
        await ref.update({
          status: data.statusBeforeSuspend || "trial",
          statusBeforeSuspend: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      await logAuditEvent({
        action: body.action === "suspend" ? "organization.suspend" : "organization.reactivate",
        actor: c, targetType: "organization", targetId: id, details: { email: snap.data().email },
      });

      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
