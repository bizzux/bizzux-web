import { NextResponse } from "next/server";
import { requireSuperAdmin, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_METHODS = ["email", "mobile"];

export async function GET(req) {
  try {
    await requireSuperAdmin(req);
    const snap = await adminDb().doc("portalSettings/config").get();
    const data = snap.exists ? snap.data() : {};
    const trialDays = data.trialDays;
    const verificationMethod = VALID_METHODS.includes(data.verificationMethod) ? data.verificationMethod : "email";
    return NextResponse.json({ trialDays: trialDays ?? 14, verificationMethod });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

// Accepts either field on its own so Trial settings and the verification
// method toggle can each save independently, or together.
export async function POST(req) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json();
    const update = {};

    if (body.trialDays !== undefined) {
      const n = Number(body.trialDays);
      if (!Number.isFinite(n) || n < 1) {
        throw { status: 400, message: "Trial length must be a positive number of days" };
      }
      update.trialDays = n;
    }

    if (body.verificationMethod !== undefined) {
      if (!VALID_METHODS.includes(body.verificationMethod)) {
        throw { status: 400, message: "Verification method must be \"email\" or \"mobile\"" };
      }
      update.verificationMethod = body.verificationMethod;
    }

    if (Object.keys(update).length === 0) {
      throw { status: 400, message: "Nothing to save" };
    }

    await adminDb().doc("portalSettings/config").set(update, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
