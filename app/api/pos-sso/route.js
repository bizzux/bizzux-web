import { NextResponse } from "next/server";
import { requireUser, resolveAccount, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { canAccessApps } from "@/lib/trial";
import { createHmac } from "crypto";
import { CORS_HEADERS, corsPreflight } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return corsPreflight();
}

// Bizzux POS (pos.bizzux.com) is the exact same bizzux-shop codebase as
// Bizzux Shop, deployed separately with NEXT_PUBLIC_APP_MODE=pos, which
// hard-locks it to a bare-bones POS tab set regardless of plan/features.
// This route is a near-identical copy of /api/shop-sso, pointed at that
// separate deployment instead — kept as its own file (rather than a
// parameterized shared helper) since the two are independent products that
// may diverge (separate URL, separate "last opened" stamp, potentially a
// different role mapping or access gate later).
//
// POS_URL lets this point at a local dev server for testing — leave unset
// in production and it falls back to the real deployed POS app.
const POS_URL = process.env.POS_URL || "https://pos.bizzux.com";

const PROFILE_TO_SHOP_ROLE = {
  "Global Admin": "owner",
  Admin: "owner",
  Manager: "manager",
  "Viewer/Auditor": "viewer",
  "Staff/Shopkeeper": "shopkeeper",
};

export async function GET(req) {
  try {
    const c = await requireUser(req);
    const secret = process.env.SHOP_SSO_SECRET;
    if (!secret) throw { status: 500, message: "SHOP_SSO_SECRET is not configured" };

    let role;
    let orgId = c.uid;
    if (c.isSuper) {
      role = "super";
      try {
        const acct = await resolveAccount(c.uid);
        orgId = acct.accountId;
      } catch {
        // No account of their own — keep the personal-org fallback above.
      }
    } else {
      const acct = await resolveAccount(c.uid);
      orgId = acct.accountId;
      role = acct.isOwner ? "owner" : PROFILE_TO_SHOP_ROLE[acct.profile] || "shopkeeper";

      const customer = acct.isOwner
        ? acct.customer
        : (await adminDb().doc("customers/" + acct.accountId).get()).data();
      if (!canAccessApps(customer)) {
        throw { status: 402, message: "Your trial has ended. Choose a plan to keep using Bizzux apps." };
      }
    }

    // Keyed "pos" (distinct from Shop's "juicechatjunction") so the admin
    // Apps Used column can tell POS opens apart from Shop opens even
    // though they share the same underlying account/data.
    adminDb()
      .doc("customers/" + orgId)
      .update({ ["appUsage.pos"]: FieldValue.serverTimestamp() })
      .catch(() => {});

    const payload = {
      email: c.email,
      role,
      orgId,
      iat: Date.now(),
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", secret).update(payloadB64).digest("hex");
    const token = payloadB64 + "." + sig;

    return NextResponse.json({ url: `${POS_URL}/sso?token=${token}` }, { headers: CORS_HEADERS });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500, headers: CORS_HEADERS });
  }
}
