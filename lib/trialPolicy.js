// Customer-facing free-trial policy wording, shown on the pricing page, the
// trial-start step and the trial-ended screen. Kept in one place so every
// screen says the same thing. Trial length itself is admin-configured
// (portalSettings/config.trialDays) and passed in.

export const TRIAL_CONTACT_URL = "/contact?topic=trial-extension";

export function trialHeadline(days) {
  return days ? `${days}-day free trial` : "Free trial";
}

export const TRIAL_POLICY_POINTS = [
  "One free trial per business, confirmed by verifying your mobile number with a one-time code. A number that has already had a trial can't start another.",
  "No card needed during the trial. When it ends, your data stays safe and your apps stay locked until you choose a plan.",
  "Serious about Bizzux and need more time? Contact us. We're happy to extend trials for genuine businesses who are evaluating Bizzux.",
  "Trial length, eligibility and terms may change or be withdrawn at any time without notice. We may decline or end trials that look like misuse, such as repeated sign-ups.",
];

export const TRIAL_POLICY_SHORT =
  "One trial per verified mobile number. Trial terms may change without notice. Genuine businesses can contact us for an extension.";
