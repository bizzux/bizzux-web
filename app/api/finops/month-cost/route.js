import { NextResponse } from "next/server";
import { verifyShopToken } from "@/lib/shopHmac";
import { adminDb } from "@/lib/firebaseAdmin";
import { dateKey } from "@/lib/costAnalytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Platform infrastructure cost per month, for Bizzux Technologies LLP's OWN
// Business Finance (bizzux-finance imports it as a "Technology / Platform
// Infrastructure" line). Server-to-server only, and deliberately narrow:
//   - the caller proves its organization with an HMAC token (SHOP_SSO_SECRET,
//     the same shared secret the apps already use for usage reporting);
//   - only the organization configured as BIZZUX_OWN_ORG_ID may call it, so no
//     customer organization can ever read Bizzux's costs;
//   - it returns ONE total per month (plus whether any day is still an
//     estimate) — never rate cards, margins, per-customer or per-provider cost.
const MAX_MONTHS = 24;
const r2 = (v) => Math.round(v * 100) / 100;
const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const lastDay = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

export async function GET(req) {
  try {
    const own = (process.env.BIZZUX_OWN_ORG_ID || "").trim();
    const authz = req.headers.get("authorization") || "";
    const { orgId } = verifyShopToken(authz.startsWith("Bearer ") ? authz.slice(7) : "", 5 * 60 * 1000);
    if (!own || orgId !== own) throw { status: 403, message: "The FinOps cost import is only available to Bizzux Technologies LLP." };

    const months = [...new Set(String(new URL(req.url).searchParams.get("months") || "").split(",").map((s) => s.trim()).filter(Boolean))].sort();
    if (!months.length || months.length > MAX_MONTHS || !months.every(isMonth)) throw { status: 400, message: `Pass 1-${MAX_MONTHS} months as YYYY-MM` };

    const from = months[0] + "-01";
    const to = lastDay(months[months.length - 1]);
    const snap = await adminDb().collection("costAnalyticsDaily").where("date", ">=", from).where("date", "<=", to).get();
    const out = Object.fromEntries(months.map((m) => [m, { total: 0, days: 0, estimated: false }]));
    for (const d of snap.docs) {
      const x = d.data();
      const o = out[String(x.date).slice(0, 7)];
      if (!o) continue;
      o.total += Number(x.totalCloudCost) || 0;
      o.days += 1;
      if (x.costSource !== "billing") o.estimated = true;
    }
    for (const m of months) out[m].total = r2(out[m].total);
    return NextResponse.json({ currency: "INR", asOf: dateKey(), months: out });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
