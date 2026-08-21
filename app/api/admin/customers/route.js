import { NextResponse } from "next/server";
import { requireSuperAdmin, adminDb } from "@/lib/firebaseAdmin";
import { findCountryByPhone } from "@/lib/countryCodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
