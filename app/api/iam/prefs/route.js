import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireOrgManager, adminDb } from "@/lib/firebaseAdmin";
import { cleanColumns, DEFAULT_COLUMNS, USER_COLUMNS } from "@/lib/adminColumns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The signed-in ADMINISTRATOR's own Admin Center preferences (today: Active users columns). The owner of a preference is always the caller; no uid is
// ever read from the request, and everything stored is re-validated against the shared catalogue.
//   GET            -> { activeUsers: { columns } , defaults, catalog }
//   PUT { activeUsers: { columns } }  or  { reset: true }
export async function GET(req) {
  try {
    const c = await requireOrgManager(req);
    const snap = await adminDb().doc("users/" + c.uid).get();
    const stored = snap.exists ? snap.data()?.adminPrefs?.activeUsers : null;
    return NextResponse.json({
      activeUsers: { columns: cleanColumns(stored?.columns) }, defaults: DEFAULT_COLUMNS,
      catalog: USER_COLUMNS.map(({ key, label, locked, default: d }) => ({ key, label, locked: !!locked, default: !!d })),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function PUT(req) {
  try {
    const c = await requireOrgManager(req);
    const b = await req.json().catch(() => ({}));
    const ref = adminDb().doc("users/" + c.uid);
    if (b.reset === true) {
      await ref.set({ adminPrefs: { activeUsers: FieldValue.delete() } }, { merge: true });
      return NextResponse.json({ ok: true, activeUsers: { columns: [...DEFAULT_COLUMNS] } });
    }
    const columns = cleanColumns(b?.activeUsers?.columns);
    await ref.set({ adminPrefs: { activeUsers: { columns, updatedAt: FieldValue.serverTimestamp() } } }, { merge: true });
    return NextResponse.json({ ok: true, activeUsers: { columns } });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
