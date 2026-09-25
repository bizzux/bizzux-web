// Shared trial / subscription access rules. Framework-agnostic on purpose —
// takes a plain customers/{accountId} doc shape ({ status, trialEndDate })
// so it works unchanged from a client component (dashboard/page.js, off a
// Firestore snapshot) and from a server route (api/shop-sso/route.js, off
// the Admin SDK's equivalent doc). Keeping this logic in one place means
// the UI gate and the server-side enforcement can never quietly drift apart.

// Accepts either a client-SDK or Admin-SDK Firestore Timestamp (both expose
// .toDate()), a JS Date, or an ISO string.
export function daysLeft(trialEndDate) {
  if (!trialEndDate) return null;
  const end = trialEndDate.toDate ? trialEndDate.toDate() : new Date(trialEndDate);
  const ms = end.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function isTrialExpired(customer) {
  if (!customer) return false;
  const status = customer.status || "trial";
  if (status !== "trial") return false;
  const remaining = daysLeft(customer.trialEndDate);
  return remaining !== null && remaining <= 0;
}

// Free licenses: a real plan (so plan limits/features apply) granted by the
// Platform Owner with billing "complimentary", for Bizzux's own business,
// family/testers, partners etc. Never charged, left out of MRR and paying
// counts, and optionally time-limited via compUntil.
export function isComplimentary(customer) {
  return customer?.billing === "complimentary";
}

export function freeLicenseEnded(customer) {
  if (!customer?.compUntil) return false;
  const end = customer.compUntil.toDate ? customer.compUntil.toDate() : new Date(customer.compUntil);
  return end.getTime() < Date.now();
}

// Counts toward revenue: active, on a plan, and actually paying.
export function isPayingCustomer(customer) {
  return (customer?.status || "trial") === "active" && !!customer?.planId && !isComplimentary(customer);
}

// Whether this account can open a live app right now.
//   - active subscribers: always.
//   - trial customers: until the trial's last day passes.
//   - trial_pending (business set up, but the phone-verified free trial
//     hasn't been started yet, see /api/trial/start): no.
//   - past_due / cancelled (a lapsed paid plan) or anything unrecognized: no
//     — they need to pick/renew a plan first, same as an expired trial.
// The account itself stays reachable either way (dashboard, profile, team,
// billing) — this only gates the live app tiles, not the portal.
export function canAccessApps(customer) {
  if (!customer) return false;
  const status = customer.status || "trial";
  // Suspended is unconditional — a Platform Owner/Admin action that must
  // block access regardless of an otherwise-active trial or paid plan, so
  // it's checked before anything else here.
  if (status === "suspended") return false;
  // A free (complimentary) license is "active" but may carry an end date.
  if (status === "active" && isComplimentary(customer) && freeLicenseEnded(customer)) return false;
  if (status === "active") return true;
  if (status === "trial") return !isTrialExpired(customer);
  return false;
}

export function isTrialPending(customer) {
  return customer?.status === "trial_pending";
}

// Whether the account's plan covers one specific app. A Bizzux App
// subscription covers only the app bought (frozen in its snapshot); the
// Suite covers whatever is in the Suite today (suiteAppKeys, from
// lib/pricing.js — pass it when known). Trials, older plan-based
// subscriptions and anything without a snapshot cover every app.
export function planCoversApp(customer, appKey, suiteAppKeys) {
  const sub = customer?.subscription;
  if (!sub || !appKey || customer?.status !== "active") return true;
  if (sub.planType === "APP") return (sub.appKeys || [sub.appKey]).includes(appKey);
  if (sub.planType === "SUITE" && Array.isArray(suiteAppKeys)) return suiteAppKeys.includes(appKey);
  return true;
}

// One place that turns the rules above into the error an SSO hand-off
// returns, with a machine-readable `code` the dashboard reacts to.
export function appAccessDenial(customer, appKey, suiteAppKeys) {
  if (isTrialPending(customer)) {
    return { status: 402, code: "TRIAL_NOT_STARTED", message: "Verify your phone number to start your free trial." };
  }
  if (!canAccessApps(customer)) {
    return { status: 402, code: "LOCKED", message: "Your trial has ended. Choose a plan to keep using Bizzux apps." };
  }
  if (!planCoversApp(customer, appKey, suiteAppKeys)) {
    const name = customer.subscription?.displayName || "Your plan";
    return { status: 402, code: "APP_NOT_IN_PLAN", message: `${name} doesn't include this app. Upgrade to Bizzux Suite or add this app to use it.` };
  }
  return null;
}
