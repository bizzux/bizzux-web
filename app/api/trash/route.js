import { NextResponse } from "next/server";
import { adminDb, requireAccountWithAppsAccess } from "@/lib/firebaseAdmin";
import { del } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

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

async function permanentlyDeleteFile(ref, data) {
  if (data.blobPath) {
    await del(data.blobPath).catch((e) => console.error("Trash purge: failed to delete blob", data.blobPath, e.message || e));
  }
  await ref.delete();
}

// No background job runs this — anything past its 30-day retention gets
// purged lazily, the moment anyone next opens the recycle bin. Simpler than
// standing up a cron for what's a low-stakes cleanup, and just as effective
// in practice since the bin has to be opened to restore/empty it anyway.
async function purgeExpired(accountId) {
  const cutoff = Date.now() - RETENTION_MS;
  const [folderSnap, fileSnap] = await Promise.all([
    foldersCollection(accountId).get(),
    filesCollection(accountId).get(),
  ]);

  const expiredFolders = folderSnap.docs.filter((d) => {
    const deletedAt = d.data().deletedAt;
    return deletedAt?.toDate && deletedAt.toDate().getTime() < cutoff;
  });
  const expiredFiles = fileSnap.docs.filter((d) => {
    const deletedAt = d.data().deletedAt;
    return deletedAt?.toDate && deletedAt.toDate().getTime() < cutoff;
  });

  await Promise.all(expiredFiles.map((d) => permanentlyDeleteFile(d.ref, d.data())));
  if (expiredFolders.length > 0) {
    const batch = adminDb().batch();
    expiredFolders.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

export async function GET(req) {
  try {
    const acct = await requireAccountWithAppsAccess(req);
    await purgeExpired(acct.accountId);

    const [folderSnap, fileSnap] = await Promise.all([
      foldersCollection(acct.accountId).get(),
      filesCollection(acct.accountId).get(),
    ]);

    const items = [
      ...folderSnap.docs
        .filter((d) => d.data().deletedAt)
        .map((d) => ({ type: "folder", id: d.id, title: d.data().name, deletedAt: toIso(d.data().deletedAt) })),
      ...fileSnap.docs
        .filter((d) => d.data().deletedAt)
        .map((d) => ({
          type: "file",
          id: d.id,
          title: d.data().title,
          ext: d.data().ext || "txt",
          sizeBytes: d.data().sizeBytes || 0,
          deletedAt: toIso(d.data().deletedAt),
        })),
    ].sort((a, b) => (b.deletedAt || "").localeCompare(a.deletedAt || ""));

    return NextResponse.json({ items, retentionDays: RETENTION_DAYS });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const acct = await requireAccountWithAppsAccess(req);
    const body = await req.json();

    if (body.action === "restore") {
      const { type, id } = body;
      if (!type || !id) throw { status: 400, message: "type and id required" };
      const col = type === "folder" ? foldersCollection(acct.accountId) : filesCollection(acct.accountId);
      const ref = col.doc(String(id));
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Item not found" };
      await ref.update({ deletedAt: null });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "permanentDelete") {
      const { type, id } = body;
      if (!type || !id) throw { status: 400, message: "type and id required" };
      if (type === "folder") {
        const ref = foldersCollection(acct.accountId).doc(String(id));
        const snap = await ref.get();
        if (!snap.exists) throw { status: 404, message: "Item not found" };
        await ref.delete();
      } else {
        const ref = filesCollection(acct.accountId).doc(String(id));
        const snap = await ref.get();
        if (!snap.exists) throw { status: 404, message: "Item not found" };
        await permanentlyDeleteFile(ref, snap.data());
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "emptyTrash") {
      // In-memory filter, same as GET above — safer than a Firestore "!="
      // query here, since older docs created before `deletedAt` existed on
      // every doc would have the field missing entirely rather than null,
      // and "!=" semantics around missing fields aren't worth relying on.
      const [folderSnap, fileSnap] = await Promise.all([
        foldersCollection(acct.accountId).get(),
        filesCollection(acct.accountId).get(),
      ]);
      const trashedFolders = folderSnap.docs.filter((d) => d.data().deletedAt);
      const trashedFiles = fileSnap.docs.filter((d) => d.data().deletedAt);

      await Promise.all(trashedFiles.map((d) => permanentlyDeleteFile(d.ref, d.data())));
      if (trashedFolders.length > 0) {
        const batch = adminDb().batch();
        trashedFolders.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      return NextResponse.json({ ok: true, foldersDeleted: trashedFolders.length, filesDeleted: trashedFiles.length });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
