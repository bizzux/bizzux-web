import { NextResponse } from "next/server";
import { requireOrgManager } from "@/lib/firebaseAdmin";
import { listContacts, saveContact, deleteContact } from "@/lib/iam/contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Contacts (people with no Bizzux login). GET list, POST create, PUT update ({ id, ...fields }), DELETE ({ id }). Company admins act on their own company only.
const fail = (e) => NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
export async function GET(req) {
  try { const c = await requireOrgManager(req); return NextResponse.json({ contacts: await listContacts({ actor: c, organizationId: new URL(req.url).searchParams.get("organizationId") || "" }) }); } catch (e) { return fail(e); }
}
export async function POST(req) {
  try { const c = await requireOrgManager(req); const b = await req.json(); return NextResponse.json(await saveContact({ actor: c, organizationId: b.organizationId, data: b })); } catch (e) { return fail(e); }
}
export async function PUT(req) {
  try { const c = await requireOrgManager(req); const b = await req.json(); return NextResponse.json(await saveContact({ actor: c, organizationId: b.organizationId, id: String(b.id || ""), data: b })); } catch (e) { return fail(e); }
}
export async function DELETE(req) {
  try { const c = await requireOrgManager(req); const b = await req.json().catch(() => ({})); return NextResponse.json(await deleteContact({ actor: c, organizationId: b.organizationId, id: String(b.id || "") })); } catch (e) { return fail(e); }
}
