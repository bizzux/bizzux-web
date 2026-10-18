import { NextResponse } from "next/server";
import { requireAccountAdmin } from "@/lib/firebaseAdmin";
import { stateFor, startTrial, previewChange, confirmChange, undoChange } from "@/lib/attendanceSubscription";
import { usageFor } from "@/lib/attendancePriceBook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// An organisation admin's Attendance licence subscription. PREVIEW and RECORD only — nothing here charges a card or touches a payment gateway.
//   GET                                   state: status, trial, access, what is billed now, unconfirmed differences, pending adjustments
//   POST { action: "startTrial", counts?, cycle? }                       free trial, no card; one per organisation
//   POST { action: "preview", moves: [{from,to,count}], faceTo? }        what a change would do and cost (nothing is recorded)
//   POST { action: "confirm", moves, requestId, faceTo? }                records it; upgrades prorated onto the NEXT invoice, downgrades at the next cycle start
//   POST { action: "undo", changeId }                                    undo a scheduled downgrade within 24 hours
// moves: from = a mode or null (a new person), to = a mode or null (a person leaving).
const err = (e) => NextResponse.json({ error: e?.message || "Failed" }, { status: e?.status || 500 });

export async function GET(req) {
  try {
    const c = await requireAccountAdmin(req);
    const org = c.accountId || c.uid;
    const u = await usageFor(org);
    return NextResponse.json(await stateFor(org, { liveCounts: u?.counts || null }));
  } catch (e) { return err(e); }
}

export async function POST(req) {
  try {
    const c = await requireAccountAdmin(req);
    const org = c.accountId || c.uid;
    const b = await req.json();
    const actor = { uid: c.uid, email: c.email };
    switch (b.action) {
      case "startTrial": {
        const u = await usageFor(org);
        return NextResponse.json(await startTrial(actor, org, { counts: b.counts || u?.counts || {}, cycle: b.cycle }));
      }
      case "preview": return NextResponse.json(await previewChange(org, { moves: b.moves, faceTo: b.faceTo }));
      case "confirm": return NextResponse.json(await confirmChange(actor, org, { moves: b.moves, faceTo: b.faceTo, requestId: String(b.requestId || "") }));
      case "undo": return NextResponse.json(await undoChange(actor, org, String(b.changeId || "")));
      default: return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) { return err(e); }
}
