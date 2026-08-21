// Shared derivation logic for the "which verification gate(s) apply"
// question, used both server-side (app/api/claim/route.js,
// app/api/admin/settings/route.js) and client-side
// (app/(saas)/dashboard/page.js). Kept in one place so the fallback rules
// for pre-existing data (from before Email+Mobile could both be enabled)
// can't drift between the two.

// portalSettings/config: what a NEW signup should be asked to verify.
// Reads the new verifyEmail/verifyMobile booleans if present; falls back
// to the older single verificationMethod string for settings saved before
// this became a two-checkbox toggle; defaults to email-only if neither is
// present at all.
export function deriveVerificationSettings(data) {
  if (!data) return { verifyEmail: true, verifyMobile: false };
  if (typeof data.verifyEmail === "boolean" || typeof data.verifyMobile === "boolean") {
    return { verifyEmail: data.verifyEmail === true, verifyMobile: data.verifyMobile === true };
  }
  if (data.verificationMethod === "mobile") return { verifyEmail: false, verifyMobile: true };
  return { verifyEmail: true, verifyMobile: false };
}

// customers/{uid}: which gate(s) THIS account still needs to clear. Reads
// the verifyEmailRequired/verifyMobileRequired flags /api/claim stamps on
// new accounts; falls back to the older verificationMethod field for
// accounts created before both could be required at once.
export function deriveVerificationFlags(data) {
  if (!data) return { verifyEmailRequired: true, verifyMobileRequired: false };
  if ("verifyEmailRequired" in data || "verifyMobileRequired" in data) {
    return {
      verifyEmailRequired: data.verifyEmailRequired === true,
      verifyMobileRequired: data.verifyMobileRequired === true,
    };
  }
  if (data.verificationMethod === "mobile") return { verifyEmailRequired: false, verifyMobileRequired: true };
  return { verifyEmailRequired: true, verifyMobileRequired: false };
}
