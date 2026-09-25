import { NextResponse } from "next/server";
import { requireAccountWithAppsAccess, requireUser, resolvePlatformRole, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { createHmac } from "crypto";
import { CORS_HEADERS, corsPreflight } from "@/lib/cors";
import { logAuditEvent } from "@/lib/audit";
import { canAccessApp } from "@/lib/appAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lets the in-app "switch apps" launcher inside bizzux-notes/files/projects
// call this cross-origin directly, instead of only ever being reachable
// from bizzux.com's own dashboard tile.
export async function OPTIONS() {
  return corsPreflight();
}

// Generic SSO mint route for the split-out apps (Notes, Files, ...) that
// share THIS project's Firebase Auth/Firestore — unlike /api/shop-sso,
// which bridges to bizzux-shop's separate Firebase project and has to
// look up/create a user and remap roles on the other end. Here the target
// app already has the same uid, so the payload just carries it directly and
// the target's own /api/sso can mint a custom token for it immediately.
const TARGET_APPS = {
  notes: process.env.NOTES_APP_URL || "https://notes.bizzux.com",
  files: process.env.FILES_APP_URL || "https://files.bizzux.com",
  projects: process.env.PROJECTS_APP_URL || "https://projects.bizzux.com",
  crm: process.env.CRM_APP_URL || "https://crm.bizzux.com",
  chat: process.env.CHAT_APP_URL || "https://chat.bizzux.com",
  mail: process.env.MAIL_APP_URL || "https://mail.bizzux.com",
};

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const appKey = url.searchParams.get("app");
    const targetUrl = TARGET_APPS[appKey];
    if (!targetUrl) throw { status: 400, message: "Unknown app" };

    const asOrg = url.searchParams.get("asOrg");
    let uid, email, accountId, isOwner;

    if (asOrg) {
      // Platform-Admin-only support tool: open a specific CUSTOMER's app
      // exactly as that organization's owner sees it, for troubleshooting.
      // Never reachable by a plain customer — gated on the real
      // platformAdmins/SUPER_ADMIN_EMAIL check, same as the Super Admin
      // portal itself, and every use is audit-logged since it's viewing
      // (and can act on) a customer's real data.
      const c = await requireUser(req);
      const platformRole = await resolvePlatformRole(c.uid, c.email);
      if (!c.isSuper && !platformRole) throw { status: 403, message: "Platform admin access required" };
      const orgSnap = await adminDb().doc("customers/" + asOrg).get();
      if (!orgSnap.exists) throw { status: 404, message: "Organization not found" };
      uid = asOrg;
      email = orgSnap.data().email || "";
      accountId = asOrg;
      isOwner = true; // impersonation always opens the app AS the org's own owner
      await logAuditEvent({
        action: "organization.impersonate_app_open", actor: c, targetType: "organization", targetId: asOrg,
        details: { app: appKey },
      });
    } else {
      // Enforces auth + the same trial/plan gate as the app itself (defense
      // in depth), and gives us the resolved accountId/email.
      const acct = await requireAccountWithAppsAccess(req, appKey);
      uid = acct.uid;
      email = acct.email;
      accountId = acct.accountId;
      isOwner = !!acct.isOwner;
    }

    // Phase 3 of the Organization model (lib/appAccess.js): a non-owner
    // team member needs an ACTIVE appAssignment for this specific app, not
    // just general account access — owners always have every app their
    // account has a subscription for, so they skip this check entirely.
    // Catalog ids (lib/appCatalog.js) are "bizzux-<key>", one level more
    // specific than this route's own short appKey ("crm", "projects", ...).
    if (!isOwner) {
      const allowed = await canAccessApp({ organizationId: accountId, userId: uid, appId: "bizzux-" + appKey });
      if (!allowed) {
        throw { status: 403, message: "You don't have access to this app yet — ask your admin to grant it under Team > Apps." };
      }
    }

    // Best-effort "last opened" stamp for the Super Admin Customers list's
    // Apps Used column — .update() (not .set(merge)) so this can never
    // create a stray customers/ doc for an account that doesn't have one
    // (e.g. a pure Super Admin with no customer record of their own).
    adminDb()
      .doc("customers/" + accountId)
      .update({ ["appUsage." + appKey]: FieldValue.serverTimestamp() })
      .catch(() => {});

    const secret = process.env.APP_SSO_SECRET;
    if (!secret) throw { status: 500, message: "SSO is not configured" };

    const payload = { uid, email, iat: Date.now() };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", secret).update(payloadB64).digest("hex");
    const token = payloadB64 + "." + sig;

    return NextResponse.json({ url: `${targetUrl}/sso?token=${token}` }, { headers: CORS_HEADERS });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed", ...(e.code ? { code: e.code } : {}) }, { status: e.status || 500, headers: CORS_HEADERS });
  }
}
