import { NextResponse } from "next/server";
import { requirePlatformPermission } from "@/lib/platformRoles";
import {
  listBooks, createDraft, updateDraft, discardDraft, submitDraft, rejectSubmission, approveSubmission, listContracts, saveContract, getCostModel, saveCostModel,
  impactFor, quote, todayIst,
} from "@/lib/attendancePriceBook";
import { PROPOSED_BOOK, validateBook, adviceFor, cliffReport, marginFor, normalizeBook } from "@/lib/attendancePricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Global Admin → Revenue & Billing → Attendance Pricing.
//   GET   (pricing.view)     price book versions, contracts, cost model; the proposed numbers; advice and cliff report per version
//   POST  actions:
//     createDraft {fromProposed | basedOn, name?, note?}   (pricing.manage)
//     updateDraft {id, book, name?, note?}                 (pricing.manage)
//     discardDraft {id}                                    (pricing.manage)
//     submit {id, effectiveFrom}                           (pricing.manage)   → waits for a DIFFERENT person to approve
//     sendBack {id, note}                                  (pricing.publish)
//     approve {id}                                         (pricing.publish — Platform Owner, never the drafter/editor/submitter)
//     preview {id | book, counts, faceGpsCount, cycle}     (pricing.view)     itemised quote, nothing stored
//     impact {id}                                          (pricing.view)     what publishing would do to organisations on the licence model
//     saveContract {orgId, ...}                            (pricing.manage; discount approvals need pricing.publish)
//     saveCostModel {...}                                  (pricing.manage)
//     margin {revenueMonthly, usage, orgs}                 (pricing.view)
// Nothing here charges a customer or changes checkout, webhooks or an existing subscription.
const err = (e) => NextResponse.json({ error: e?.message || "Failed" }, { status: e?.status || 500 });

export async function GET(req) {
  try {
    await requirePlatformPermission(req, "pricing.view");
    const [listing, contracts, costModel] = await Promise.all([listBooks(), listContracts(), getCostModel()]);
    const books = listing.books.map((b) => ({ ...b, problems: validateBook(b.book), advice: adviceFor(b.book), cliffs: cliffReport(b.book) }));
    return NextResponse.json({ ...listing, books, contracts, costModel, proposed: PROPOSED_BOOK, proposedAdvice: adviceFor(PROPOSED_BOOK), proposedCliffs: cliffReport(PROPOSED_BOOK) });
  } catch (e) { return err(e); }
}

export async function POST(req) {
  try {
    const b = await req.json();
    const a = b.action;
    if (["approve", "sendBack"].includes(a)) {
      const actor = await requirePlatformPermission(req, "pricing.publish");
      return NextResponse.json(a === "approve" ? await approveSubmission(actor, b.id) : await rejectSubmission(actor, b.id, b.note));
    }
    if (["preview", "impact", "margin"].includes(a)) {
      await requirePlatformPermission(req, "pricing.view");
      if (a === "margin") return NextResponse.json(marginFor({ revenueMonthly: b.revenueMonthly, usage: b.usage || {}, orgs: Number(b.orgs) || 1, costModel: await getCostModel() }));
      const listing = await listBooks();
      const doc = b.id ? listing.books.find((x) => x.id === b.id) : null;
      if (b.id && !doc) return NextResponse.json({ error: "Version not found." }, { status: 404 });
      if (a === "impact") return NextResponse.json(await impactFor(doc, listing));
      const book = normalizeBook(doc ? doc.book : b.book || PROPOSED_BOOK);
      return NextResponse.json(quote(book, { counts: b.counts || {}, faceGpsCount: b.faceGpsCount || 0, cycle: b.cycle, employees: b.employees, date: todayIst() }, b.contract || null));
    }
    const actor = await requirePlatformPermission(req, "pricing.manage");
    switch (a) {
      case "createDraft": return NextResponse.json(await createDraft(actor, b));
      case "updateDraft": return NextResponse.json(await updateDraft(actor, b.id, b));
      case "discardDraft": return NextResponse.json(await discardDraft(actor, b.id));
      case "submit": return NextResponse.json(await submitDraft(actor, b.id, String(b.effectiveFrom || "")));
      case "saveCostModel": return NextResponse.json(await saveCostModel(actor, b));
      case "saveContract": {
        let approvals = false;
        try { await requirePlatformPermission(req, "pricing.publish"); approvals = true; } catch { approvals = false; }
        return NextResponse.json(await saveContract(actor, String(b.orgId || ""), b, { approvals }));
      }
      default: return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) { return err(e); }
}
