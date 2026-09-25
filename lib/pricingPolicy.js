// Customer-facing price-lock / offer wording, shown on the pricing page next
// to the plans and under each checkout button. Kept in one place so the
// promise is worded identically everywhere. It matches how billing works:
// every subscription stores its own price snapshot at checkout
// (lib/pricing.js), annual plans are a fixed yearly charge, and a published
// price change never touches an existing subscriber.

export const PRICE_LOCK_NOTE =
  "Launch prices are for new subscriptions and may change at any time. Once you subscribe, your price is locked: for the full 12 months on annual plans, and on monthly plans until we give you 30 days' notice of any change.";

export function priceLockShort(billingCycle) {
  return billingCycle === "year"
    ? "Your price is locked for 12 months."
    : "Your price is locked. Any change only after 30 days' notice.";
}
