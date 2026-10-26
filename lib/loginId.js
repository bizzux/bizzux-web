// Bizzux login ID: "firstname.lastname@bizzux". PURE (no server or browser APIs), shared by the server, the Admin Center and the sign-in pages.
//
// The stored identity is the plain username ("firstname.lastname") in usernames/{username}. "@bizzux" is a VIRTUAL sign-in suffix: it is not an email
// address (no top-level domain, so it can never collide with a real mailbox), it is never a Firebase Auth email and never a recovery destination.
// "rajthilak.kumar" and "rajthilak.kumar@bizzux" therefore resolve to the same record and the same Firebase UID.
export const LOGIN_SUFFIX = "@onbizzux.com"; // the standard Bizzux login ID: firstname@onbizzux.com (not a mailbox; the real contact email is stored separately)
export const LEGACY_LOGIN_SUFFIX = "@bizzux"; // earlier virtual form, still accepted so existing users and bookmarks keep working
export const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/; // the username part (same rule as USERNAME_RE in lib/usernameAuth.js)

// Whatever was typed -> the plain username part. Strips the virtual suffix only; any other "@" stays so it fails the username rule later.
export function stripLoginSuffix(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  for (const suf of [LOGIN_SUFFIX, LEGACY_LOGIN_SUFFIX]) if (s.endsWith(suf)) return s.slice(0, -suf.length).trim();
  return s;
}

// True when the typed value is a Bizzux ID ("name@bizzux"), so a sign-in form knows to use the username path instead of the email path.
export const isBizzuxId = (raw) => /^[^@\s]+@(onbizzux\.com|bizzux)$/i.test(String(raw || "").trim());

export const toLoginId = (username) => (username ? String(username).toLowerCase() + LOGIN_SUFFIX : "");

// "Rajthilak" + "Kumar" -> "rajthilak.kumar". Accents are folded (José -> jose), other characters become dots, runs and edges are trimmed, max 32 characters.
export function slugName(...parts) {
  const base = parts.filter(Boolean).join(" ").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return base.replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 32).replace(/\.+$/, "");
}

// First free name for a base: base, base2, base3, ... isTaken is a function over a CANDIDATE list (so a caller can look all of them up in one batch).
// With lastName, the second suggestion is firstname.lastname (firstname, firstname2, firstname.lastname, firstname3, ...).
export function candidates(base, n = 9, lastName = "") {
  const b = String(base || "");
  if (!b) return [];
  const out = [b];
  const full = lastName ? slugName(b, lastName) : "";
  for (let i = 2; i <= n; i++) {
    const suffix = String(i);
    out.push(b.slice(0, 32 - suffix.length) + suffix);
    if (i === 2 && full && full !== b) out.push(full);
  }
  return out;
}
