import { NextResponse } from "next/server";
import { requireOrgManager } from "@/lib/firebaseAdmin";
import { getPricingConfig } from "@/lib/pricing";
import { purchasableApps, appUnitPrices, planPrices } from "@/lib/pricingMath";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The old Essential/Business/Premium `plans` collection is retired (docs
// archived, nothing reads them). Pricing lives in pricingPlans/ + appPricing/
// (managed at Global Admin → Billing & Pricing, see /api/admin/pricing).
// This route just lists the current plans for the admin pickers:
//   plans            the published plans (APP, SUITE) in the
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
      price: planPrices(p).month.price,
      annualPrice: planPrices(p).year.price,
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
          name: p.planName, monthly: planPrices(p).month.price, annual: planPrices(p).year.price,
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
