import { NextResponse } from "next/server";
import { requireUser, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CURRENCIES = ["INR", "USD", "GBP", "AED"];
const BUSINESS_TYPES = ["shop", "travel", "medical", "services"];
const USE_CASES = ["work", "team", "personal"];

// Saves the "Getting Started" wizard answers onto the caller's own
// customers/{uid} doc. Only account owners have one of these — team
// members invited later don't go through onboarding.
export async function POST(req) {
  try {
    const c = await requireUser(req);
    const ref = adminDb().doc("customers/" + c.uid);
    const snap = await ref.get();
    if (!snap.exists) throw { status: 404, message: "No account found for this sign-in" };

    const body = await req.json();

    if (body.skip) {
      await ref.set({ onboarded: true }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    const companyName = String(body.companyName || "").trim().slice(0, 120);
    if (!companyName) throw { status: 400, message: "Company name is required" };
    const jobTitle = String(body.jobTitle || "").trim().slice(0, 80);
    const useCase = USE_CASES.includes(body.useCase) ? body.useCase : "work";
    const employeeCount = String(body.employeeCount || "").trim().slice(0, 40);
    const timezone = String(body.timezone || "Asia/Kolkata").trim().slice(0, 60);
    const language = String(body.language || "English").trim().slice(0, 40);
    const currency = CURRENCIES.includes(body.currency) ? body.currency : "INR";
    const businessType = BUSINESS_TYPES.includes(body.businessType) ? body.businessType : "shop";

    await ref.set(
      {
        companyName,
        // organizationName is the canonical field every app (Projects, Chat,
        // Notes, Files) and the team-invite email read for "which company is
        // this" — keep it in lockstep with companyName so onboarding doesn't
        // leave a second, unsynced name floating around (see api/me/route.js
        // and api/organizations/route.js, which also write this field).
        organizationName: companyName,
        jobTitle,
        useCase,
        employeeCount,
        timezone,
        language,
        currency,
        businessType,
        onboarded: true,
        onboardedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
