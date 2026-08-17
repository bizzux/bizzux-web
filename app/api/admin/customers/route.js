import { NextResponse } from "next/server";
import { requireSuperAdmin, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIso(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  return ts;
}

export async function GET(req) {
  try {
    await requireSuperAdmin(req);
    const snap = await adminDb().collection("customers").get();
    const customers = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        email: data.email || "",
        status: data.status || "trial",
        planName: data.planName || null,
        createdAt: toIso(data.createdAt),
        trialEndDate: toIso(data.trialEndDate),
      };
    });
    customers.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return NextResponse.json({ customers });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
