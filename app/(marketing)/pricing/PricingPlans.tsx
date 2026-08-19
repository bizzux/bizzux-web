"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { db, auth } from "@/lib/firebase";
import { CTAButton } from "@/components/Section";
import { IconCheck } from "@/components/Icons";

const USD_RATE = 83; // approximate INR -> USD conversion rate; estimated only

type Plan = {
  id: string;
  name: string;
  price: number;
  billingPeriod?: string;
  description?: string;
  features?: string[];
  popular?: boolean;
  active?: boolean;
  sortOrder?: number;
  razorpayPlanId?: string;
  stripePriceId?: string;
};

declare global {
  interface Window {
    Razorpay?: any;
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function formatPrice(priceINR: number, currency: "INR" | "USD") {
  if (currency === "INR") return `₹${priceINR.toLocaleString("en-IN")}`;
  const usd = priceINR / USD_RATE;
  return `$${usd.toFixed(usd < 10 ? 2 : 0)}`;
}

// Live version of this page's plan grid — pulls the same `plans` Firestore
// collection apps.bizzux.com's Super Admin panel manages (see
// components/SuperAdminPanel.jsx), so pricing shown here always matches
// what's configured there instead of being hand-maintained twice.
type CouponResult = { valid: boolean; discountedPrice?: number; error?: string };

export default function PricingPlans() {
  const router = useRouter();
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");
  const [plans, setPlans] = useState<Plan[] | null>(null); // null = loading
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [couponCode, setCouponCode] = useState<string | null>(null); // the code actually applied
  const [couponResults, setCouponResults] = useState<Record<string, CouponResult> | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "plans"), orderBy("sortOrder", "asc")));
        setPlans(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Plan, "id">) }))
            .filter((p) => p.active !== false)
        );
      } catch {
        setPlans([]);
      }
    })();
  }, []);

  // Checks a promo code against every visible plan at once (there are only
  // ever a handful) since a code is scoped to one specific plan — see
  // app/api/admin/offers/route.js — but this page doesn't know in advance
  // which plan the person will pick. Whichever plan(s) it's valid for get
  // a discounted-price preview on their card; checkout re-validates the
  // code from scratch server-side regardless, so this preview is purely UX.
  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code || !plans) return;
    if (!user) {
      setCouponMsg("Sign in first, then apply your code.");
      return;
    }
    setCouponChecking(true);
    setCouponMsg(null);
    try {
      const token = await user.getIdToken();
      const results = await Promise.all(
        plans.map(async (p) => {
          const res = await fetch("/api/offers/validate", {
            method: "POST",
            headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
            body: JSON.stringify({ code, planId: p.id }),
          });
          const data = await res.json();
          return [p.id, data] as const;
        })
      );
      const map: Record<string, CouponResult> = {};
      let anyValid = false;
      let firstError = "That code isn't valid.";
      for (const [planId, data] of results) {
        map[planId] = data;
        if (data.valid) anyValid = true;
        else if (data.error) firstError = data.error;
      }
      setCouponResults(map);
      setCouponCode(anyValid ? code.toUpperCase() : null);
      setCouponMsg(anyValid ? null : firstError);
    } catch {
      setCouponMsg("Couldn't check that code right now. Please try again.");
    }
    setCouponChecking(false);
  }

  // Starts a real recurring-subscription checkout: INR plans go through
  // Razorpay Checkout.js (opened inline, right here), USD plans redirect to
  // a hosted Stripe Checkout page. Both hit the same /api/checkout route,
  // which picks the gateway based on the `gateway` param below. See
  // app/api/checkout/route.js for the server side of this.
  async function choosePlan(planId: string) {
    if (!user) {
      router.push("/sign-in?mode=signup");
      return;
    }
    setCheckoutError(null);
    setPickingId(planId);
    const gateway = currency === "INR" ? "razorpay" : "stripe";
    try {
      const token = await user.getIdToken();
      const appliesHere = couponCode && couponResults?.[planId]?.valid;
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ planId, gateway, couponCode: appliesHere ? couponCode : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't start checkout. Please try again.");

      if (data.gateway === "stripe") {
        window.location.href = data.url;
        return;
      }

      // Razorpay: open Checkout.js inline instead of redirecting away.
      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay) {
        throw new Error("Couldn't load Razorpay checkout. Please check your connection and try again.");
      }

      const rzp = new window.Razorpay({
        key: data.keyId,
        subscription_id: data.subscriptionId,
        name: "Bizzux",
        description: data.planName ? `${data.planName} plan subscription` : "Subscription",
        theme: { color: "#0f766e" },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_subscription_id: string;
          razorpay_signature: string;
        }) => {
          try {
            await fetch("/api/checkout/verify", {
              method: "POST",
              headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
              body: JSON.stringify(response),
            });
          } finally {
            router.push("/dashboard?checkout=success");
          }
        },
        modal: {
          ondismiss: () => setPickingId(null),
        },
      });
      rzp.on("payment.failed", () => {
        setCheckoutError("Payment failed. Please try again or use a different card.");
        setPickingId(null);
      });
      rzp.open();
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : "Couldn't start checkout. Please try again.");
      setPickingId(null);
    }
  }

  if (plans === null) {
    return <p className="text-center text-slate-400">Loading plans…</p>;
  }

  if (plans.length === 0) {
    return (
      <p className="text-center text-slate-400">
        We&apos;re putting the finishing touches on pricing. <a href="/contact" className="text-brand-blue font-semibold hover:underline">Contact us</a> in the meantime.
      </p>
    );
  }

  return (
    <div>
      <div className="flex justify-center mb-8">
        <div className="inline-flex rounded-full border border-slate-200 p-1 bg-white">
          {(["INR", "USD"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={`px-5 py-2 rounded-full text-sm font-semibold transition-colors ${
                currency === c ? "bg-gradient-to-r from-brand-teal to-brand-blue text-white" : "text-slate-600 hover:text-ink"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center gap-2 mb-8">
        <div className="flex gap-2 w-full max-w-xs">
          <input
            type="text"
            value={couponInput}
            onChange={(e) => setCouponInput(e.target.value)}
            placeholder="Have a promo code?"
            className="flex-1 rounded-full border border-slate-200 px-4 py-2 text-sm focus:outline-none focus:border-brand-blue"
          />
          <button
            onClick={applyCoupon}
            disabled={couponChecking || !couponInput.trim()}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
          >
            {couponChecking ? "Checking…" : "Apply"}
          </button>
        </div>
        {couponCode && !couponMsg && (
          <p className="text-xs text-brand-teal font-semibold">Code "{couponCode}" applied — discount shown below.</p>
        )}
        {couponMsg && <p className="text-xs text-red-600">{couponMsg}</p>}
      </div>

      <div className="grid md:grid-cols-3 gap-6 items-start">
        {plans.map((p) => (
          <div
            key={p.id}
            className={`rounded-2xl p-8 border relative ${
              p.popular ? "border-brand-blue shadow-lg scale-[1.02] bg-white" : "border-slate-100 bg-white shadow-sm"
            }`}
          >
            {p.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-teal to-brand-blue text-white text-xs font-semibold px-4 py-1">
                Most popular
              </div>
            )}
            <h3 className="font-semibold text-lg mb-1">{p.name}</h3>
            {couponResults?.[p.id]?.valid ? (
              <div className="mb-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-lg text-slate-400 line-through">{formatPrice(p.price, currency)}</span>
                  <span className="text-3xl font-extrabold text-brand-teal">
                    {formatPrice(couponResults[p.id].discountedPrice ?? p.price, currency)}
                  </span>
                  <span className="text-slate-500 text-sm">/{p.billingPeriod || "month"}</span>
                </div>
                <span className="inline-block mt-1 text-xs font-semibold text-brand-teal">Promo code applied</span>
              </div>
            ) : (
              <div className="flex items-baseline gap-1 mb-3">
                <span className="text-3xl font-extrabold">{formatPrice(p.price, currency)}</span>
                <span className="text-slate-500 text-sm">/{p.billingPeriod || "month"}</span>
              </div>
            )}
            {p.description && <p className="text-sm text-slate-600 mb-6">{p.description}</p>}
            {Array.isArray(p.features) && p.features.length > 0 && (
              <ul className="space-y-3 mb-8">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                    <IconCheck className="w-4 h-4 mt-0.5 text-brand-teal shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => choosePlan(p.id)}
              disabled={pickingId === p.id}
              className={`w-full text-center rounded-full text-sm font-semibold px-5 py-3 transition-opacity disabled:opacity-60 ${
                p.popular
                  ? "bg-gradient-to-r from-brand-teal to-brand-blue text-white hover:opacity-90"
                  : "border border-slate-200 text-ink hover:bg-slate-50"
              }`}
            >
              {pickingId === p.id ? "Selecting…" : user ? "Choose this plan" : "Start free trial"}
            </button>
          </div>
        ))}
      </div>

      {checkoutError && (
        <p className="text-center text-sm text-red-600 mt-6">{checkoutError}</p>
      )}

      {currency === "USD" && (
        <p className="text-center text-xs text-slate-400 mt-6">
          USD prices are estimated and may change based on exchange-rate movement. Indian customers are charged in INR by default.
        </p>
      )}

      <p className="text-center text-sm text-slate-500 mt-10">
        Prefer to talk it through first?{" "}
        <CTAButton href="/contact" variant="secondary">Request a demo</CTAButton>
      </p>
    </div>
  );
}
