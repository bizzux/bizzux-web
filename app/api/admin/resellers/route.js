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
function toIso(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
}

export async function GET(req) {
  try {
    await requireSuperAdmin(req);
    const url = new URL(req.url);
    const resellerIdParam = url.searchParams.get("resellerId");

    // Detail mode: one partner's promo codes + full commission ledger, for
    // the "view sales / approve / reverse commissions" drill-down — not
    // fetched for every row in the bulk list below (would be an N+1 read
    // per partner otherwise).
    if (resellerIdParam) {
      const [codesSnap, commissionsSnap, payoutsSnap] = await Promise.all([
        adminDb().collection("promoCodes").where("resellerId", "==", resellerIdParam).orderBy("createdAt", "desc").get(),
        adminDb().collection("resellerCommissions").where("resellerId", "==", resellerIdParam).orderBy("createdAt", "desc").get(),
        adminDb().collection("resellerPayouts").where("resellerId", "==", resellerIdParam).orderBy("createdAt", "desc").get(),
      ]);
      const codes = codesSnap.docs.map((d) => ({ code: d.id, ...d.data(), createdAt: toIso(d.data().createdAt), usedAt: toIso(d.data().usedAt) }));
      const commissions = commissionsSnap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: toIso(d.data().createdAt), paidAt: toIso(d.data().paidAt) }));
      const payouts = payoutsSnap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: toIso(d.data().createdAt) }));
      return NextResponse.json({ codes, commissions, payouts });
    }

    const [resellersSnap, settingsSnap, allCodesSnap] = await Promise.all([
      adminDb().collection("resellers").orderBy("createdAt", "desc").get(),
      adminDb().doc("portalSettings/config").get(),
      adminDb().collection("promoCodes").get(),
    ]);
    // Codes-generated/used counts per partner, computed here rather than
    // with a separate query per row.
    const codeCounts = {};
    allCodesSnap.docs.forEach((d) => {
      const data = d.data();
      const bucket = codeCounts[data.resellerId] || (codeCounts[data.resellerId] = { generated: 0, used: 0 });
      bucket.generated += 1;
      if (data.used) bucket.used += 1;
    });
    const resellers = resellersSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      codesGenerated: codeCounts[d.id]?.generated || 0,
      codesUsed: codeCounts[d.id]?.used || 0,
    }));
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

      // Both "pending" and "approved" — approving a commission (see
      // "approveCommission" below) is a record-keeping step, not a
      // separate payout queue, so either status still owes this payout.
      const owedCommissions = await adminDb()
        .collection("resellerCommissions")
        .where("resellerId", "==", id)
        .where("status", "in", ["pending", "approved"])
        .get();
      const batch = adminDb().batch();
      owedCommissions.docs.forEach((d) => {
        batch.set(d.ref, { status: "paid", paidAt: FieldValue.serverTimestamp() }, { merge: true });
      });
      if (!owedCommissions.empty) await batch.commit();

      await adminDb().collection("resellerPayouts").add({
        resellerId: id,
        amount: paidAmount,
        createdAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({ ok: true, paidAmount });
    }

    // Per-partner override of the two global percentages — either field
    // can be sent as null to clear that partner's override and fall back
    // to the global default again (see resolvePartnerRates in
    // lib/referral.js, which every promo-code generation and commission
    // credit already reads through instead of the global setting alone).
    if (action === "setPartnerRates") {
      if (!id) throw { status: 400, message: "Reseller id required" };
      const ref = adminDb().doc("resellers/" + id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Reseller not found" };

      const update = {};
      if (body.commissionPercent === null) {
        update.commissionPercent = FieldValue.delete();
      } else if (body.commissionPercent !== undefined) {
        const n = Number(body.commissionPercent);
        if (!Number.isFinite(n) || n <= 0 || n > 100) throw { status: 400, message: "Commission must be a percent between 1 and 100" };
        update.commissionPercent = n;
      }
      if (body.customerDiscountPercent === null) {
        update.customerDiscountPercent = FieldValue.delete();
      } else if (body.customerDiscountPercent !== undefined) {
        const n = Number(body.customerDiscountPercent);
        if (!Number.isFinite(n) || n <= 0 || n > 100) throw { status: 400, message: "Discount must be a percent between 1 and 100" };
        update.customerDiscountPercent = n;
      }
      if (Object.keys(update).length === 0) throw { status: 400, message: "Nothing to save" };
      await ref.set(update, { merge: true });
      return NextResponse.json({ ok: true });
    }

    // Record-keeping only — flags a commission entry as reviewed and
    // confirmed legitimate. Doesn't move any balance (it was already
    // credited to pendingPayout at payment time — see creditResellerCommission
    // in the webhook handlers); "reverse" below is the one that claws money
    // back out.
    if (action === "approveCommission") {
      const commissionId = String(body.commissionId || "");
      if (!commissionId) throw { status: 400, message: "Commission id required" };
      const ref = adminDb().doc("resellerCommissions/" + commissionId);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Commission entry not found" };
      if (snap.data().status !== "pending") throw { status: 400, message: "Only a pending commission can be approved" };
      await ref.set({ status: "approved", approvedAt: FieldValue.serverTimestamp() }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    // Claws back a commission — e.g. the underlying subscription was
    // refunded/charged-back after the commission was already credited.
    // Subtracts it back out of the partner's totalEarnings/pendingPayout
    // (only out of pendingPayout if it hasn't already been paid out — a
    // reversal after payout just goes negative on paper here, matching
    // "reverse" being a manual, judgment-call action rather than something
    // this route tries to silently reconcile against a real payout).
    if (action === "reverseCommission") {
      const commissionId = String(body.commissionId || "");
      if (!commissionId) throw { status: 400, message: "Commission id required" };
      const ref = adminDb().doc("resellerCommissions/" + commissionId);

      await adminDb().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw { status: 404, message: "Commission entry not found" };
        const commission = snap.data();
        if (commission.status === "reversed") throw { status: 400, message: "Already reversed" };

        const resellerRef = adminDb().doc("resellers/" + commission.resellerId);
        tx.set(
          resellerRef,
          {
            totalEarnings: FieldValue.increment(-commission.commissionAmount),
            pendingPayout: FieldValue.increment(-commission.commissionAmount),
          },
          { merge: true }
        );
        tx.set(ref, { status: "reversed", reversedAt: FieldValue.serverTimestamp() }, { merge: true });
      });

      return NextResponse.json({ ok: true });
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
