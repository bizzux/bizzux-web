import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/firebaseAdmin";
import { signShopToken } from "@/lib/shopHmac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHOP_URL = process.env.SHOP_URL || "https://shop.bizzux.com";

// Thin proxy to bizzux-shop's own /api/admin/activity — see that route's
// comment for why this returns usage counts/timestamps only, never actual
// sales/purchase/expense amounts. Kept server-to-server (this app's Super
// Admin auth guards it; the HMAC token below is what bizzux-shop actually
// trusts, since it's a separate Firebase project that can't verify this
// app's ID tokens directly).
export async function GET(req) {
  try {
    await requireSuperAdmin(req);
    const orgId = new URL(req.url).searchParams.get("id");
    if (!orgId) throw { status: 400, message: "Customer id required" };

    const token = signShopToken({ orgId, iat: Date.now() });
    const res = await fetch(`${SHOP_URL}/api/admin/activity`, {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) throw { status: res.status, message: data.error || "Couldn't reach Shop" };

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
