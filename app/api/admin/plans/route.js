import { NextResponse } from "next/server";
import { requireSuperAdmin, requireOrgManager, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read is available to anyone who can manage organizations (Super Admin,
// Global Admin, Admin) since the Add Organization form needs this list for
// its "Profile (plan)" dropdown. Writing/managing plans themselves — price,
// features, limits — stays Super Admin only below.
export async function GET(req) {
  try {
    await requireOrgManager(req);
    const snap = await adminDb().collection("plans").orderBy("sortOrder", "asc").get();
    const plans = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ plans });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json();
    const { action, id } = body;

    if (action === "create") {
      const { name, price, billingPeriod, description, features, popular, active, sortOrder, limits } = body;
      if (!name || price === undefined) throw { status: 400, message: "Name and price are required" };
      const ref = await adminDb().collection("plans").add({
        name, price: Number(price), billingPeriod: billingPeriod || "month",
        description: description || "", features: Array.isArray(features) ? features : [],
        popular: !!popular, active: active !== false, sortOrder: Number(sortOrder) || 0,
        limits: limits && typeof limits === "object" ? limits : {},
        createdAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: true, id: ref.id });
    }

    if (action === "update") {
      if (!id) throw { status: 400, message: "Plan id required" };
      const { name, price, billingPeriod, description, features, popular, active, sortOrder } = body;
      await adminDb().doc("plans/" + id).set({
        name, price: Number(price), billingPeriod: billingPeriod || "month",
        description: description || "", features: Array.isArray(features) ? features : [],
        popular: !!popular, active: active !== false, sortOrder: Number(sortOrder) || 0,
      }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    // Lightweight patch used by the Plan Limits tab — only touches the
    // `limits` map, so it can't accidentally clobber name/price/features
    // while someone's mid-edit on the main Plans tab.
    if (action === "setLimits") {
      if (!id) throw { status: 400, message: "Plan id required" };
      const { limits } = body;
      await adminDb().doc("plans/" + id).set({ limits: limits && typeof limits === "object" ? limits : {} }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      if (!id) throw { status: 400, message: "Plan id required" };
      await adminDb().doc("plans/" + id).delete();
      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
