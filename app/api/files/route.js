import { NextResponse } from "next/server";
import { adminDb, requireAccountWithAppsAccess } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CONTENT_BYTES = 2 * 1024 * 1024; // 2MB — comfortably covers even a very long transcript
const MAX_TITLE_LEN = 150;

function filesCollection(accountId) {
  return adminDb().collection("customers/" + accountId + "/textFiles");
}

function toIso(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
}

// Plain substring search, case-insensitive. Title is always searchable;
// `content` only exists for .txt/pasted files (Office/PDF uploads are
// stored as opaque blobs — see lib/files.js — so they're name-searchable
// only, not full-text). Good enough at the scale this app is built for
// (tens to low hundreds of files per account) without a real search index.
function matches(doc, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (doc.title || "").toLowerCase().includes(needle) || (doc.content || "").toLowerCase().includes(needle);
}

export async function GET(req) {
  try {
    const acct = await requireAccountWithAppsAccess(req);
    const params = new URL(req.url).searchParams;
    const q = params.get("q")?.trim() || "";
    // folderId: omitted = every file regardless of folder; "unfiled" = only
    // files with no folder; any other value = only that folder's files.
    const folderId = params.get("folderId");
    // dateFrom/dateTo: ISO date-times, inclusive, filtered on createdAt. The
    // client computes these from either a quick preset (today/7d/30d) or a
    // custom from/to range — this route just takes whatever bounds it's given.
    const dateFrom = params.get("dateFrom") ? new Date(params.get("dateFrom")) : null;
    const dateTo = params.get("dateTo") ? new Date(params.get("dateTo")) : null;

    const snap = await filesCollection(acct.accountId).orderBy("createdAt", "desc").get();
    const active = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((f) => !f.deletedAt);

    const files = active
      .filter((f) => matches(f, q))
      .filter((f) => {
        if (!folderId) return true;
        if (folderId === "unfiled") return !f.folderId;
        return f.folderId === folderId;
      })
      .filter((f) => {
        if (!dateFrom && !dateTo) return true;
        const created = f.createdAt?.toDate ? f.createdAt.toDate() : f.createdAt ? new Date(f.createdAt) : null;
        if (!created) return false;
        if (dateFrom && created < dateFrom) return false;
        if (dateTo && created > dateTo) return false;
        return true;
      })
      .map((f) => ({
        id: f.id,
        title: f.title,
        ext: f.ext || "txt",
        sizeBytes: f.sizeBytes || 0,
        createdAt: toIso(f.createdAt),
        folderId: f.folderId || null,
        hasContent: !!f.content,
        // A short snippet around the first match, so search results show
        // *why* a file matched without shipping its whole content.
        snippet: q && f.content ? snippetAround(f.content, q) : null,
      }));

    const totalSizeBytes = active.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);

    return NextResponse.json({ files, totalSizeBytes, totalCount: active.length });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

function snippetAround(content, q) {
  const idx = content.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - 60);
  const end = Math.min(content.length, idx + q.length + 60);
  return (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");
}

export async function POST(req) {
  try {
    const acct = await requireAccountWithAppsAccess(req);
    const body = await req.json();

    if (body.action === "create") {
      const title = String(body.title || "").trim().slice(0, MAX_TITLE_LEN);
      const folderId = body.folderId ? String(body.folderId) : null;
      if (!title) throw { status: 400, message: "File name is required" };

      const doc = {
        title,
        folderId,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: acct.uid,
        createdByEmail: acct.email,
        deletedAt: null,
      };

      if (body.blobPath) {
        // A binary upload (Word/Excel/PowerPoint/PDF/etc.) that already
        // landed in Vercel Blob via /api/files/blob-upload — this call just
        // records its metadata.
        doc.blobPath = String(body.blobPath);
        doc.contentType = body.contentType ? String(body.contentType) : "application/octet-stream";
        doc.ext = String(body.ext || "").toLowerCase().slice(0, 10) || "bin";
        doc.sizeBytes = Number(body.sizeBytes) || 0;
        doc.content = null;
      } else {
        // Plain text: uploaded .txt or pasted directly — stored inline so
        // it stays full-text searchable.
        const content = String(body.content || "");
        if (!content.trim()) throw { status: 400, message: "File content is empty" };
        if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
          throw { status: 400, message: "That file is too large (2MB limit)" };
        }
        doc.content = content;
        doc.ext = "txt";
        doc.sizeBytes = Buffer.byteLength(content, "utf8");
      }

      const ref = await filesCollection(acct.accountId).add(doc);
      return NextResponse.json({ id: ref.id });
    }

    if (body.action === "rename") {
      const id = String(body.id || "");
      const title = String(body.title || "").trim().slice(0, MAX_TITLE_LEN);
      if (!id || !title) throw { status: 400, message: "File id and new name are required" };
      const ref = filesCollection(acct.accountId).doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "File not found" };
      await ref.update({ title });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "move" || body.action === "moveMany") {
      const ids = body.action === "moveMany" ? (Array.isArray(body.ids) ? body.ids.map(String) : []) : [String(body.id || "")];
      const folderId = body.folderId ? String(body.folderId) : null;
      if (ids.length === 0 || ids.some((i) => !i)) throw { status: 400, message: "File id(s) required" };
      const batch = adminDb().batch();
      for (const id of ids) {
        const ref = filesCollection(acct.accountId).doc(id);
        const snap = await ref.get();
        if (snap.exists) batch.update(ref, { folderId });
      }
      await batch.commit();
      return NextResponse.json({ ok: true, moved: ids.length });
    }

    // Soft delete — moves to the recycle bin (see /api/trash) rather than
    // removing anything immediately.
    if (body.action === "delete" || body.action === "deleteMany") {
      const ids = body.action === "deleteMany" ? (Array.isArray(body.ids) ? body.ids.map(String) : []) : [String(body.id || "")];
      if (ids.length === 0 || ids.some((i) => !i)) throw { status: 400, message: "File id(s) required" };
      const now = FieldValue.serverTimestamp();
      const batch = adminDb().batch();
      let count = 0;
      for (const id of ids) {
        const ref = filesCollection(acct.accountId).doc(id);
        const snap = await ref.get();
        if (snap.exists && !snap.data().deletedAt) {
          batch.update(ref, { deletedAt: now });
          count++;
        }
      }
      await batch.commit();
      return NextResponse.json({ ok: true, deleted: count });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
