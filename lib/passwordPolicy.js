import { adminDb } from "./firebaseAdmin";

export const DEFAULT_PASSWORD_POLICY = { minLength: 8, requireMixedCase: false, requireNumber: false };

export async function getPasswordPolicy(accountId) {
  const snap = await adminDb().doc("customers/" + accountId).get();
  return { ...DEFAULT_PASSWORD_POLICY, ...(snap.data()?.passwordPolicy || {}) };
}

// Only governs passwords Bizzux itself sets directly (the "credentials"
// invite path and "setPassword" in app/api/team/route.js) — Firebase Auth's
// client SDK doesn't support server-configured per-org rules, so a
// teammate who sets their own password via an email invite's reset-password
// flow isn't covered by this.
export async function validatePassword(accountId, password) {
  const policy = await getPasswordPolicy(accountId);
  if (password.length < policy.minLength) {
    return `Password must be at least ${policy.minLength} characters`;
  }
  if (policy.requireMixedCase && !(/[a-z]/.test(password) && /[A-Z]/.test(password))) {
    return "Password must include both uppercase and lowercase letters";
  }
  if (policy.requireNumber && !/[0-9]/.test(password)) {
    return "Password must include at least one number";
  }
  return null;
}
