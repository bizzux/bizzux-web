// Derives separate, display-level dimensions from the fields that already
// exist, WITHOUT changing what is stored. customers.status stays the single
// field every access gate reads (lib/trial.js); this is a read-only view that
// pulls it apart so the UI can show plan, payment, trial, onboarding and
// account state independently. Pure and framework-free (client/server safe).

const ms = (t) => (t?.toMillis ? t.toMillis() : t?.toDate ? t.toDate().getTime() : t ? new Date(t).getTime() : null);

export function deriveStatus(customer, org = {}) {
  const c = customer || null;
  const orgStatus = org.status || null;

  // --- account: can people use it right now? ---
  let account = "active";
  if (orgStatus === "archived") account = "archived";
  else if (orgStatus === "pending" || orgStatus === "pending_admin") account = "pending_admin";
  else if (c) {
    const s = c.status || "trial";
    if (s === "suspended" || c.companyStatus === "suspended" || orgStatus === "suspended") account = "suspended";
    else if (s === "expired" || c.companyStatus === "expired") account = "expired";
    else if (s === "closed" || c.closedAt) account = "closed";
  } else if (orgStatus === "suspended") account = "suspended";

  // --- plan: what they are on ---
  const planType = org.planType || c?.planType || null;
  let plan = { type: planType, name: org.planName || c?.planName || null };
  if (!plan.type) plan.type = c ? (c.status === "trial" || c.status === "trial_pending" || !c.planId ? "TRIAL" : "PAID") : null;
  if (c?.billing === "complimentary" && !["TEST", "INTERNAL"].includes(plan.type)) plan = { ...plan, type: "FREE" };

  // --- payment: who is paying ---
  let payment = "none";
  if (c) {
    if (c.billing === "complimentary") payment = "complimentary";
    else if (c.status === "active" && c.planId) payment = "paid";
    else if (c.status === "past_due") payment = "past_due";
    else if (c.status === "cancelled") payment = "cancelled";
    else payment = "unpaid";
  }

  // --- trial clock ---
  let trial = { state: "none", endsAt: null, daysLeft: null };
  if (c && ["trial", "trial_pending"].includes(c.status || "trial") && c.billing !== "complimentary") {
    if (c.status === "trial_pending") trial = { state: "not_started", endsAt: null, daysLeft: null };
    else {
      const end = ms(c.trialEndDate);
      if (end == null) trial = { state: "active", endsAt: null, daysLeft: null };
      else {
        const daysLeft = Math.ceil((end - Date.now()) / 864e5);
        trial = { state: daysLeft <= 0 ? "expired" : "active", endsAt: new Date(end).toISOString(), daysLeft };
      }
    }
  }

  // --- onboarding: how far they've got ---
  let onboarding = "not_applicable";
  if (c) {
    if (c.status === "trial_pending") onboarding = "trial_not_started";
    else if (c.verifyEmailRequired && !c.emailVerifiedAt && c.emailVerified === false) onboarding = "pending_verification";
    else if (c.mustChangePassword) onboarding = "awaiting_first_login";
    else onboarding = c.onboarded ? "onboarded" : "not_onboarded";
  }

  return { account, plan, payment, trial, onboarding };
}
