import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireUser, adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Starts the free trial for a business owner whose org is "trial_pending".
//
// No SMS / phone step any more (Firebase phone auth is switched off). The
// owner's login email is already verified by the normal sign-up flow, so the
// trial starts on one click. To keep it to one trial per person, the
// normalised email (Gmail dots and +tags ignored) is claimed in
// trialEmails/{hash} inside the same transaction and never released, even if
// the account is later deleted.
//
// A login that still has a Firebase-verified phone number from the earlier
// SMS flow keeps its number claim in trialPhones/{E.164}, as before.
function emailKey(email) {
  let [local, domain] = String(email || "").toLowerCase().trim().split("@");
  if (!local || !domain) return null;
  local = local.split("+")[0];
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return createHash("sha256").update(local + "@" + domain).digest("hex");
}

export async function POST(req) {
  try {
    const c = await requireUser(req);
    const key = emailKey(c.email);
    if (!key) throw { status: 400, message: "Your login has no email address." };
    const ref = adminDb().doc("customers/" + c.uid);
    const user = await adminAuth().getUser(c.uid);
    const phone = user.phoneNumber || null;

    const settingsSnap = await adminDb().doc("portalSettings/config").get();
    const trialDays = Number((settingsSnap.exists ? settingsSnap.data().trialDays : null) ?? 30) || 30;
    const emailRef = adminDb().doc("trialEmails/" + key);
    const phoneRef = phone ? adminDb().doc("trialPhones/" + phone) : null;

    let endDate;
    await adminDb().runTransaction(async (tx) => {
      const [custSnap, emailSnap, phoneSnap] = await Promise.all([tx.get(ref), tx.get(emailRef), phoneRef ? tx.get(phoneRef) : null]);
      if (!custSnap.exists) throw { status: 404, message: "Set up your business first." };
      const customer = custSnap.data();
      if (customer.status !== "trial_pending") {
        throw { status: 409, code: "TRIAL_NOT_AVAILABLE", message: "A free trial isn't available for this account. Choose a plan, or contact us if you need more time to evaluate." };
      }
      if (emailSnap.exists && emailSnap.data().uid !== c.uid) {
        throw { status: 409, code: "EMAIL_USED", message: "This email address has already been used for a Bizzux free trial. Choose a plan, or contact us if you think this is a mistake." };
      }
      if (phoneSnap?.exists && phoneSnap.data().uid !== c.uid) {
        throw { status: 409, code: "PHONE_USED", message: "This mobile number has already been used for a Bizzux free trial. Choose a plan, or contact us if you think this is a mistake." };
      }
      const now = Timestamp.now();
      endDate = Timestamp.fromMillis(now.toMillis() + trialDays * 24 * 60 * 60 * 1000);
      tx.set(emailRef, { uid: c.uid, claimedAt: FieldValue.serverTimestamp() });
      if (phoneRef) tx.set(phoneRef, { uid: c.uid, email: c.email, claimedAt: FieldValue.serverTimestamp() });
      tx.set(ref, {
        status: "trial",
        trialStartDate: now,
        trialEndDate: endDate,
        ...(phone ? { trialPhone: phone, phone, phoneVerified: true } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    await logAuditEvent({ action: "customer.trial_start", actor: c, targetType: "organization", targetId: c.uid, details: { trialDays } });
    return NextResponse.json({ ok: true, trialEndDate: endDate.toDate().toISOString(), trialDays });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed", ...(e.code ? { code: e.code } : {}) }, { status: e.status || 500 });
  }
}
