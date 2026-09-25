// SERVER ONLY — one-time-purchase desktop app licenses (Bizzux Screen
// Recorder and any future paid desktop tool sold directly off bizzux.com,
// as opposed to the recurring SaaS subscriptions in lib/pricing.js). Kept
// deliberately separate from customers/{uid}: buyers here don't need a
// Bizzux account, just an email address to receive the key at.
import { randomInt } from "crypto";

// priceInPaise is what Razorpay's Orders API expects (INR, no decimals).
export const PRODUCTS = {
  "screen-recorder": {
    name: "Bizzux Screen Recorder",
    priceInPaise: 99900, // ₹999
  },
};

const KEY_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I, easier to type from an email

function randomSegment(len) {
  let out = "";
  for (let i = 0; i < len; i++) out += KEY_CHARS[randomInt(KEY_CHARS.length)];
  return out;
}

// Format: BSR-XXXX-XXXX-XXXX-XXXX (BSR = Bizzux Screen Recorder prefix,
// distinct per product so keys are visually identifiable at a glance).
export function generateLicenseKey(prefix = "BSR") {
  return `${prefix}-${randomSegment(4)}-${randomSegment(4)}-${randomSegment(4)}-${randomSegment(4)}`;
}

export function licensesCollection(adminDb) {
  return adminDb().collection("licenses");
}
