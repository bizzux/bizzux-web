// SERVER ONLY — used by API routes and server components. Never imported in
// client components.
//
// Single Firebase Admin app, shared by every server-side feature in this
// codebase: the original bizzux.com features (contact form, career
// applications + resume storage) AND the merged-in apps.bizzux.com SaaS
// features (auth, team, admin, billing). All now run on ONE Firebase
// project — the same one apps.bizzux.com already used — configured via
// FIREBASE_SERVICE_ACCOUNT (see .env.example). This replaces the old
// bizzux.com-only FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY
// split-var setup.
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { randomInt } from "crypto";
import { ACCOUNT_ADMIN_PROFILES } from "./roles";
import { canAccessApps } from "./trial";

function getAdminApp() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT env var is not set");
  const creds = JSON.parse(raw);
  if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, "\n");
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET || `${creds.project_id}.firebasestorage.app`;
  return initializeApp({ credential: cert(creds), storageBucket });
}

export function adminAuth() {
  return getAuth(getAdminApp());
}
export function adminDb() {
  return getFirestore(getAdminApp());
}

// Kept under its original bizzux.com name — /api/contact and other routes
// already import getDb and don't need to change.
export function getDb() {
  return adminDb();
}
// No longer used by /api/careers (resumes moved to a private Vercel Blob
// store, since this Firebase project isn't on the paid Blaze plan that
// Firebase Storage requires just to provision a bucket) — left in place in
// case another feature wants Firebase Storage for something that doesn't
// need a bucket to exist yet.
export function getBucket() {
  return getStorage(getAdminApp()).bucket();
}

export function superEmails() {
  return (process.env.SUPER_ADMIN_EMAIL || "")
    .split(",")
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean);
}

// --- Platform Owner / Platform Admin ----------------------------------
// Real, persisted platform-level roles (platformAdmins/{uid}), layered on
// top of the older SUPER_ADMIN_EMAIL env-var allowlist rather than
// replacing it. superEmails()/requireUser()'s `isSuper` stays exactly as it
// was — cheap, env-only, checked on nearly every authenticated request in
// the app — specifically so this addition doesn't put a Firestore read on
// that hot path. Only the admin-portal-specific guards below (which are
// low-volume by nature — a handful of platform staff, not every customer
// request) look up the real platformAdmins collection.
const PLATFORM_OWNER_EMAIL = (process.env.PLATFORM_OWNER_EMAIL || "info.bizzux@gmail.com").toLowerCase();
// One-time migration list: any email here becomes a Platform ADMIN (never
// Owner) the first time it's seen, then behaves exactly like any other
// platformAdmins doc after that (editable/disable-able by the Owner like
// normal). Used once to carry the second SUPER_ADMIN_EMAIL address
// (zerotrust.connect@gmail.com) over from the old flat allowlist into a
// real, revocable Platform Admin record, per the "only one Platform Owner"
// requirement — everyone else who used to be "super" via the env var
// becomes an Admin, never automatically an Owner.
const LEGACY_PLATFORM_ADMIN_EMAILS = (process.env.LEGACY_PLATFORM_ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.toLowerCase().trim())
  .filter(Boolean);

function platformAdminsCollection() {
  return adminDb().collection("platformAdmins");
}

// Returns "OWNER" | "ADMIN" | null. Self-healing bootstrap: the FIRST time
// PLATFORM_OWNER_EMAIL is seen AND no platformAdmins doc with role "OWNER"
// exists anywhere yet, this creates one — the ONLY code path in the app
// that can ever write role:"OWNER". No API route accepts a role from a
// request body for this; nothing UI-driven can grant Owner. Legacy admin
// emails get the same one-time treatment but role:"ADMIN", never "OWNER",
// and only if they don't already have a platformAdmins doc.
export async function resolvePlatformRole(uid, email) {
  const lower = (email || "").toLowerCase();
  const ref = platformAdminsCollection().doc(uid);
  const snap = await ref.get();
  if (snap.exists) {
    const d = snap.data();
    return d.status === "disabled" ? null : d.role || null;
  }
  if (lower === PLATFORM_OWNER_EMAIL) {
    const ownerQuery = await platformAdminsCollection().where("role", "==", "OWNER").limit(1).get();
    if (ownerQuery.empty) {
      await ref.set({
        email: lower, role: "OWNER", status: "active", permissions: null,
        createdBy: "bootstrap", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      return "OWNER";
    }
  }
  if (LEGACY_PLATFORM_ADMIN_EMAILS.includes(lower)) {
    await ref.set({
      email: lower, role: "ADMIN", status: "active", permissions: null,
      createdBy: "migration", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    return "ADMIN";
  }
  return null;
}

// Owner only — creating/disabling other Platform Admins, security/config
// changes that should never be delegable.
export async function requirePlatformOwner(req) {
  const c = await requireUser(req);
  const role = await resolvePlatformRole(c.uid, c.email);
  if (role !== "OWNER") throw { status: 403, message: "Platform Owner access required" };
  return { ...c, isSuper: true, platformRole: role };
}

// Owner OR Admin — the general "can use the platform admin portal" gate.
export async function requirePlatformAdmin(req) {
  const c = await requireUser(req);
  const role = await resolvePlatformRole(c.uid, c.email);
  if (role !== "OWNER" && role !== "ADMIN") throw { status: 403, message: "Platform admin access required" };
  return { ...c, isSuper: true, platformRole: role };
}

// Verifies the bearer token on a request and returns { uid, email, isSuper }.
// Throws { status, message } on failure — callers should catch and respond.
export async function requireUser(req) {
  const authz = req.headers.get("authorization") || "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : null;
  if (!token) throw { status: 401, message: "Not signed in" };
  const decoded = await adminAuth().verifyIdToken(token);
  const email = (decoded.email || "").toLowerCase();
  const isSuper = superEmails().includes(email);
  return { uid: decoded.uid, email, isSuper };
}

export async function requireSuperAdmin(req) {
  const c = await requireUser(req);
  // Always resolve the real platformAdmins record here (not gated behind
  // `!c.isSuper`) so the Owner/legacy-admin bootstrap in resolvePlatformRole
  // reliably fires the first time either of them hits an admin route,
  // regardless of whether SUPER_ADMIN_EMAIL still happens to list them too.
  // Admin-portal-only route — low volume, safe to always do this lookup.
  const platformRole = await resolvePlatformRole(c.uid, c.email);
  const isSuper = c.isSuper || platformRole === "OWNER" || platformRole === "ADMIN";
  if (!isSuper) throw { status: 403, message: "Super admin access required" };
  return { ...c, isSuper: true, platformRole: platformRole || (c.isSuper ? "OWNER" : null) };
}

// Figures out which "account" a signed-in uid belongs to.
// - If they own a customers/{uid} doc, they're the account owner (always
//   full Admin powers on their own account, plus ownership powers no
//   assignable profile has — transferring/deleting the account).
// - Otherwise, look up memberships/{uid} — set when they accepted a team
//   invite — to find which account they joined and what profile they hold.
//   See lib/roles.js for the full profile list.
// Throws { status, message } if neither exists (e.g. /api/claim hasn't run
// yet, or the invite was never accepted).
// organizationId/organizationRole are added alongside the existing fields
// (accountId/profile/isOwner/customer/membership), never replacing them —
// every existing caller that only reads the old fields keeps working
// unchanged. organizationId is deliberately just an alias for accountId
// (the account owner's real Firebase Auth uid) rather than a newly
// generated id: every route already scopes Firestore reads/writes under
// customers/{accountId}/..., so introducing a separate id would mean either
// migrating every one of those paths or maintaining a permanent lookup
// indirection for zero functional benefit. organizationRole distinguishes
// the two customer-side admin tiers (Organization Owner vs Organization
// Admin) from plain business-role team members (Manager/Staff/Viewer,
// etc.), which get organizationRole: null — they are never treated as
// org-admin-capable unless their profile is actually in
// ACCOUNT_ADMIN_PROFILES.
export async function resolveAccount(uid) {
  const ownerSnap = await adminDb().doc("customers/" + uid).get();
  if (ownerSnap.exists) {
    return {
      accountId: uid, profile: "Admin", isOwner: true, customer: ownerSnap.data(),
      organizationId: uid, organizationRole: "ORGANIZATION_OWNER",
    };
  }
  const memSnap = await adminDb().doc("memberships/" + uid).get();
  if (!memSnap.exists) throw { status: 404, message: "No Bizzux account found for this sign-in" };
  const m = memSnap.data();
  const profile = m.profile || "Staff/Shopkeeper";
  return {
    accountId: m.accountId, profile, isOwner: false, membership: m,
    organizationId: m.accountId,
    organizationRole: ACCOUNT_ADMIN_PROFILES.includes(profile) ? "ORGANIZATION_ADMIN" : null,
  };
}

// Global Admin and Admin can manage the team and account-level config;
// Manager/Staff-Shopkeeper/Viewer-Auditor can't (see ACCOUNT_ADMIN_PROFILES).
export async function requireAccountAdmin(req) {
  const c = await requireUser(req);
  const acct = await resolveAccount(c.uid);
  if (!ACCOUNT_ADMIN_PROFILES.includes(acct.profile)) {
    throw { status: 403, message: "Admin access required" };
  }
  return { ...c, ...acct };
}

// Who's allowed to provision organization records (POST/GET
// /api/admin/organizations, and read /api/admin/plans for that form's
// dropdown): the platform Super Admin, same as before, PLUS anyone holding
// the Global Admin or Admin profile on their own account — intentionally
// widened from Super-Admin-only so account owners can self-serve this from
// /profile. Checks isSuper first so an actual Super Admin without their own
// customers/{uid} or memberships/{uid} doc (resolveAccount would 404) still
// gets through.
export async function requireOrgManager(req) {
  const c = await requireUser(req);
  if (c.isSuper) return { ...c, isOwner: false };
  // Low-volume, admin-portal-only route (not a customer hot path), so the
  // extra Firestore lookup here is fine — recognizes a Platform Admin
  // created later by the Owner (not in the SUPER_ADMIN_EMAIL env var).
  const platformRole = await resolvePlatformRole(c.uid, c.email);
  if (platformRole === "OWNER" || platformRole === "ADMIN") {
    return { ...c, isSuper: true, isOwner: false, platformRole };
  }
  const acct = await resolveAccount(c.uid);
  if (!ACCOUNT_ADMIN_PROFILES.includes(acct.profile)) {
    throw { status: 403, message: "Admin access required" };
  }
  return { ...c, ...acct };
}

// Gate for the apps that check trial/plan status server-side (Notes, Files)
// as defense-in-depth behind the client-side lock — same shape as
// /api/shop-sso's check, but shared here so it can't drift out of sync the
// way it did once already (two copies of this existed inline, both missing
// the Super Admin bypass /api/shop-sso already had, so a Super Admin whose
// own customers/ record had an expired trial could see the "Open app" tile
// but still get rejected by the API itself).
//
// Super Admin always bypasses the trial/plan check. resolveAccount() is
// still attempted even for a Super Admin, because these routes need a real
// accountId to scope Firestore data under (customers/{accountId}/...) — if
// they have no customers/ or memberships/ doc at all (a "pure" Super Admin
// with no account of their own), their own uid is used as the accountId
// instead, so the apps still work rather than 404ing.
// Deliberately still checks only the env-var isSuper (not
// resolvePlatformRole) — unlike requireOrgManager/requireSuperAdmin above,
// this IS a real customer hot path (Notes/Files/Projects hit it on every
// load), so it intentionally doesn't add a Firestore read here. A Platform
// Admin created later via the platform portal (not in SUPER_ADMIN_EMAIL)
// won't get the trial bypass on these apps — an accepted narrow gap, easy
// to revisit if it ever actually matters.
export async function requireAccountWithAppsAccess(req) {
  const c = await requireUser(req);
  if (c.isSuper) {
    try {
      const acct = await resolveAccount(c.uid);
      return { ...c, ...acct };
    } catch {
      return { ...c, accountId: c.uid, profile: "Admin", isOwner: true };
    }
  }
  const acct = await resolveAccount(c.uid);
  const customer = acct.isOwner
    ? acct.customer
    : (await adminDb().doc("customers/" + acct.accountId).get()).data();
  if (!canAccessApps(customer)) {
    throw { status: 402, message: "Your trial has ended. Choose a plan to keep using Bizzux apps." };
  }
  return { ...c, ...acct };
}

// Generates a readable one-time password for accounts a Platform Admin
// creates or resets directly, without going through email at all — for
// small-business logins where the owner has no email address staff can
// reliably reach (see /api/admin/organizations "createAccount" and
// /api/admin/customers "setPassword"). Excludes visually ambiguous
// characters (0/O, 1/l/I) since it's typically read aloud on a support call.
export function generateTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[randomInt(chars.length)];
  return out;
}

// Sends a real Firebase Auth transactional email (password reset / email
// verification / email-link sign-in) via the public Identity Toolkit REST
// endpoint. The Admin SDK's generate*Link() helpers only *return* a link —
// they never send anything — so this is what actually gets an email into
// someone's inbox without standing up a separate email provider.
export async function sendAuthEmail({ requestType, email, continueUrl }) {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is not set");
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestType, email, continueUrl, canHandleCodeInApp: true }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to send invite email");
  return data;
}
