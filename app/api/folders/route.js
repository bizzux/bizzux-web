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

// Would `candidateId` end up inside its own subtree if moved under
// `newParentId`? Walks up newParentId's ancestor chain looking for
// candidateId — used to block a folder being dropped into itself or one of
// its own descendants.
async function wouldCreateCycle(accountId, candidateId, newParentId) {
  let cur = newParentId;
  const col = foldersCollection(accountId);
  const seen = new Set();
  while (cur) {
    if (cur === candidateId) return true;
    if (seen.has(cur)) return true; // defensive: pre-existing cycle, bail rather than loop forever
    seen.add(cur);
    const snap = await col.doc(cur).get();
    if (!snap.exists) return false;
    cur = snap.data().parentId || null;
  }
  return false;
}

export async function GET(req) {
  try {
    const acct = await requireAccountWithAppsAccess(req);
    const snap = await foldersCollection(acct.accountId).orderBy("createdAt", "asc").get();
    const folders = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((f) => !f.deletedAt)
      .map((f) => ({ id: f.id, name: f.name, parentId: f.parentId || null, createdAt: toIso(f.createdAt) }));
    return NextResponse.json({ folders });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const acct = await requireAccountWithAppsAccess(req);
    const body = await req.json();
    const folders = foldersCollection(acct.accountId);

    if (body.action === "create") {
      const name = String(body.name || "").trim().slice(0, MAX_NAME_LEN);
      const parentId = body.parentId ? String(body.parentId) : null;
      if (!name) throw { status: 400, message: "Folder name is required" };
      if (parentId) {
        const parentSnap = await folders.doc(parentId).get();
        if (!parentSnap.exists || parentSnap.data().deletedAt) throw { status: 400, message: "Parent folder not found" };
      }
      const ref = await folders.add({ name, parentId, createdAt: FieldValue.serverTimestamp(), deletedAt: null });
      return NextResponse.json({ id: ref.id });
    }

    if (body.action === "rename") {
      const id = String(body.id || "");
      const name = String(body.name || "").trim().slice(0, MAX_NAME_LEN);
      if (!id || !name) throw { status: 400, message: "Folder id and new name are required" };
      const ref = folders.doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Folder not found" };
      await ref.update({ name });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "move") {
      const id = String(body.id || "");
      const parentId = body.parentId ? String(body.parentId) : null;
      if (!id) throw { status: 400, message: "Folder id required" };
      if (parentId === id) throw { status: 400, message: "A folder can't be its own parent" };
      const ref = folders.doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Folder not found" };
      if (parentId) {
        const parentSnap = await folders.doc(parentId).get();
        if (!parentSnap.exists || parentSnap.data().deletedAt) throw { status: 400, message: "Parent folder not found" };
        if (await wouldCreateCycle(acct.accountId, id, parentId)) {
          throw { status: 400, message: "Can't move a folder inside itself or one of its own subfolders" };
        }
      }
      await ref.update({ parentId });
      return NextResponse.json({ ok: true });
    }

    // Soft delete: the folder AND everything nested under it (subfolders,
    // recursively, plus every file in any of them) move to the recycle bin
    // together, mirroring how deleting a folder works in a normal file
    // manager. Nothing is permanently removed here — see /api/trash for
    // restore / permanent delete / empty.
    if (body.action === "delete" || body.action === "deleteMany") {
      const ids = body.action === "deleteMany" ? (Array.isArray(body.ids) ? body.ids.map(String) : []) : [String(body.id || "")];
      if (ids.length === 0 || ids.some((i) => !i)) throw { status: 400, message: "Folder id(s) required" };

      const allFoldersSnap = await folders.get();
      const byParent = new Map();
      allFoldersSnap.docs.forEach((d) => {
        const pid = d.data().parentId || null;
        if (!byParent.has(pid)) byParent.set(pid, []);
        byParent.get(pid).push(d.id);
      });

      const toTrashFolderIds = new Set();
      function collectDescendants(id) {
        if (toTrashFolderIds.has(id)) return;
        toTrashFolderIds.add(id);
        (byParent.get(id) || []).forEach(collectDescendants);
      }
      ids.forEach(collectDescendants);

      const now = FieldValue.serverTimestamp();
      const batch = adminDb().batch();
      toTrashFolderIds.forEach((id) => batch.update(folders.doc(id), { deletedAt: now }));

      // Files directly inside any trashed folder also go to the bin.
      let filesTrashed = 0;
      for (const folderId of toTrashFolderIds) {
        const filesSnap = await filesCollection(acct.accountId).where("folderId", "==", folderId).get();
        filesSnap.docs.forEach((d) => {
          if (!d.data().deletedAt) {
            batch.update(d.ref, { deletedAt: now });
            filesTrashed++;
          }
        });
      }
      await batch.commit();

      return NextResponse.json({ ok: true, foldersTrashed: toTrashFolderIds.size, filesTrashed });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
