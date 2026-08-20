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
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { ACCOUNT_ADMIN_PROFILES } from "./roles";

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
  if (!c.isSuper) throw { status: 403, message: "Super admin access required" };
  return c;
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
export async function resolveAccount(uid) {
  const ownerSnap = await adminDb().doc("customers/" + uid).get();
  if (ownerSnap.exists) {
    return { accountId: uid, profile: "Admin", isOwner: true, customer: ownerSnap.data() };
  }
  const memSnap = await adminDb().doc("memberships/" + uid).get();
  if (!memSnap.exists) throw { status: 404, message: "No Bizzux account found for this sign-in" };
  const m = memSnap.data();
  return { accountId: m.accountId, profile: m.profile || "Staff/Shopkeeper", isOwner: false, membership: m };
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
  const acct = await resolveAccount(c.uid);
  if (!ACCOUNT_ADMIN_PROFILES.includes(acct.profile)) {
    throw { status: 403, message: "Admin access required" };
  }
  return { ...c, ...acct };
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
