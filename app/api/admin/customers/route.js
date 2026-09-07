import { NextResponse } from "next/server";
import { requireSuperAdmin, adminDb } from "@/lib/firebaseAdmin";
import { findCountryByPhone } from "@/lib/countryCodes";
import { Timestamp } from "firebase-admin/firestore";

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

export async function GET(req) {
  try {
    await requireSuperAdmin(req);
    const snap = await adminDb().collection("customers").get();
    const customers = snap.docs.map((d) => {
      const data = d.data();
      const country = findCountryByPhone(data.phone);
      return {
        id: d.id,
        email: data.email || "",
        fullName: data.fullName || null,
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

// Extends a specific customer's trial by a calendar amount (days/weeks/
// months/years), for giving individual accounts — test accounts, a
// customer asking for more time, etc. — extra runway without going through
// checkout. Extends from whichever is later, the account's *current* trial
// end date or right now: an account whose trial already lapsed gets a
// fresh N-unit window starting today, rather than N units tacked onto a
// date that's already in the past (which would often still be expired).
// Also flips status back to "trial" unless the account is a paying
// ("active") customer, so this can revive an expired/past_due/cancelled
// account without accidentally touching someone who's already on a plan.
export async function POST(req) {
  try {
    await requireSuperAdmin(req);
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

      return NextResponse.json({ ok: true, trialEndDate: newEnd.toISOString() });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
