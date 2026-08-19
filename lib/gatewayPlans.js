// SERVER ONLY — shared helpers for creating recurring Razorpay Plans and
// Stripe Prices from a {name, price, billingPeriod} shape. Used by both
// app/api/admin/plans/route.js (regular plans) and app/api/checkout/route.js
// (discounted plans created on the fly when a valid offer code is redeemed
// — see app/api/admin/offers/route.js). Centralized here so both call
// sites stay in sync instead of drifting.
import { razorpay } from "@/lib/razorpay";
import { stripe } from "@/lib/stripe";

export function razorpayPeriod(billingPeriod) {
  const p = (billingPeriod || "month").toLowerCase();
  if (p.startsWith("year")) return "yearly";
  if (p.startsWith("week")) return "weekly";
  if (p.startsWith("day")) return "daily";
  return "monthly";
}
export function stripeInterval(billingPeriod) {
  const p = (billingPeriod || "month").toLowerCase();
  if (p.startsWith("year")) return "year";
  if (p.startsWith("week")) return "week";
  if (p.startsWith("day")) return "day";
  return "month";
}

// Rough INR -> USD conversion for the Stripe (USD) side — same estimated
// rate the pricing page shows customers (PricingPlans.tsx's USD_RATE).
export const USD_RATE = 83;

export async function createRazorpayPlan({ name, price, billingPeriod }) {
  try {
    const plan = await razorpay().plans.create({
      period: razorpayPeriod(billingPeriod),
      interval: 1,
      item: {
        name: `Bizzux ${name}`,
        amount: Math.round(Number(price) * 100), // paise
        currency: "INR",
      },
    });
    return plan.id;
  } catch (e) {
    console.error("Auto-create Razorpay plan failed:", e?.message || e);
    return null;
  }
}

export async function createStripePrice({ name, price, billingPeriod }) {
  try {
    const unitAmount = Math.round((Number(price) / USD_RATE) * 100); // USD cents
    const p = await stripe().prices.create({
      currency: "usd",
      unit_amount: unitAmount,
      recurring: { interval: stripeInterval(billingPeriod) },
      product_data: { name: `Bizzux ${name}` },
    });
    return p.id;
  } catch (e) {
    console.error("Auto-create Stripe price failed:", e?.message || e);
    return null;
  }
}

// Applies an offer's discount to a base INR price. Flat discounts never
// take the price below 0. Rounded to the nearest rupee — Razorpay/Stripe
// amounts are integer paise/cents anyway, so sub-rupee precision here
// wouldn't survive the round-trip.
export function computeDiscountedPrice(price, discountType, discountValue) {
  const base = Number(price);
  const value = Number(discountValue);
  if (discountType === "percent") {
    return Math.max(0, Math.round(base * (1 - value / 100)));
  }
  return Math.max(0, Math.round(base - value));
}
