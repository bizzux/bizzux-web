import { NextResponse } from "next/server";
import { requireAccountAdmin, adminDb } from "@/lib/firebaseAdmin";
import { listBooks, getContract, usageFor, bookInForce, quote, todayIst } from "@/lib/attendancePriceBook";
import { billableCounts } from "@/lib/attendancePricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// An organisation admin's itemised estimate for Bizzux Attendance: { counts?: {mode: n}, faceGpsCount?, cycle: "month"|"year", useCurrent?: true }.
// useCurrent reads who is on which mode right now (the Attendance app keeps that summary) — a "what would we pay" preview, never a charge.
// Prices come only from the PUBLISHED price book in force (or the version this organisation's contract is pinned to) — never from the request.
export async function POST(req) {
  try {
    const c = await requireAccountAdmin(req);
    const body = await req.json();
    const org = c.accountId || c.uid;
    const cust = (await adminDb().doc("customers/" + org).get()).data() || {};
    const today = todayIst();
    const contract = await getContract(org);
    // Customers on their current per-user plan stay there until they choose to move: no estimate is silently applied to them.
    if (!contract && Array.isArray(cust.subscription?.appKeys) && cust.subscription.appKeys.includes("attendance")) {
      return NextResponse.json({ ok: false, legacy: true, error: "Your organisation is on its current Attendance plan. Contact us if you would like to move to licence-based pricing." }, { status: 409 });
    }
    const listing = await listBooks();
    const doc = bookInForce(listing.books, today, contract?.pinnedVersion || "");
    if (!doc) return NextResponse.json({ ok: false, error: "Attendance pricing hasn't been published yet." }, { status: 404 });

    let assigned = body.counts || {}, face = body.faceGpsCount || 0, cycle = body.cycle;
    if (body.useCurrent) { const u = await usageFor(org); assigned = u?.counts || {}; face = u?.faceGps || 0; cycle = cycle || u?.cycle; }
    const basis = contract?.billingBasis || "assigned";
    const { counts, shortfall } = billableCounts(basis, assigned, contract?.purchased || {});
    const q = quote(doc.book, { counts, faceGpsCount: face, cycle, date: today }, contract);
    return NextResponse.json({ ...q, priceVersion: doc.version, billingBasis: basis, shortfall, assigned });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: e?.status || 500 });
  }
}
