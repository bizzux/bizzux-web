import { NextResponse } from "next/server";
import { requirePlatformAdmin, adminDb, sendAuthEmail } from "@/lib/firebaseAdmin";
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
  const admins = [{ email: ownerEmail, profile: "Admin", role: "Organization Owner", isOwner: true }];
  teamSnap.docs.forEach((d) => {
    const t = d.data();
    if (ACCOUNT_ADMIN_PROFILES.includes(t.profile) && t.status === "active") {
      admins.push({ email: t.email, profile: t.profile, role: "Organization Admin", isOwner: false });
    }
  });
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
    const customers = snap.docs.map((d) => {
      const data = d.data();
      const country = findCountryByPhone(data.phone);
      return {
        id: d.id,
        email: data.email || "",
        fullName: data.fullName || null,
        organizationName: data.organizationName || data.companyName || null,
        phone: data.phone || null,
        country: country?.name || null,
        status: data.status || "trial",
        customerType: customerType(data),
        planName: data.planName || null,
        createdAt: toIso(data.createdAt),
        trialEndDate: toIso(data.trialEndDate),
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
