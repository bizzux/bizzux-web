import { NextResponse } from "next/server";
import { verifyShopToken } from "@/lib/shopHmac";
import { recordUsage } from "@/lib/usageMetrics";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bizzux apps (Shop/POS, Attendance, CRM, ...) report tenant usage here in
// small batches; this folds them into usageDaily/{date}_{organizationId}
// so the Platform Admin Cost & Usage dashboard never has to scan any app's
// transactional collections.
//
// Auth is the same HMAC scheme apps already use with bizzux-web
// (Authorization: Bearer <signShopToken({ orgId, iat })>, shared
// SHOP_SSO_SECRET). The signed orgId is the ONLY tenant this request can
// write to, so one org can never report usage as another.
//
// Body: { events: [{ module, userId?, date?, transactions?, reads?, writes?,
//                    deletes?, storageGB? }] }   (max 500)
// module: (omit/"other" for org-wide ops) pos | attendance | crm | inventory | expenses | purchases | invoices | payments
export async function POST(req) {
  try {
    const authz = req.headers.get("authorization") || "";
    const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
    const { orgId } = verifyShopToken(token, 5 * 60 * 1000);

    // Reject unknown tenants so garbage can't create usage docs.
    const org = await adminDb().doc("customers/" + orgId).get();
    if (!org.exists) throw { status: 404, message: "Unknown organization" };

    const body = await req.json().catch(() => ({}));
    const result = await recordUsage(orgId, body.events);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
