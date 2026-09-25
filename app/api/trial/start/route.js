import { NextResponse } from "next/server";
import { requireUser, adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Starts the free trial for a business owner whose org is "trial_pending".
// The client first links a phone number to the Firebase login with an SMS
// code (linkWithPhoneNumber in components/StartTrialModal.jsx). Here we
// read that number from Firebase Auth itself, never from the request body,
// so it's always a number the person actually proved they own.
//
// One trial per phone number, ever: trialPhones/{E.164} is claimed in a
// transaction and never released, even if the account is later deleted.
// Firebase also refuses to link one number to two logins, which blocks the
// same thing from the other side.
export async function POST(req) {
  try {
    const c = await requireUser(req);
    const ref = adminDb().doc("customers/" + c.uid);
    const user = await adminAuth().getUser(c.uid);
    const phone = user.phoneNumber;
    if (!phone) throw { status: 400, message: "Verify your mobile number first." };

    const settingsSnap = await adminDb().doc("portalSettings/config").get();
    const trialDays = Number((settingsSnap.exists ? settingsSnap.data().trialDays : null) ?? 30) || 30;
    const phoneRef = adminDb().doc("trialPhones/" + phone);

    let endDate;
    await adminDb().runTransaction(async (tx) => {
      const [custSnap, phoneSnap] = await Promise.all([tx.get(ref), tx.get(phoneRef)]);
      if (!custSnap.exists) throw { status: 404, message: "Set up your business first." };
      const customer = custSnap.data();
      if (customer.status !== "trial_pending") {
        throw { status: 409, code: "TRIAL_NOT_AVAILABLE", message: "A free trial isn't available for this account. Choose a plan, or contact us if you need more time to evaluate." };
      }
      if (phoneSnap.exists && phoneSnap.data().uid !== c.uid) {
        throw { status: 409, code: "PHONE_USED", message: "This mobile number has already been used for a Bizzux free trial. Choose a plan, or contact us if you think this is a mistake." };
      }
      const now = Timestamp.now();
      endDate = Timestamp.fromMillis(now.toMillis() + trialDays * 24 * 60 * 60 * 1000);
      tx.set(phoneRef, { uid: c.uid, email: c.email, claimedAt: FieldValue.serverTimestamp() });
      tx.set(ref, {
        status: "trial",
        trialStartDate: now,
        trialEndDate: endDate,
        trialPhone: phone,
        phone,
        phoneVerified: true,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    await logAuditEvent({ action: "customer.trial_start", actor: c, targetType: "organization", targetId: c.uid, details: { phone, trialDays } });
    return NextResponse.json({ ok: true, trialEndDate: endDate.toDate().toISOString(), trialDays });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed", ...(e.code ? { code: e.code } : {}) }, { status: e.status || 500 });
  }
}
