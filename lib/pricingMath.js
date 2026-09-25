// Pure pricing calculations, shared by the pricing page, checkout, admin
// previews and revenue reports so every screen does the same maths on the
// same Firestore config (see lib/pricing.js for loading it). No Firebase
// imports: safe on the client and the server.
//
// Prices are always read from the config objects passed in. Annual prices
// are configured separately and never derived from monthly ones; the only
// derived figure is the "equivalent to X/month" line, which is display only.

export const BILLING_CYCLES = ["month", "year"];

export function isAppPlan(plan) {
  return plan?.planType === "APP";
}

// Effective per-user prices for one app bought on its own: the app's
// override when it's switched on (each field independently, so an admin can
// override just the monthly price), else the Bizzux App plan's price.
export function appUnitPrices(appPlan, app) {
  const useOverride = !!app?.overrideEnabled;
  const monthlyOverride = useOverride && isPrice(app.monthlyPriceOverride) ? Number(app.monthlyPriceOverride) : null;
  const annualOverride = useOverride && isPrice(app.annualPriceOverride) ? Number(app.annualPriceOverride) : null;
  return {
    monthly: monthlyOverride ?? (Number(appPlan?.monthlyPricePerUser) || 0),
    annual: annualOverride ?? (Number(appPlan?.annualPricePerUser) || 0),
    source: monthlyOverride !== null || annualOverride !== null ? "override" : "published",
  };
}

export function isPrice(v) {
  return v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0;
}

export function cycleEnabled(plan, billingCycle) {
  return billingCycle === "year" ? plan?.annualBillingEnabled !== false : plan?.monthlyBillingEnabled !== false;
}

export function purchasableApps(apps) {
  return (apps || [])
    .filter((a) => a.active !== false && a.individualPurchaseEnabled)
    .sort(byDisplayOrder);
}

export function suiteApps(apps) {
  return (apps || []).filter((a) => a.active !== false && a.suiteIncluded).sort(byDisplayOrder);
}

export function byDisplayOrder(a, b) {
  return (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0);
}

export function clampQuantity(q, max = 500) {
  const n = Math.floor(Number(q));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, max);
}

// Whole-rupee display figure for "Equivalent to X/user/month" under an
// annual price. Never used as a charge.
export function monthlyEquivalent(annualPrice) {
  return Math.round(Number(annualPrice) / 12);
}

// The single price calculation behind the pricing page, checkout and the
// subscription snapshot. Returns { ok:false, error } for anything that
// can't be sold right now (inactive plan, disabled cycle, app not for sale).
export function computeQuote(config, { planCode, appKey, billingCycle, quantity }) {
  const plans = config?.plans || [];
  const apps = config?.apps || [];
  const plan = plans.find((p) => p.planCode === planCode);
  if (!plan || plan.active === false) return { ok: false, error: "That plan isn't available right now." };
  if (!BILLING_CYCLES.includes(billingCycle)) return { ok: false, error: "Choose monthly or annual billing." };
  if (!cycleEnabled(plan, billingCycle)) {
    return { ok: false, error: `${billingCycle === "year" ? "Annual" : "Monthly"} billing isn't offered for ${plan.planName} right now.` };
  }
  const qty = clampQuantity(quantity, config?.settings?.maxUsersPerCheckout);

  let unitPrice;
  let priceSource = "published";
  let app = null;
  let appKeys;
  if (isAppPlan(plan)) {
    app = apps.find((a) => a.appKey === appKey);
    if (!app || app.active === false || !app.individualPurchaseEnabled) {
      return { ok: false, error: "Choose an app to buy." };
    }
    const prices = appUnitPrices(plan, app);
    unitPrice = billingCycle === "year" ? prices.annual : prices.monthly;
    priceSource = prices.source;
    appKeys = [app.appKey];
  } else {
    unitPrice = Number(billingCycle === "year" ? plan.annualPricePerUser : plan.monthlyPricePerUser);
    appKeys = suiteApps(apps).map((a) => a.appKey);
  }
  if (!isPrice(unitPrice) || unitPrice <= 0) return { ok: false, error: "This plan doesn't have a price set yet." };

  return {
    ok: true,
    planCode: plan.planCode,
    planType: plan.planType,
    planName: plan.planName,
    appKey: app?.appKey || null,
    appName: app?.appName || null,
    appKeys,
    displayName: app ? `${plan.planName} · ${app.appName}` : plan.planName,
    billingCycle,
    quantity: qty,
    currency: plan.currency || "INR",
    unitPrice: Number(unitPrice),
    total: Number(unitPrice) * qty,
    priceSource,
  };
}

// Offer/partner code discount on one unit price. Flat discounts never go
// below 0; rounded to the rupee since gateways charge whole paise anyway.
export function applyDiscount(price, discountType, discountValue) {
  const base = Number(price);
  const value = Number(discountValue) || 0;
  if (discountType === "percent") return Math.max(0, Math.round(base * (1 - value / 100)));
  return Math.max(0, Math.round(base - value));
}

// Monthly revenue this subscription snapshot represents (for MRR), from what
// the customer actually agreed to pay, never from today's published price.
export function snapshotMonthlyValue(snapshot) {
  if (!snapshot) return 0;
  const total = Number(snapshot.totalPrice ?? Number(snapshot.unitPrice) * (Number(snapshot.quantity) || 1)) || 0;
  return snapshot.billingCycle === "year" ? total / 12 : total;
}

export function formatMoney(amount, currency = "INR", { usdRate } = {}) {
  const n = Number(amount) || 0;
  if (currency === "USD") {
    const usd = usdRate ? n / usdRate : n;
    return "$" + usd.toLocaleString("en-US", { minimumFractionDigits: usd < 10 ? 2 : 0, maximumFractionDigits: usd < 10 ? 2 : 0 });
  }
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
