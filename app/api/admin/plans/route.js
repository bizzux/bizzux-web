import { NextResponse } from "next/server";
import { requireOrgManager } from "@/lib/firebaseAdmin";
import { getPricingConfig } from "@/lib/pricing";
import { purchasableApps, appUnitPrices } from "@/lib/pricingMath";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DEPRECATED editor. The old Starter/Business/Premium `plans` collection has
// been replaced by the published pricing in pricingPlans/ + appPricing/
// (managed at Global Admin → Billing & Pricing, see /api/admin/pricing).
// The old `plans` docs are left untouched in Firestore so customers already
// on them keep their plan name and revenue history.
//
// GET is kept because several admin pickers still call it:
//   plans            the published plans (APP, SUITE) in the old
//                    {id, name, price, billingPeriod} shape, for Offers.
//   purchaseOptions  every sellable combination (Suite, App · <each app>),
//                    for Mark as paid / Free license.
export async function GET(req) {
  try {
    await requireOrgManager(req);
    const config = await getPricingConfig();
    const plans = config.plans.map((p) => ({
      id: p.planCode,
      name: p.planName,
      price: p.monthlyPricePerUser,
      annualPrice: p.annualPricePerUser,
      billingPeriod: "month",
      active: p.active !== false,
      sortOrder: p.displayOrder,
    }));
    const purchaseOptions = [];
    for (const p of config.plans.filter((x) => x.active !== false)) {
      if (p.planType === "APP") {
        for (const a of purchasableApps(config.apps)) {
          const prices = appUnitPrices(p, a);
          purchaseOptions.push({
            id: `APP:${a.appKey}`, planCode: p.planCode, appKey: a.appKey,
            name: `${p.planName} · ${a.appName}`, monthly: prices.monthly, annual: prices.annual,
          });
        }
      } else {
        purchaseOptions.push({
          id: p.planCode, planCode: p.planCode, appKey: null,
          name: p.planName, monthly: p.monthlyPricePerUser, annual: p.annualPricePerUser,
        });
      }
    }
    return NextResponse.json({ plans, purchaseOptions });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST() {
  return NextResponse.json(
    { error: "Plans are now managed in Global Admin → Billing & Pricing." },
    { status: 410 }
  );
}
