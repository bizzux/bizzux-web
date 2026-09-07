import { NextResponse } from "next/server";
import { adminDb, requireAccountWithAppsAccess } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NAME_LEN = 100;

function foldersCollection(accountId) {
  return adminDb().collection("customers/" + accountId + "/textFolders");
}
function filesCollection(accountId) {
  return adminDb().collection("customers/" + accountId + "/textFiles");
}

function toIso(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
}

export async function GET(req) {
  try {
    const acct = await requireAccountWithAppsAccess(req);
    const snap = await foldersCollection(acct.accountId).orderBy("createdAt", "asc").get();
    const folders = snap.docs.map((d) => ({ id: d.id, name: d.data().name, createdAt: toIso(d.data().createdAt) }));
    return NextResponse.json({ folders });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const acct = await requireAccountWithAppsAccess(req);
    const body = await req.json();

    if (body.action === "create") {
      const name = String(body.name || "").trim().slice(0, MAX_NAME_LEN);
      if (!name) throw { status: 400, message: "Folder name is required" };
      const ref = await foldersCollection(acct.accountId).add({ name, createdAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ id: ref.id });
    }

    if (body.action === "rename") {
      const id = String(body.id || "");
      const name = String(body.name || "").trim().slice(0, MAX_NAME_LEN);
      if (!id || !name) throw { status: 400, message: "Folder id and new name are required" };
      const ref = foldersCollection(acct.accountId).doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Folder not found" };
      await ref.update({ name });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete") {
      const id = String(body.id || "");
      if (!id) throw { status: 400, message: "Folder id required" };
      const ref = foldersCollection(acct.accountId).doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Folder not found" };

      // Files inside are un-filed, never deleted — a folder is just an
      // organizational label on a file, not a container that owns it.
      const filesSnap = await filesCollection(acct.accountId).where("folderId", "==", id).get();
      const batch = adminDb().batch();
      filesSnap.docs.forEach((d) => batch.update(d.ref, { folderId: null }));
      batch.delete(ref);
      await batch.commit();

      return NextResponse.json({ ok: true, unfiledCount: filesSnap.size });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
