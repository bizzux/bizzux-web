import { NextResponse } from "next/server";
import { requireSuperAdmin, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    await requireSuperAdmin(req);
    const snap = await adminDb().doc("portalSettings/config").get();
    const trialDays = snap.exists ? snap.data().trialDays : 14;
    return NextResponse.json({ trialDays: trialDays ?? 14 });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    await requireSuperAdmin(req);
    const { trialDays } = await req.json();
    const n = Number(trialDays);
    if (!Number.isFinite(n) || n < 1) {
      throw { status: 400, message: "Trial length must be a positive number of days" };
    }
    await adminDb().doc("portalSettings/config").set({ trialDays: n }, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
