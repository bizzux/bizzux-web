// SERVER ONLY — Razorpay SDK instance for the INR checkout flow (see
// app/api/checkout/route.js, app/api/checkout/verify/route.js and
// app/api/webhooks/razorpay/route.js). Never imported in client components.
import Razorpay from "razorpay";

let instance;

export function razorpay() {
  if (!instance) {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key_id || !key_secret) {
      throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET env vars are not set");
    }
    instance = new Razorpay({ key_id, key_secret });
  }
  return instance;
}
