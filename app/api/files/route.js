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

// Plain substring search across title + content, case-insensitive. Good
// enough at the scale this app is built for (tens to low hundreds of text
// files per account) without standing up a real search index.
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

    const snap = await filesCollection(acct.accountId).orderBy("createdAt", "desc").get();
    const files = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((f) => matches(f, q))
      .filter((f) => {
        if (!folderId) return true;
        if (folderId === "unfiled") return !f.folderId;
        return f.folderId === folderId;
      })
      .map((f) => ({
        id: f.id,
        title: f.title,
        sizeBytes: f.sizeBytes || 0,
        createdAt: toIso(f.createdAt),
        folderId: f.folderId || null,
        // A short snippet around the first match, so search results show
        // *why* a file matched without shipping its whole content.
        snippet: q ? snippetAround(f.content || "", q) : null,
      }));

    return NextResponse.json({ files });
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
      const content = String(body.content || "");
      const folderId = body.folderId ? String(body.folderId) : null;
      if (!title) throw { status: 400, message: "File name is required" };
      if (!content.trim()) throw { status: 400, message: "File content is empty" };
      if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
        throw { status: 400, message: "That file is too large (2MB limit)" };
      }

      const ref = await filesCollection(acct.accountId).add({
        title,
        content,
        folderId,
        sizeBytes: Buffer.byteLength(content, "utf8"),
        createdAt: FieldValue.serverTimestamp(),
        createdBy: acct.uid,
        createdByEmail: acct.email,
      });
      return NextResponse.json({ id: ref.id });
    }

    if (body.action === "move") {
      const id = String(body.id || "");
      const folderId = body.folderId ? String(body.folderId) : null;
      if (!id) throw { status: 400, message: "File id required" };
      const ref = filesCollection(acct.accountId).doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "File not found" };
      await ref.update({ folderId });
      return NextResponse.json({ ok: true });
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

    if (body.action === "delete") {
      const id = String(body.id || "");
      if (!id) throw { status: 400, message: "File id required" };
      const ref = filesCollection(acct.accountId).doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "File not found" };
      await ref.delete();
      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
