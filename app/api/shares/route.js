import { NextResponse } from "next/server";
import { adminDb, requireAccountWithAppsAccess } from "@/lib/firebaseAdmin";
import { hashPassword } from "@/lib/shareLinks";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Top-level (not nested under customers/{accountId}) because an anonymous
// guest hitting /share/[shareId] doesn't know — and shouldn't need to know —
// which account owns it; the share doc itself carries accountId.
function sharesCollection() {
  return adminDb().collection("shareLinks");
}
function filesCollection(accountId) {
  return adminDb().collection("customers/" + accountId + "/textFiles");
}
function foldersCollection(accountId) {
  return adminDb().collection("customers/" + accountId + "/textFolders");
}

const MAX_MINUTES = 30 * 24 * 60; // 30 days — a sane ceiling on how long a link can live
const MIN_PASSWORD_LEN = 4;

function toIso(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
}

export async function GET(req) {
  try {
    const acct = await requireAccountWithAppsAccess(req);
    const snap = await sharesCollection().where("accountId", "==", acct.accountId).get();
    const shares = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      .map((s) => ({
        id: s.id,
        targetType: s.targetType,
        targetName: s.targetName,
        mode: s.mode,
        revoked: !!s.revoked,
        expiresAt: toIso(s.expiresAt),
        createdAt: toIso(s.createdAt),
      }));
    return NextResponse.json({ shares });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const acct = await requireAccountWithAppsAccess(req);
    const body = await req.json();

    if (body.action === "create") {
      const targetType = body.targetType === "folder" ? "folder" : "file";
      const targetId = String(body.targetId || "");
      const mode = body.mode === "upload" && targetType === "folder" ? "upload" : "view";
      const password = String(body.password || "");
      const minutes = Math.min(Math.max(Number(body.expiresInMinutes) || 0, 1), MAX_MINUTES);

      if (!targetId) throw { status: 400, message: "Nothing selected to share" };
      if (password.length < MIN_PASSWORD_LEN) throw { status: 400, message: `Password must be at least ${MIN_PASSWORD_LEN} characters` };

      const col = targetType === "folder" ? foldersCollection(acct.accountId) : filesCollection(acct.accountId);
      const targetSnap = await col.doc(targetId).get();
      if (!targetSnap.exists || targetSnap.data().deletedAt) throw { status: 404, message: "That item wasn't found" };
      const targetName = targetType === "folder" ? targetSnap.data().name : targetSnap.data().title;

      const ref = await sharesCollection().add({
        accountId: acct.accountId,
        targetType,
        targetId,
        targetName,
        mode,
        passwordHash: hashPassword(password),
        expiresAt: new Date(Date.now() + minutes * 60 * 1000),
        revoked: false,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: acct.uid,
        createdByEmail: acct.email,
      });
      return NextResponse.json({ id: ref.id });
    }

    if (body.action === "revoke") {
      const id = String(body.id || "");
      if (!id) throw { status: 400, message: "Share id required" };
      const ref = sharesCollection().doc(id);
      const snap = await ref.get();
      if (!snap.exists || snap.data().accountId !== acct.accountId) throw { status: 404, message: "Share link not found" };
      await ref.update({ revoked: true });
      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
