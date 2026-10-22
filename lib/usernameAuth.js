// Admin-provisioned username + password login on top of Firebase Auth.
//
// Firebase Auth has no native username login, and the older admin-created
// logins (see /api/admin/organizations createTeamMember) fake an email like
// name@bizzux.login marked emailVerified. This is the replacement for new
// accounts: the Firebase user has NO email at all. The password lives only
// as a scrypt hash in usernames/{username}, a server-only collection
// (Firestore rules must deny all client access to it), and a successful
// check mints a Firebase custom token via adminAuth().createCustomToken so
// the browser can signInWithCustomToken. Existing Google / email+password
// logins are untouched.
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { adminAuth, adminDb } from "./firebaseAdmin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { accountExpired } from "./accountExpiry";
import { stripLoginSuffix } from "./loginId";

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;
// Admin-issued temporary passwords stop working after this long (only when the
// account was created/reset with an expiry; older accounts have none).
export const TEMP_PASSWORD_HOURS = 72;
export const tempExpiry = () => Timestamp.fromMillis(Date.now() + TEMP_PASSWORD_HOURS * 3600 * 1000);
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX = 30;

// Accepts the plain username or the Bizzux ID ("name@bizzux"); both give the same stored key. See lib/loginId.js.
export function normalizeUsername(u) {
  return stripLoginSuffix(u);
}

function usernameRef(username) {
  return adminDb().collection("usernames").doc(username);
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return { salt: salt.toString("hex"), hash: hash.toString("hex") };
}

function verifyHash(password, saltHex, hashHex) {
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

// Burns the same CPU as a real check so unknown usernames aren't
// distinguishable by response time.
const DUMMY = hashPassword("dummy-password-for-timing");

export async function createUsernameUser({ username, password, displayName, organizationId, mustChangePassword = true, createdBy, tempExpiresAt = null, accountExpiresAt = "", employmentType = "Employee", extra = {} }) {
  username = normalizeUsername(username);
  if (!USERNAME_RE.test(username)) {
    throw { status: 400, message: "Username must be 3-32 characters: letters, numbers, dot, dash or underscore" };
  }
  const ref = usernameRef(username);
  // One name = one person across the portal and Attendance (Attendance keeps its own store, attUsernames). The cheap check first, so an obvious clash
  // never creates a Firebase user; the real guarantee is the transaction below.
  const attRef = adminDb().collection("attUsernames").doc(username);
  const [mine, attendance] = await Promise.all([ref.get(), attRef.get()]);
  if (mine.exists || attendance.exists) throw { status: 409, message: "That username is already taken" };
  const authUser = await adminAuth().createUser({ displayName });
  const { salt, hash } = hashPassword(password);
  try {
    // ATOMIC RESERVATION: both namespaces are read and the name is claimed in ONE transaction, so two admins (or two apps) creating the same name at the
    // same moment cannot both succeed; the loser gets "already taken" and its Firebase user is removed again below.
    await adminDb().runTransaction(async (tx) => {
      const [m, att] = await Promise.all([tx.get(ref), tx.get(attRef)]);
      if (m.exists || att.exists) throw { status: 409, message: "That username is already taken" };
      tx.create(ref, {
      // organizationId null = this user IS the organization owner, whose
      // uid doubles as the organization id (customers/{uid}).
      uid: authUser.uid, organizationId: organizationId || authUser.uid, salt, hash, mustChangePassword,
      displayName: displayName || "", accountExpiresAt: accountExpiresAt || "", employmentType, tempExpiresAt: mustChangePassword ? tempExpiresAt : null, failedCount: 0, lockedUntil: null, disabled: false,
      createdBy: createdBy || null, createdAt: FieldValue.serverTimestamp(), ...extra,
    });
    });
  } catch (e) {
    await adminAuth().deleteUser(authUser.uid).catch(() => {});
    if (e.code === 6 || e.status === 409) throw { status: 409, message: "That username is already taken" };
    throw e;
  }
  return { uid: authUser.uid, username };
}

export async function usernameForUid(uid) {
  const snap = await adminDb().collection("usernames").where("uid", "==", uid).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

export async function setUsernamePassword(uid, password, mustChangePassword, { tempExpiresAt = null } = {}) {
  const doc = await usernameForUid(uid);
  if (!doc) throw { status: 404, message: "Not a username login" };
  const { salt, hash } = hashPassword(password);
  await doc.ref.update({
    salt, hash, mustChangePassword, tempExpiresAt: mustChangePassword ? tempExpiresAt : null, failedCount: 0, lockedUntil: null,
    passwordChangedAt: FieldValue.serverTimestamp(),
  });
  // Existing sessions end when the password changes or is reset.
  await adminAuth().revokeRefreshTokens(uid);
}

async function ipThrottled(ip) {
  const ref = adminDb().collection("loginThrottle").doc(String(ip).replace(/[^a-zA-Z0-9:.]/g, "_"));
  return adminDb().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const now = Date.now();
    const d = s.exists ? s.data() : null;
    const fresh = d && now - d.windowStart < IP_WINDOW_MS;
    const count = fresh ? d.count + 1 : 1;
    tx.set(ref, { windowStart: fresh ? d.windowStart : now, count });
    return count > IP_MAX;
  });
}

// Returns { token, mustChangePassword } or throws { status, message }.
// Every failure uses the same generic message except lockout.
export async function usernameLogin({ username, password, ip }) {
  const generic = { status: 401, message: "Incorrect username or password" };
  if (await ipThrottled(ip || "unknown")) throw { status: 429, message: "Too many attempts. Try again later." };
  username = normalizeUsername(username);
  const ref = usernameRef(USERNAME_RE.test(username) ? username : "_invalid_");
  const snap = await ref.get();
  if (!snap.exists) {
    verifyHash(String(password || ""), DUMMY.salt, DUMMY.hash);
    throw generic;
  }
  const d = snap.data();
  if (d.lockedUntil && d.lockedUntil.toMillis() > Date.now()) {
    throw { status: 423, message: "Account locked after too many attempts. Try again later or ask your administrator." };
  }
  const ok = verifyHash(String(password || ""), d.salt, d.hash);
  if (!ok) {
    const failed = (d.failedCount || 0) + 1;
    await ref.update({
      failedCount: failed,
      lockedUntil: failed >= MAX_FAILURES ? Timestamp.fromMillis(Date.now() + LOCK_MINUTES * 60000) : null,
    });
    throw generic;
  }
  // Correct but expired temporary password: refuse until an admin reissues one.
  if (d.mustChangePassword && d.tempExpiresAt && d.tempExpiresAt.toMillis() < Date.now()) {
    throw { status: 403, code: "temp_password_expired", message: "Your temporary password has expired. Ask your administrator to issue a new one." };
  }
  // Credentials correct: now enforce user, membership and company status.
  if (accountExpired(d)) throw { status: 403, message: "Your access has expired. Contact your administrator." };
  const user = await adminAuth().getUser(d.uid).catch(() => null);
  if (!user || user.disabled || d.disabled) throw { status: 403, message: "This account is suspended. Contact your administrator." };
  const org = await adminDb().doc("customers/" + d.organizationId).get();
  if (!org.exists || ["suspended", "closed", "expired"].includes(org.data().status)
      || ["suspended", "expired"].includes(org.data().companyStatus)) {
    throw { status: 403, message: "Your company's account is not active. Contact your administrator." };
  }
  await ref.update({ failedCount: 0, lockedUntil: null, lastLoginAt: FieldValue.serverTimestamp() });
  const token = await adminAuth().createCustomToken(d.uid, { organizationId: d.organizationId, auth: "username" });
  return { token, mustChangePassword: !!d.mustChangePassword };
}

// ---- Recovery codes -------------------------------------------------------
// The recovery method for username users who have no email: 8 single-use
// codes shown to the user once (at their first password change) and kept
// only as scrypt hashes. A valid code lets them set a new password without
// an administrator. No email and no SMS provider are involved. Codes can be
// reissued by a company/platform admin (which invalidates the old set).
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode() {
  const b = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_CHARS[b[i] % CODE_CHARS.length];
  return s.slice(0, 4) + "-" + s.slice(4);
}
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function generateRecoveryCodes(uid) {
  const doc = await usernameForUid(uid);
  if (!doc) throw { status: 404, message: "Not a username login" };
  const codes = Array.from({ length: 8 }, newCode);
  await doc.ref.update({
    recovery: codes.map((c) => ({ ...hashPassword(normCode(c)), used: false })),
    recoveryIssuedAt: FieldValue.serverTimestamp(), recoveryFailed: 0,
  });
  return codes;
}

export async function hasRecoveryCodes(uid) {
  const doc = await usernameForUid(uid);
  return !!(doc && (doc.data().recovery || []).some((r) => !r.used));
}

// Verifies one recovery code and, if valid, returns { uid, organizationId }
// after consuming it. Same generic failure + lockout behaviour as login.
export async function consumeRecoveryCode({ username, code, ip }) {
  const generic = { status: 401, message: "Incorrect username or recovery code" };
  if (await ipThrottled("recover:" + (ip || "unknown"))) throw { status: 429, message: "Too many attempts. Try again later." };
  username = normalizeUsername(username);
  const ref = usernameRef(USERNAME_RE.test(username) ? username : "_invalid_");
  const snap = await ref.get();
  if (!snap.exists) {
    verifyHash(normCode(code), DUMMY.salt, DUMMY.hash);
    throw generic;
  }
  const d = snap.data();
  if (d.lockedUntil && d.lockedUntil.toMillis() > Date.now()) {
    throw { status: 423, message: "Account locked after too many attempts. Try again later or ask your administrator." };
  }
  const list = d.recovery || [];
  const c = normCode(code);
  const idx = c.length === 8 ? list.findIndex((r) => !r.used && verifyHash(c, r.salt, r.hash)) : -1;
  if (idx < 0) {
    const failed = (d.recoveryFailed || 0) + 1;
    await ref.update({ recoveryFailed: failed, lockedUntil: failed >= MAX_FAILURES ? Timestamp.fromMillis(Date.now() + LOCK_MINUTES * 60000) : null });
    throw generic;
  }
  list[idx] = { ...list[idx], used: true };
  await ref.update({ recovery: list, recoveryFailed: 0 });
  const user = await adminAuth().getUser(d.uid).catch(() => null);
  if (!user || user.disabled || d.disabled) throw { status: 403, message: "This account is suspended. Contact your administrator." };
  return { uid: d.uid, organizationId: d.organizationId, remaining: list.filter((r) => !r.used).length };
}
