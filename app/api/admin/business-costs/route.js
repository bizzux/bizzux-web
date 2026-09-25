import { NextResponse } from "next/server";
import { requireSuperAdmin, adminDb } from "@/lib/firebaseAdmin";
import { isPayingCustomer } from "@/lib/trial";
import { snapshotMonthlyValue } from "@/lib/pricingMath";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bizzux's OWN running costs and breakeven math — for the Platform Owner/
// Admins to manage Bizzux as a business, not anything a customer ever sees.
// Deliberately separate from the customer subscription data this same file
// reads for its revenue side, and from portalSettings/config (product
// configuration, not internal finances).
//
// Viewable by any Platform Admin or Owner (so staff can see the same
// reality the Owner is planning against) but only the Owner can edit the
// cost figures themselves — see the POST handler below.
export async function GET(req) {
  try {
    await requireSuperAdmin(req);

    const [costsSnap, customersSnap] = await Promise.all([
      adminDb().doc("platformFinance/costs").get(),
      adminDb().collection("customers").get(),
    ]);

    const costs = costsSnap.exists ? costsSnap.data() : {};
    const recurring = Array.isArray(costs.recurring) ? costs.recurring : [];
    const oneTime = Array.isArray(costs.oneTime) ? costs.oneTime : [];

    let mrr = 0;
    let activeCount = 0;
    customersSnap.docs.forEach((d) => {
      const c = d.data();
      // Free licenses aren't revenue (see lib/trial.js isPayingCustomer).
      if (isPayingCustomer(c)) {
        mrr += snapshotMonthlyValue(c.subscription);
        activeCount += 1;
      }
    });

    const totalMonthlyCost = recurring.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const totalOneTime = oneTime.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const avgRevenuePerCustomer = activeCount > 0 ? mrr / activeCount : 0;
    // Falls back to the assumed figure the Owner types in (see
    // assumedAvgRevenue below) whenever there's no real paying-customer
    // data yet to compute one from — otherwise breakeven math is
    // undefined/zero and useless before the first real customer.
    const effectiveAvgRevenue = avgRevenuePerCustomer > 0 ? avgRevenuePerCustomer : Number(costs.assumedAvgRevenue) || 0;
    const customersToBreakeven = effectiveAvgRevenue > 0 ? Math.ceil(totalMonthlyCost / effectiveAvgRevenue) : null;

    return NextResponse.json({
      recurring,
      oneTime,
      assumedAvgRevenue: Number(costs.assumedAvgRevenue) || 0,
      summary: {
        totalMonthlyCost,
        totalOneTime,
        mrr: Math.round(mrr),
        activeCount,
        avgRevenuePerCustomer: Math.round(avgRevenuePerCustomer),
        effectiveAvgRevenue: Math.round(effectiveAvgRevenue),
        customersToBreakeven,
        customersShortOfBreakeven: customersToBreakeven != null ? Math.max(0, customersToBreakeven - activeCount) : null,
        monthlyProfitOrLoss: Math.round(mrr - totalMonthlyCost),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const c = await requireSuperAdmin(req);
    // Viewing is fine for any Platform Admin (see GET above) — editing the
    // actual cost figures is Owner-only, same tier split as Platform
    // Admins management elsewhere in this panel.
    if (c.platformRole !== "OWNER") {
      throw { status: 403, message: "Only the Platform Owner can edit business costs." };
    }
    const body = await req.json();
    const recurring = Array.isArray(body.recurring)
      ? body.recurring.map((r) => ({ label: String(r.label || "").trim().slice(0, 120), amount: Number(r.amount) || 0 })).filter((r) => r.label)
      : [];
    const oneTime = Array.isArray(body.oneTime)
      ? body.oneTime.map((r) => ({ label: String(r.label || "").trim().slice(0, 120), amount: Number(r.amount) || 0 })).filter((r) => r.label)
      : [];
    const assumedAvgRevenue = Number(body.assumedAvgRevenue) || 0;

    await adminDb().doc("platformFinance/costs").set(
      { recurring, oneTime, assumedAvgRevenue, updatedAt: FieldValue.serverTimestamp(), updatedBy: c.email },
      { merge: true }
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
