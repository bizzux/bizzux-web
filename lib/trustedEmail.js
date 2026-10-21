// Which email addresses on a verified sign-in token may be used to decide WHAT a person can do.
// Phase 0 of the unified-login work. Rule: an email is an authorisation input only when the provider that proved it is
// one whose email ownership we trust (Google, or Firebase email/password) AND the address is verified. Everything else
// (Microsoft, generic OIDC/SAML, Apple, anonymous, unverified password sign-ups) can still sign in and be shown their
// address, but the address never makes them a Platform Admin and never matches them to an invite or company.
// Identity itself is the Firebase uid; this module never links or merges accounts.
// Copied verbatim into every Bizzux app (keep the copies identical; tests/trustedEmail.test.mjs checks the rule).

export const TRUSTED_EMAIL_PROVIDERS = ["google.com", "password"];

const lower = (e) => String(e || "").trim().toLowerCase();

// Decide from the token alone. { email, lookup }: lookup=true means the token came from a Bizzux custom token
// (portal single sign-on into an app, username login, Android Google hand-off) so the provider must be read from the
// account record instead.
export function trustedEmailFromToken(decoded) {
  const email = lower(decoded?.email);
  if (!email) return { email: "", lookup: false };
  const provider = decoded?.firebase?.sign_in_provider || "";
  if (provider === "custom") return { email: "", lookup: true };
  if (decoded?.email_verified !== true) return { email: "", lookup: false };
  return { email: TRUSTED_EMAIL_PROVIDERS.includes(provider) ? email : "", lookup: false };
}

// Decide from the stored account record: verified, and the same address is held by a trusted provider on that account.
export function trustedEmailFromRecord(record, email) {
  const e = lower(email);
  if (!e || !record || record.emailVerified !== true || lower(record.email) !== e) return "";
  const ok = (record.providerData || []).some((p) => TRUSTED_EMAIL_PROVIDERS.includes(p?.providerId) && lower(p?.email) === e);
  return ok ? e : "";
}

const CACHE = new Map(); // uid|email -> { v, at }
const TTL_MS = 60_000;

// auth = firebase-admin Auth instance (only used for custom-token sessions). Fails closed: any error means "not trusted".
export async function resolveTrustedEmail(decoded, auth, now = Date.now()) {
  const first = trustedEmailFromToken(decoded);
  if (!first.lookup) return first.email;
  const email = lower(decoded.email);
  const key = decoded.uid + "|" + email;
  const hit = CACHE.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.v;
  let v = "";
  try { v = trustedEmailFromRecord(await auth.getUser(decoded.uid), email); } catch { v = ""; }
  if (CACHE.size > 5000) CACHE.clear();
  CACHE.set(key, { v, at: now });
  return v;
}

export function _clearTrustedEmailCache() { CACHE.clear(); }
