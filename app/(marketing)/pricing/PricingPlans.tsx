"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { db, auth } from "@/lib/firebase";
import { CTAButton } from "@/components/Section";
import { IconCheck } from "@/components/Icons";
import {
  appUnitPrices, planPrices, cycleEnabled, purchasableApps, suiteApps, monthlyEquivalent, clampQuantity, formatMoney,
} from "@/lib/pricingMath";
import { TRIAL_POLICY_POINTS, TRIAL_CONTACT_URL, trialHeadline } from "@/lib/trialPolicy";

// Bizzux pricing: two published plans, Bizzux App and Bizzux Suite, priced
// per user. Every number on this page comes from /api/pricing (Firestore,
// edited in Global Admin → Billing & Pricing); this component has no prices
// of its own. Checkout recomputes the price server-side (/api/checkout).

type Plan = {
  planCode: string;
  planName: string;
  planType: "APP" | "SUITE";
  tagline?: string;
  description?: string;
  currency: string;
  monthlyPricePerUser: number;
  annualPricePerUser: number;
  monthlyOfferPrice?: number | null;
  annualOfferPrice?: number | null;
  promotionEnabled?: boolean;
  promotionLabel?: string;
  promotionDescription?: string;
  promotionStartDate?: string | null;
  promotionEndDate?: string | null;
  priceLockMonths?: number | null;
  monthlyBillingEnabled: boolean;
  annualBillingEnabled: boolean;
  discountLabel?: string;
  offerText?: string;
  badge?: string;
  ctaLabel?: string;
};
type App = {
  appKey: string;
  appName: string;
  icon?: string;
  description?: string;
  individualPurchaseEnabled: boolean;
  suiteIncluded: boolean;
  overrideEnabled?: boolean;
  monthlyPriceOverride?: number | null;
  annualPriceOverride?: number | null;
  displayOrder?: number;
};
type Pricing = { plans: Plan[]; apps: App[]; settings: { usdRate: number; maxUsersPerCheckout: number }; trialDays: number };
type Cycle = "month" | "year";
type CyclePrice = { regular: number; price: number; onOffer: boolean; savings: number; discountPercent: number };
type UnitPrices = { month: CyclePrice; year: CyclePrice };
type Coupon = { valid: boolean; error?: string; discountedUnitPrice?: number; discountedTotal?: number };

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

export default function PricingPlans() {
  const router = useRouter();
  const [pricing, setPricing] = useState<Pricing | null | "error">(null);
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");
  const [cycle, setCycle] = useState<Cycle>("month");
  const [users, setUsers] = useState(1);
  const [appKey, setAppKey] = useState("");
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [customer, setCustomer] = useState<any>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [coupons, setCoupons] = useState<Record<string, Coupon> | null>(null);
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), []);

  useEffect(() => {
    fetch("/api/pricing")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Pricing) => {
        setPricing(d);
        const planList = d.plans || [];
        // Default to whichever cycle is actually on offer.
        if (planList.length && planList.every((p) => !p.monthlyBillingEnabled)) setCycle("year");
      })
      .catch(() => setPricing("error"));
  }, []);

  // A Partner's share link points here as /pricing?ref=CODE.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) setCouponInput(ref.toUpperCase());
  }, []);

  useEffect(() => {
    if (!user) { setCustomer(null); return; }
    (async () => {
      try {
        const token = await user.getIdToken();
        const me = await (await fetch("/api/me", { headers: { Authorization: "Bearer " + token } })).json();
        const snap = await getDoc(doc(db, "customers", me.accountId || user.uid));
        setCustomer(snap.exists() ? snap.data() : {});
      } catch {
        setCustomer({});
      }
    })();
  }, [user]);

  // Codes apply to monthly billing only, and to a specific basket.
  useEffect(() => {
    setCoupons(null);
    setCouponCode(null);
    setCouponMsg(null);
  }, [cycle, users, appKey]);

  const data = pricing && pricing !== "error" ? pricing : null;
  const plans = useMemo(() => (data?.plans || []).filter((p) => cycleEnabled(p, "month") || cycleEnabled(p, "year")), [data]);
  const buyableApps = useMemo(() => purchasableApps(data?.apps || []) as App[], [data]);
  const inSuite = useMemo(() => suiteApps(data?.apps || []) as App[], [data]);
  const usdRate = data?.settings.usdRate || 0;
  const maxUsers = data?.settings.maxUsersPerCheckout || 500;
  const money = (n: number) => formatMoney(n, currency, { usdRate });
  const annualLabel = plans.find((p) => p.annualBillingEnabled && p.discountLabel)?.discountLabel;
  const anyMonthly = plans.some((p) => p.monthlyBillingEnabled);
  const anyAnnual = plans.some((p) => p.annualBillingEnabled);
  const selectedApp = buyableApps.find((a) => a.appKey === appKey) || null;

  const status = customer?.status || null;
  const trialEnded = status === "trial" && customer?.trialEndDate &&
    (customer.trialEndDate.toDate ? customer.trialEndDate.toDate() : new Date(customer.trialEndDate)).getTime() <= Date.now();
  const currentSub = status === "active" ? customer?.subscription || null : null;

  // Current selling prices (offer price while a promotion is live). Before
  // an app is picked, the App card shows the default Bizzux App price.
  function unitPricesFor(p: Plan): UnitPrices {
    if (p.planType === "APP" && selectedApp) return appUnitPrices(p, selectedApp) as UnitPrices;
    return planPrices(p) as UnitPrices;
  }
  const appPlan = plans.find((p) => p.planType === "APP");

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    if (!user) { setCouponMsg("Sign in first, then apply your code."); return; }
    setCouponChecking(true);
    setCouponMsg(null);
    try {
      const token = await user.getIdToken();
      const results: Record<string, Coupon> = {};
      let anyValid = false;
      let firstError = "That code isn't valid.";
      for (const p of plans) {
        if (p.planType === "APP" && !selectedApp) continue;
        const r = await fetch("/api/pricing/quote", {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ planCode: p.planCode, appKey: selectedApp?.appKey, billingCycle: cycle, quantity: users, couponCode: code }),
        });
        const d = await r.json();
        const c: Coupon = d.coupon || { valid: false, error: d.error };
        results[p.planCode] = c;
        if (c.valid) anyValid = true;
        else if (c.error) firstError = c.error;
      }
      setCoupons(results);
      setCouponCode(anyValid ? code.toUpperCase() : null);
      setCouponMsg(anyValid ? null : plans.some((p) => p.planType === "APP") && !selectedApp && !Object.keys(results).length ? "Pick an app first, then apply your code." : firstError);
    } catch {
      setCouponMsg("Couldn't check that code right now. Please try again.");
    }
    setCouponChecking(false);
  }

  async function choose(p: Plan, billingCycle: Cycle) {
    if (p.planType === "APP" && !selectedApp) {
      setCheckoutError(null);
      document.getElementById("app-picker")?.focus();
      setCheckoutError("Choose which app you want first.");
      return;
    }
    if (!user) {
      router.push("/sign-in?mode=signup");
      return;
    }
    setCheckoutError(null);
    setPicking(p.planCode);
    const gateway = currency === "INR" ? "razorpay" : "stripe";
    try {
      const token = await user.getIdToken();
      const useCoupon = billingCycle === "month" && couponCode && coupons?.[p.planCode]?.valid;
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          planCode: p.planCode, appKey: selectedApp?.appKey, billingCycle, quantity: users, gateway,
          couponCode: useCoupon ? couponCode : undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't start checkout. Please try again.");
      if (d.gateway === "stripe") {
        window.location.href = d.url;
        return;
      }
      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay) throw new Error("Couldn't load Razorpay checkout. Please check your connection and try again.");
      const rzp = new window.Razorpay({
        key: d.keyId,
        subscription_id: d.subscriptionId,
        name: "Bizzux",
        description: `${d.planName} · ${users} user${users === 1 ? "" : "s"}`,
        theme: { color: "#12a695" },
        handler: async (response: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => {
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
        modal: { ondismiss: () => setPicking(null) },
      });
      rzp.on("payment.failed", () => {
        setCheckoutError("Payment failed. Please try again or use a different card.");
        setPicking(null);
      });
      rzp.open();
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : "Couldn't start checkout. Please try again.");
      setPicking(null);
    }
  }

  if (pricing === null) return <p className="text-center text-slate-400">Loading pricing…</p>;
  if (pricing === "error" || plans.length === 0) {
    return (
      <p className="text-center text-slate-400">
        We&apos;re updating our pricing. <a href="/contact" className="text-brand-blue font-semibold hover:underline">Contact us</a> in the meantime.
      </p>
    );
  }

  const toggleBtn = (active: boolean) =>
    `px-5 py-2 rounded-full text-sm font-semibold transition-colors ${active ? "bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white" : "text-slate-600 hover:text-ink"}`;

  return (
    <div>
      {trialEnded && (
        <div className="max-w-3xl mx-auto mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-center">
          <p className="text-red-700 font-semibold text-sm">
            Your free trial has ended. Choose a plan below to keep using Bizzux. Still evaluating?{" "}
            <a href={TRIAL_CONTACT_URL} className="underline">Contact us</a> about an extension.
          </p>
        </div>
      )}

      {/* Controls: billing cycle, currency, users */}
      <div className="flex flex-wrap justify-center items-center gap-3 mb-4">
        {anyMonthly && anyAnnual && (
          <div className="inline-flex rounded-full border border-slate-200 p-1 bg-white" role="group" aria-label="Billing cycle">
            <button onClick={() => setCycle("month")} className={toggleBtn(cycle === "month")} aria-pressed={cycle === "month"}>Monthly</button>
            <button onClick={() => setCycle("year")} className={toggleBtn(cycle === "year")} aria-pressed={cycle === "year"}>
              Annual{annualLabel ? <span className={cycle === "year" ? "text-white/90" : "text-brand-teal"}> — {annualLabel}</span> : null}
            </button>
          </div>
        )}
        <div className="inline-flex rounded-full border border-slate-200 p-1 bg-white" role="group" aria-label="Currency">
          {(["INR", "USD"] as const).map((c) => (
            <button key={c} onClick={() => setCurrency(c)} className={toggleBtn(currency === c)} aria-pressed={currency === c}>{c}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap justify-center items-center gap-3 mb-8">
        <span className="text-sm font-semibold text-ink">Number of users</span>
        <div className="inline-flex items-center rounded-full border border-slate-200 bg-white">
          <button type="button" aria-label="Fewer users" className="w-10 h-10 text-lg text-slate-600 disabled:opacity-40" disabled={users <= 1} onClick={() => setUsers((u) => clampQuantity(u - 1, maxUsers))}>−</button>
          <input
            type="number" min={1} max={maxUsers} value={users} aria-label="Number of users"
            onChange={(e) => setUsers(clampQuantity(e.target.value, maxUsers))}
            className="w-14 text-center text-sm font-semibold bg-transparent focus:outline-none [appearance:textfield]"
          />
          <button type="button" aria-label="More users" className="w-10 h-10 text-lg text-slate-600 disabled:opacity-40" disabled={users >= maxUsers} onClick={() => setUsers((u) => clampQuantity(u + 1, maxUsers))}>+</button>
        </div>
      </div>

      <div className={`grid gap-6 items-stretch max-w-4xl mx-auto ${plans.length > 1 ? "md:grid-cols-2" : ""}`}>
        {plans.map((p) => {
          const prices = unitPricesFor(p);
          const offered: Cycle = cycleEnabled(p, cycle) ? cycle : cycle === "year" ? "month" : "year";
          const cp = offered === "year" ? prices.year : prices.month;
          const unit = cp.price;
          const otherCycle: Cycle = offered === "year" ? "month" : "year";
          const showOther = cycleEnabled(p, otherCycle);
          const coupon = offered === "month" ? coupons?.[p.planCode] : undefined;
          const chargeUnit = coupon?.valid && coupon.discountedUnitPrice !== undefined ? coupon.discountedUnitPrice : unit;
          const per = offered === "year" ? "year" : "month";
          const highlight = !!p.badge;
          const isCurrent = currentSub && currentSub.planCode === p.planCode && (p.planType !== "APP" || currentSub.appKey === selectedApp?.appKey);
          return (
            <div
              key={p.planCode}
              className={`rounded-2xl p-7 border relative flex flex-col bg-white ${highlight ? "border-2 border-brand-blue shadow-xl md:scale-[1.03]" : "border-slate-200 shadow-sm"}`}
            >
              {p.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white text-xs font-bold tracking-wide px-4 py-1">
                  {p.badge}
                </div>
              )}
              <h3 className="font-bold text-xl mb-1">{p.planName}</h3>
              {p.tagline && <p className="text-sm font-semibold text-brand-teal mb-4">{p.tagline}</p>}

              {/* Same strike-through look the old plan cards used: orange
                  crossed-out regular price, gradient offer pill, orange savings.
                  Only shown while a real promotion is live (lib/pricingMath.js). */}
              <div className="mb-1 flex items-baseline gap-2 flex-wrap">
                {(coupon?.valid || cp.onOffer) && (
                  <span className="text-xl font-bold text-[#FF4D00] line-through decoration-2">{money(coupon?.valid ? unit : cp.regular)}</span>
                )}
                <span className="text-4xl font-extrabold">{money(chargeUnit)}</span>
                <span className="text-slate-500 text-sm">/ user / {per}</span>
              </div>
              {cp.onOffer && !coupon?.valid && (
                <div className="flex items-center gap-2 mt-1.5 mb-2 flex-wrap">
                  <span className="inline-block rounded-full bg-brand-gradient text-white text-[11px] font-bold px-3 py-1 tracking-wide uppercase">
                    🔥 {cp.discountPercent}% {p.promotionLabel || "Launch Offer"}
                  </span>
                  <span className="text-xs font-semibold text-[#FF4D00]">Save {money(cp.savings)} per user/{per}</span>
                </div>
              )}
              {cp.onOffer && p.promotionDescription && <p className="text-xs text-slate-500 mb-1">{p.promotionDescription}</p>}
              {cp.onOffer && p.priceLockMonths ? (
                <p className="text-xs text-slate-500 mb-1">Offer price locked for your first {p.priceLockMonths} months.</p>
              ) : null}
              {offered === "year" ? (
                <p className="text-sm text-slate-600 mb-1">
                  Equivalent to <strong>{money(monthlyEquivalent(unit))}</strong>/user/month
                </p>
              ) : showOther ? (
                <p className="text-sm text-slate-500 mb-1">or {money(prices.year.price)} / user / year</p>
              ) : null}
              {(p.discountLabel || p.offerText) && p.annualBillingEnabled && (
                <p className="text-xs font-semibold text-brand-teal mb-4">
                  {[p.discountLabel, p.offerText].filter(Boolean).join(" · ")}{offered === "month" ? " on annual billing" : ""}
                </p>
              )}
              {coupon?.valid && <p className="text-xs font-semibold text-brand-teal mb-2">Promo code {couponCode} applied</p>}

              {p.description && <p className="text-sm text-slate-600 mb-3">{p.description}</p>}
              {p.planType === "SUITE" && appPlan && (() => {
                const appUnit = (planPrices(appPlan) as UnitPrices)[offered].price;
                const diff = unit - appUnit;
                return diff > 0 && cycleEnabled(appPlan, offered) ? (
                  <p className="text-sm font-semibold text-ink mb-4">
                    Get the complete Bizzux Suite for only {money(diff)} more than a single app.
                  </p>
                ) : null;
              })()}

              {p.planType === "APP" ? (
                <div className="mb-5">
                  <label htmlFor="app-picker" className="block text-xs font-semibold text-slate-500 mb-1">Your app</label>
                  <select
                    id="app-picker" value={appKey} onChange={(e) => { setAppKey(e.target.value); setCheckoutError(null); }}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-brand-blue"
                  >
                    <option value="">Select an app…</option>
                    {buyableApps.map((a) => {
                      const ap = appUnitPrices(p, a);
                      const base = planPrices(p) as UnitPrices;
                      const differs = ap.monthly !== base.month.price || ap.annual !== base.year.price;
                      return (
                        <option key={a.appKey} value={a.appKey}>
                          {a.icon ? a.icon + " " : ""}{a.appName}{differs ? ` (${money(offered === "year" ? ap.annual : ap.monthly)}/user/${per})` : ""}
                        </option>
                      );
                    })}
                  </select>
                  {selectedApp?.description && <p className="text-xs text-slate-500 mt-1.5">{selectedApp.description}</p>}
                </div>
              ) : (
                <ul className="grid grid-cols-2 gap-x-3 gap-y-2 mb-5">
                  {inSuite.map((a) => (
                    <li key={a.appKey} className="flex items-start gap-1.5 text-sm text-slate-700">
                      <IconCheck className="w-4 h-4 mt-0.5 text-brand-teal shrink-0" />
                      <span>{a.appName.replace(/^Bizzux /, "")}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-auto">
                <div className="rounded-xl bg-slate-50 px-4 py-3 mb-4 text-sm flex justify-between gap-2">
                  <span className="text-slate-600">{users} user{users === 1 ? "" : "s"} × {money(chargeUnit)}</span>
                  <span className="font-bold text-ink">{money(chargeUnit * users)}/{per}</span>
                </div>
                {isCurrent ? (
                  <div className="w-full h-11 flex items-center justify-center gap-2 rounded-full text-sm font-semibold bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white" aria-current="true">
                    <IconCheck className="w-4 h-4" /> Your current plan
                  </div>
                ) : (
                  <button
                    onClick={() => { if (offered !== cycle) setCycle(offered); choose(p, offered); }}
                    disabled={picking === p.planCode}
                    className={`w-full h-11 rounded-full text-sm font-semibold px-5 transition-opacity disabled:opacity-60 ${
                      highlight ? "bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white hover:opacity-90" : "border border-slate-300 text-ink hover:bg-slate-50"
                    }`}
                  >
                    {picking === p.planCode ? "Starting checkout…" : p.ctaLabel || `Get ${p.planName}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {checkoutError && <p className="text-center text-sm text-red-600 mt-6">{checkoutError}</p>}

      {/* Promo / partner codes: monthly billing only */}
      <div className="flex flex-col items-center gap-2 mt-8">
        {cycle === "year" ? (
          <p className="text-xs text-slate-400">Promo codes apply to monthly billing only.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-3 w-full max-w-md">
            <input
              type="text" value={couponInput} onChange={(e) => setCouponInput(e.target.value)} placeholder="Have a promo code?"
              className="flex-1 min-w-[180px] rounded-full border border-slate-200 px-5 py-2.5 text-sm focus:outline-none focus:border-brand-blue"
            />
            <button
              onClick={applyCoupon} disabled={couponChecking || !couponInput.trim()}
              className="h-10 rounded-full border border-slate-200 px-6 text-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-60"
            >
              {couponChecking ? "Checking…" : "Apply"}
            </button>
          </div>
        )}
        {couponMsg && <p className="text-xs text-red-600">{couponMsg}</p>}
      </div>

      {currency === "USD" && (
        <p className="text-center text-xs text-slate-400 mt-6">
          USD prices are estimates converted from INR and may change with exchange rates. Customers in India are charged in INR.
        </p>
      )}

      <div className="max-w-2xl mx-auto mt-12 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold mb-1">{trialHeadline(data?.trialDays)}, no card needed</h2>
        <p className="text-sm text-slate-600 mb-3">Sign up, set up your business, verify your mobile number, and every app unlocks.</p>
        <ul className="list-disc ml-5 space-y-1.5 text-sm text-slate-600">
          {TRIAL_POLICY_POINTS.map((t) => <li key={t}>{t}</li>)}
        </ul>
        <p className="text-sm mt-3">
          <a href={TRIAL_CONTACT_URL} className="text-brand-blue font-semibold hover:underline">Request a trial extension →</a>
        </p>
      </div>

      <p className="text-center text-sm text-slate-500 mt-8">
        Prefer to talk it through first? <CTAButton href="/contact" variant="secondary">Request a demo</CTAButton>
      </p>
    </div>
  );
}
