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

// Promotion window. Dates are "YYYY-MM-DD" and read as India time: the offer
// starts at 00:00 on the start date and ends at 23:59:59 on the end date.
export function promotionActive(plan, now = Date.now()) {
  if (!plan?.promotionEnabled) return false;
  if (plan.promotionStartDate && now < new Date(plan.promotionStartDate + "T00:00:00+05:30").getTime()) return false;
  if (plan.promotionEndDate && now > new Date(plan.promotionEndDate + "T23:59:59+05:30").getTime()) return false;
  return true;
}

// One billing cycle's price. `regular` is the normal selling price
// (monthlyPricePerUser / annualPricePerUser). An offer price only counts
// while the promotion is live AND it's genuinely lower than the regular
// price, so a strike-through can never show a fake discount.
function cyclePrice(regular, offer, live) {
  const reg = Number(regular) || 0;
  const hasOffer = live && isPrice(offer) && Number(offer) < reg;
  const price = hasOffer ? Number(offer) : reg;
  return {
    regular: reg,
    price,
    onOffer: hasOffer,
    savings: hasOffer ? reg - price : 0,
    discountPercent: hasOffer && reg > 0 ? Math.round(((reg - price) / reg) * 100) : 0,
  };
}

// Selling prices for a published plan right now, per cycle.
export function planPrices(plan, now = Date.now()) {
  const live = promotionActive(plan, now);
  return {
    month: cyclePrice(plan?.monthlyPricePerUser, plan?.monthlyOfferPrice, live),
    year: cyclePrice(plan?.annualPricePerUser, plan?.annualOfferPrice, live),
    promotionLive: live,
  };
}

// Per-user prices for one app bought on its own: the app's override when
// switched on (a flat price, no promotion), else the Bizzux App plan's
// current selling price (offer price while the promotion is live).
export function appUnitPrices(appPlan, app, now = Date.now()) {
  const base = planPrices(appPlan, now);
  const useOverride = !!app?.overrideEnabled;
  const monthlyOverride = useOverride && isPrice(app.monthlyPriceOverride) ? Number(app.monthlyPriceOverride) : null;
  const annualOverride = useOverride && isPrice(app.annualPriceOverride) ? Number(app.annualPriceOverride) : null;
  const month = monthlyOverride !== null ? cyclePrice(monthlyOverride, null, false) : base.month;
  const year = annualOverride !== null ? cyclePrice(annualOverride, null, false) : base.year;
  return {
    month,
    year,
    monthly: month.price,
    annual: year.price,
    source: monthlyOverride !== null || annualOverride !== null ? "override" : "published",
  };
}

function unitPricesFor(plan, app, now) {
  return isAppPlan(plan) && app ? appUnitPrices(plan, app, now) : planPrices(plan, now);
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
export function computeQuote(config, { planCode, appKey, billingCycle, quantity, now = Date.now() }) {
  const plans = config?.plans || [];
  const apps = config?.apps || [];
  const plan = plans.find((p) => p.planCode === planCode);
  if (!plan || plan.active === false) return { ok: false, error: "That plan isn't available right now." };
  if (!BILLING_CYCLES.includes(billingCycle)) return { ok: false, error: "Choose monthly or annual billing." };
  if (!cycleEnabled(plan, billingCycle)) {
    return { ok: false, error: `${billingCycle === "year" ? "Annual" : "Monthly"} billing isn't offered for ${plan.planName} right now.` };
  }
  const qty = clampQuantity(quantity, config?.settings?.maxUsersPerCheckout);

  let app = null;
  let appKeys;
  if (isAppPlan(plan)) {
    app = apps.find((a) => a.appKey === appKey);
    if (!app || app.active === false || !app.individualPurchaseEnabled) {
      return { ok: false, error: "Choose an app to buy." };
    }
    appKeys = [app.appKey];
  } else {
    appKeys = suiteApps(apps).map((a) => a.appKey);
  }
  const prices = unitPricesFor(plan, app, now);
  const cp = billingCycle === "year" ? prices.year : prices.month;
  const unitPrice = cp.price;
  const priceSource = prices.source || "published";
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
    regularUnitPrice: cp.regular,
    promotionApplied: cp.onOffer,
    promotionLabel: cp.onOffer ? plan.promotionLabel || "Launch Offer" : null,
    discountPercent: cp.discountPercent,
    priceVersion: Number(plan.priceVersion) || 1,
    priceLockMonths: cp.onOffer && Number(plan.priceLockMonths) > 0 ? Number(plan.priceLockMonths) : null,
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
