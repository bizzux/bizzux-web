import { NextResponse } from "next/server";
import { requireSuperAdmin, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Normalizes any billing period to a monthly figure so plans on different
// cycles (day/week/month/year) can be summed into one MRR number.
function monthlyPrice(plan) {
  if (!plan) return 0;
  const price = Number(plan.price) || 0;
  switch (plan.billingPeriod) {
    case "year":
      return price / 12;
    case "week":
      return price * (52 / 12);
    case "day":
      return price * 30;
    default:
      return price; // "month"
  }
}

// Rolling 12-week (84-day) signup trend, bucketed backward from "now" using
// each customer's existing signup timestamp — no new tracking needed, just
// a different grouping of the same createdAt already on every customer
// doc. The most recent bucket covers "the last 7 days" rather than a
// calendar week, so it's always a full, comparable window even mid-week.
function buildSignupTrend(customerDocsData) {
  const WEEKS = 12;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEK_MS = 7 * DAY_MS;
  const now = Date.now();
  const buckets = Array.from({ length: WEEKS }, () => 0);

  customerDocsData.forEach((c) => {
    const created = c.createdAt?.toDate ? c.createdAt.toDate() : null;
    if (!created) return;
    const weeksAgo = Math.floor((now - created.getTime()) / WEEK_MS);
    if (weeksAgo < 0 || weeksAgo >= WEEKS) return; // outside the window (or a clock-skew edge case)
    buckets[WEEKS - 1 - weeksAgo]++;
  });

  return buckets.map((count, i) => {
    const weeksAgo = WEEKS - 1 - i;
    const weekStart = new Date(now - (weeksAgo + 1) * WEEK_MS);
    return { label: weekStart.toLocaleDateString("en-IN", { month: "short", day: "numeric" }), count };
  });
}

// Super Admin only, same gate as the rest of /api/admin/*. Aggregates
// straight from the customers/plans collections already used by
// CustomersManager and PlansManager in SuperAdminPanel.jsx, so the numbers
// here always match what's shown in Admin > Customers/Plans.
export async function GET(req) {
  try {
    await requireSuperAdmin(req);

    const [customersSnap, plansSnap] = await Promise.all([
      adminDb().collection("customers").get(),
      adminDb().collection("plans").get(),
    ]);

    const planById = new Map(plansSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));

    const byStatus = { trial: 0, active: 0, past_due: 0, cancelled: 0 };
    const byPlan = new Map(); // planId -> { planId, name, activeCount, monthlyRevenue }
    let totalCustomers = 0;
    let mrr = 0;

    customersSnap.docs.forEach((d) => {
      const c = d.data();
      totalCustomers++;
      const status = c.status || "trial";
      byStatus[status] = (byStatus[status] || 0) + 1;

      if (status === "active" && c.planId) {
        const plan = planById.get(c.planId);
        const name = c.planName || plan?.name || "Unknown plan";
        const entry = byPlan.get(c.planId) || { planId: c.planId, name, activeCount: 0, monthlyRevenue: 0 };
        const monthly = monthlyPrice(plan);
        entry.activeCount += 1;
        entry.monthlyRevenue += monthly;
        mrr += monthly;
        byPlan.set(c.planId, entry);
      }
    });

    // Trial-to-paid conversion, measured against everyone who has left the
    // trial state (active, past_due or cancelled) rather than against
    // total signups, so people still mid-trial don't dilute the rate.
    const finishedTrial = byStatus.active + byStatus.past_due + byStatus.cancelled;
    const conversionRate = finishedTrial > 0 ? byStatus.active / finishedTrial : null;

    const signupsByWeek = buildSignupTrend(customersSnap.docs.map((d) => d.data()));

    return NextResponse.json({
      totalCustomers,
      byStatus,
      byPlan: Array.from(byPlan.values()).sort((a, b) => b.monthlyRevenue - a.monthlyRevenue),
      mrr: Math.round(mrr),
      conversionRate,
      signupsByWeek,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
