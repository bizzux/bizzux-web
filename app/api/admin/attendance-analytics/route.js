import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { logAuditEvent } from "@/lib/audit";
import { requirePlatformPermission } from "@/lib/platformRoles";
import { listBooks, listContracts, getCostModel, bookInForce, todayIst, usageFor } from "@/lib/attendancePriceBook";
import { analyse } from "@/lib/attendanceAnalytics";
import { FLAGS, FLAG_LABEL, cleanFlags, flagChange } from "@/lib/attendanceFlags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Global Admin → Attendance Insights.
//   GET   (analytics.saas.read)        subscriptions, licences sold vs used, MRR estimate, margin estimate, trials, failed payments; the global rollout flags
//   POST  action "setFlags"            (attendance.flags.manage — Platform Owner only)
//         { scope: "global" | "company", orgId?, values: { flag: boolean }, reason }
// Read cost: one query for subscriptions (max 200), one for contracts, one usage document per subscribed organisation (max 200), plus the price book
// and cost model. Nothing here charges anyone or touches checkout, webhooks or subscriptions.
const err = (e) => NextResponse.json({ error: e?.message || "Failed" }, { status: e?.status || 500 });
const MAX_ORGS = 200;

export async function GET(req) {
  try {
    await requirePlatformPermission(req, "analytics.saas.read");
    const db = adminDb();
    const [subSnap, contractList, costModel, listing, flagSnap] = await Promise.all([
      db.collection("attendanceSubscriptions").limit(MAX_ORGS).get(), listContracts(), getCostModel(), listBooks(), db.doc("attendancePlatform/flags").get(),
    ]);
    const subs = subSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const contracts = Object.fromEntries(contractList.map((c) => [c.id, c]));
    const usage = {};
    await Promise.all(subs.map(async (s) => { const u = await usageFor(s.id); if (u) usage[s.id] = u; }));
    const today = todayIst();
    const doc = bookInForce(listing.books, today);
    const report = analyse({ subs, contracts, usage, book: doc?.book || null, costModel, today });
    const f = flagSnap.exists ? flagSnap.data() : {};
    return NextResponse.json({
      ...report, truncated: subSnap.size >= MAX_ORGS, priceVersion: doc?.version || null,
      flags: { values: cleanFlags(f), reason: f.reason || "", updatedAt: f.updatedAt || null, updatedByEmail: f.updatedByEmail || "", definitions: FLAGS.map((k) => ({ key: k, label: FLAG_LABEL[k] })) },
    });
  } catch (e) { return err(e); }
}

export async function POST(req) {
  try {
    const actor = await requirePlatformPermission(req, "attendance.flags.manage");
    const b = await req.json();
    if (b.action !== "setFlags") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    const chg = flagChange({ scope: b.scope, values: b.values, reason: b.reason });
    if (!chg.ok) return NextResponse.json({ error: chg.message }, { status: 400 });
    const at = new Date().toISOString();
    const db = adminDb();
    let ref, targetId;
    if (b.scope === "global") { ref = db.doc("attendancePlatform/flags"); targetId = "global"; }
    else {
      const orgId = String(b.orgId || "").trim();
      if (!orgId) return NextResponse.json({ error: "Choose a company." }, { status: 400 });
      if (!(await db.doc("customers/" + orgId).get()).exists) return NextResponse.json({ error: "Company not found." }, { status: 404 });
      ref = db.doc(`customers/${orgId}/attSettings/main`); targetId = orgId;
    }
    if (b.scope === "global") await ref.set({ ...chg.patch, reason: chg.reason, updatedAt: at, updatedBy: actor.uid, updatedByEmail: actor.email || "" }, { merge: true });
    else await ref.set({ platformFlags: chg.patch, platformFlagsMeta: { reason: chg.reason, updatedAt: at, updatedBy: actor.uid } }, { merge: true });
    await logAuditEvent({ action: "attendance_flags.set", actor, targetType: "attendanceFlags", targetId, details: { scope: b.scope, values: chg.patch, reason: chg.reason } });
    return NextResponse.json({ ok: true, scope: b.scope, values: chg.patch });
  } catch (e) { return err(e); }
}
