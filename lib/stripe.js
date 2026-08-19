// SERVER ONLY — Stripe SDK instance for the USD checkout flow (see
// app/api/checkout/route.js and app/api/webhooks/stripe/route.js). Never
// imported in client components.
import Stripe from "stripe";

let instance;

export function stripe() {
  if (!instance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY env var is not set");
    }
    instance = new Stripe(key, { apiVersion: "2024-06-20" });
  }
  return instance;
}
