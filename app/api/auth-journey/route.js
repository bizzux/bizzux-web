import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb, resolveAccount } from "@/lib/firebaseAdmin";
import { COLLECTION, MAX_BATCH, RETENTION_DAYS, hashId, sanitizeEvent } from "@/lib/authJourney";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public write-only ingest for Login Journey Diagnostics. Split apps send a
// "simple" cross-origin request (text/plain JSON, no-cors, no preflight), so
// the optional Firebase ID token travels in the body, is verified here and is
// NEVER stored or logged. Always answers 204: telemetry must never surface an
// error (or reveal anything) to the sign-in page.
const orgCache = new Map(); // uid -> { orgId, at } — keeps Firestore reads to ~1 per user per 10 min
const TTL = 10 * 60 * 1000;

async function orgFor(uid) {
  const hit = orgCache.get(uid);
  if (hit && Date.now() - hit.at < TTL) return hit.orgId;
  let orgId = null;
  try {
    orgId = (await resolveAccount(uid))?.accountId || null;
  } catch { /* user without an account yet (e.g. sign-up in progress) */ }
  if (orgCache.size > 500) orgCache.clear();
  orgCache.set(uid, { orgId, at: Date.now() });
  return orgId;
}

export async function POST(req) {
  try {
    const body = JSON.parse((await req.text()).slice(0, 20000));
    const list = Array.isArray(body?.events) ? body.events.slice(0, MAX_BATCH) : [];
    const events = list.map(sanitizeEvent).filter(Boolean);
    if (!events.length) return new NextResponse(null, { status: 204 });

    let uid = null;
    if (typeof body.idToken === "string" && body.idToken.length < 4000) {
      try { uid = (await adminAuth().verifyIdToken(body.idToken)).uid; } catch { /* expired/invalid: stay anonymous */ }
    }
    const uidHash = uid ? hashId(uid) : null;
    const orgHash = uid ? hashId(await orgFor(uid)) : null; // org id equals the owner uid: store it hashed too
    const origin = (() => { try { return new URL(req.headers.get("origin") || "").host.slice(0, 80); } catch { return null; } })();

    const db = adminDb();
    const batch = db.batch();
    const expireAt = Timestamp.fromMillis(Date.now() + RETENTION_DAYS * 86400000);
    for (const e of events) {
      const { subject, ...rest } = e;
      batch.set(db.collection(COLLECTION).doc(), {
        ...rest,
        uidHash,
        subjectHash: subject ? hashId(subject) : null,
        orgHash,
        origin,
        receivedAt: FieldValue.serverTimestamp(),
        expireAt,
      });
    }
    await batch.commit();
  } catch (e) {
    console.error("auth-journey ingest failed:", e?.message || e);
  }
  return new NextResponse(null, { status: 204 });
}
