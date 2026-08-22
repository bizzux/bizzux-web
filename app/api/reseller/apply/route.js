import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { generateReferralCode } from "@/lib/referral";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public application for the Partners program (app/(marketing)/partners) —
// any signed-in customer can apply. Their referral code is generated here
// but starts INACTIVE (see lib/referral.js's generateReferralCode) and
// their status starts "pending": nothing they get is usable at checkout
// until a Super Admin approves them in Admin -> Super Admin -> Partners
// (app/api/admin/resellers/route.js), which is what flips both the
// reseller's status and their code's active flag together. This keeps a
// freshly self-registered account from immediately being able to earn
// commission before anyone's looked at it.
export async function POST(req) {
  try {
    const c = await requireUser(req);
    const body = await req.json();

    const fullName = String(body.fullName || "").trim();
    if (!fullName) throw { status: 400, message: "Your name is required" };
    // The Partners page offers an OTP check on this field (see
    // /api/reseller/send-otp + /api/reseller/verify-otp) but doesn't
    // currently require it to be completed before Submit — an applicant can
    // send themselves a code without confirming it. Still required here so
    // every Partner record has a payout-contact number on file.
    const phone = String(body.phone || "").trim();
    if (!phone) throw { status: 400, message: "A phone number is required" };
    const businessName = String(body.businessName || "").trim();
    const payoutMethod = body.payoutMethod === "bank" ? "bank" : "upi";

    let payoutDetails = {};
    if (payoutMethod === "upi") {
      const upiId = String(body.upiId || "").trim();
      if (!upiId) throw { status: 400, message: "A UPI ID is required" };
      payoutDetails = { upiId };
    } else {
      const accountHolder = String(body.accountHolder || "").trim();
      const accountNumber = String(body.accountNumber || "").trim();
      const ifsc = String(body.ifsc || "").trim().toUpperCase();
      if (!accountHolder || !accountNumber || !ifsc) {
        throw { status: 400, message: "Account holder name, account number and IFSC are all required" };
      }
      payoutDetails = { accountHolder, accountNumber, ifsc };
    }

    const resellerRef = adminDb().doc("resellers/" + c.uid);
    const existing = await resellerRef.get();
    if (existing.exists) {
      const data = existing.data();
      return NextResponse.json({ ok: true, status: data.status, referralCode: data.referralCode });
    }

    const referralCode = await generateReferralCode();

    await adminDb().doc("referralCodes/" + referralCode).set({
      resellerId: c.uid,
      active: false, // flips true on Super Admin approval
      createdAt: FieldValue.serverTimestamp(),
    });

    await resellerRef.set({
      fullName,
      email: c.email,
      phone,
      businessName: businessName || null,
      payoutMethod,
      payoutDetails,
      referralCode,
      status: "pending",
      totalReferrals: 0,
      totalEarnings: 0,
      pendingPayout: 0,
      paidOut: 0,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, status: "pending", referralCode });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
