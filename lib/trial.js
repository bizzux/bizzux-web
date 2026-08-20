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

// Whether this account can open a live app right now.
//   - active subscribers: always.
//   - trial customers: until the trial's last day passes.
//   - past_due / cancelled (a lapsed paid plan) or anything unrecognized: no
//     — they need to pick/renew a plan first, same as an expired trial.
// The account itself stays reachable either way (dashboard, profile, team,
// billing) — this only gates the live app tiles, not the portal.
export function canAccessApps(customer) {
  if (!customer) return false;
  const status = customer.status || "trial";
  if (status === "active") return true;
  if (status === "trial") return !isTrialExpired(customer);
  return false;
}
