import { NextResponse } from "next/server";
import { requireSuperAdmin, adminDb } from "@/lib/firebaseAdmin";
import { DEFAULT_RESELLER_DISCOUNT_PERCENT, DEFAULT_RESELLER_COMMISSION_PERCENT } from "@/lib/referral";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Super Admin -> Partners tab. Lists every reseller application alongside
// the two global numbers every referral code shares (see lib/referral.js),
// and handles approve/reject/suspend + marking a reseller's accumulated
// commission as paid out. The actual money transfer (bank/UPI) happens
// outside this app — see the "markPaid" action below for why.
export async function GET(req) {
  try {
    await requireSuperAdmin(req);
    const [resellersSnap, settingsSnap] = await Promise.all([
      adminDb().collection("resellers").orderBy("createdAt", "desc").get(),
      adminDb().doc("portalSettings/config").get(),
    ]);
    const resellers = resellersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const settings = settingsSnap.exists ? settingsSnap.data() : {};
    return NextResponse.json({
      resellers,
      resellerDiscountPercent: settings.resellerDiscountPercent ?? DEFAULT_RESELLER_DISCOUNT_PERCENT,
      resellerCommissionPercent: settings.resellerCommissionPercent ?? DEFAULT_RESELLER_COMMISSION_PERCENT,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json();
    const { action, id } = body;

    if (action === "approve" || action === "reject" || action === "suspend") {
      if (!id) throw { status: 400, message: "Reseller id required" };
      const ref = adminDb().doc("resellers/" + id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Reseller not found" };
      const reseller = snap.data();

      const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "suspended";
      const codeActive = action === "approve";

      await ref.set({ status }, { merge: true });
      if (reseller.referralCode) {
        await adminDb().doc("referralCodes/" + reseller.referralCode).set({ active: codeActive }, { merge: true });
      }
      return NextResponse.json({ ok: true });
    }

    // Removes the Partner application and its referral code entirely —
    // distinct from "reject"/"suspend", which keep the record around but
    // deactivate the code. Deleting resellers/{id} is also what the public
    // Partners page keys off (see app/api/reseller/me's `registered` check),
    // so once this runs, that person's next visit to /partners shows the
    // initial "apply" form again rather than a pending/rejected state — they
    // can re-apply and get a fresh code from scratch. Existing commission
    // ledger entries (resellerCommissions) are left alone since they're a
    // record of money already earned/paid, independent of the application.
    if (action === "delete") {
      if (!id) throw { status: 400, message: "Reseller id required" };
      const ref = adminDb().doc("resellers/" + id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Reseller not found" };
      const reseller = snap.data();

      const batch = adminDb().batch();
      batch.delete(ref);
      if (reseller.referralCode) {
        batch.delete(adminDb().doc("referralCodes/" + reseller.referralCode));
      }
      await batch.commit();

      return NextResponse.json({ ok: true });
    }

    // Zeroes out a reseller's pending balance and moves it to paidOut, and
    // marks every "pending" ledger entry (resellerCommissions) as "paid" —
    // this is purely a record-keeping action for money already sent
    // manually (bank transfer / UPI) outside this app; it doesn't move any
    // money itself. See app/api/webhooks/razorpay+stripe for where
    // commission entries get created.
    if (action === "markPaid") {
      if (!id) throw { status: 400, message: "Reseller id required" };
      const ref = adminDb().doc("resellers/" + id);

      let paidAmount = 0;
      await adminDb().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw { status: 404, message: "Reseller not found" };
        const reseller = snap.data();
        paidAmount = Number(reseller.pendingPayout || 0);
        if (paidAmount <= 0) throw { status: 400, message: "Nothing pending to pay out" };
        tx.set(ref, { pendingPayout: 0, paidOut: FieldValue.increment(paidAmount) }, { merge: true });
      });

      const pendingCommissions = await adminDb()
        .collection("resellerCommissions")
        .where("resellerId", "==", id)
        .where("status", "==", "pending")
        .get();
      const batch = adminDb().batch();
      pendingCommissions.docs.forEach((d) => {
        batch.set(d.ref, { status: "paid", paidAt: FieldValue.serverTimestamp() }, { merge: true });
      });
      if (!pendingCommissions.empty) await batch.commit();

      return NextResponse.json({ ok: true, paidAmount });
    }

    if (action === "saveSettings") {
      const update = {};
      if (body.resellerDiscountPercent !== undefined) {
        const n = Number(body.resellerDiscountPercent);
        if (!Number.isFinite(n) || n <= 0 || n > 100) {
          throw { status: 400, message: "Discount must be a percent between 1 and 100" };
        }
        update.resellerDiscountPercent = n;
      }
      if (body.resellerCommissionPercent !== undefined) {
        const n = Number(body.resellerCommissionPercent);
        if (!Number.isFinite(n) || n <= 0 || n > 100) {
          throw { status: 400, message: "Commission must be a percent between 1 and 100" };
        }
        update.resellerCommissionPercent = n;
      }
      if (Object.keys(update).length === 0) throw { status: 400, message: "Nothing to save" };
      await adminDb().doc("portalSettings/config").set(update, { merge: true });
      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
