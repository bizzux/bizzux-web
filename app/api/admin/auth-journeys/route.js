import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb, requireOrgManager } from "@/lib/firebaseAdmin";
import { COLLECTION, buildJourneys, hashId } from "@/lib/authJourney";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 400;
const MAX_JOURNEYS = 60;
const iso = (ts) => (ts && typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts || null);

// Admin-only read of Login Journey Diagnostics (User → Login History →
// Authentication Journey). Platform Owner/Admin: every organization.
// Organization Admin: only journeys that contain an event attributed to their
// own organization (orgHash is stamped server-side from the verified token, never
// taken from the client). No hashes or IDs are returned.
// Reads: ≤ 2 queries of LIMIT docs + ≤ 2 journey joins; ~1 Auth lookup if ?email=.
export async function GET(req) {
  try {
    const c = await requireOrgManager(req);
    const own = c.isSuper ? null : hashId(c.accountId);
    if (!c.isSuper && !own) throw { status: 403, message: "Admin access required" };

    const sp = new URL(req.url).searchParams;
    const email = (sp.get("email") || "").trim().toLowerCase();
    const appFilter = sp.get("app") || "";
    const days = Math.min(30, Math.max(1, parseInt(sp.get("days") || "14", 10) || 14));
    const fromMs = sp.get("from") ? Date.parse(sp.get("from")) : Date.now() - days * 86400000;
    const toMs = sp.get("to") ? Date.parse(sp.get("to")) + 86400000 : Date.now() + 1;
    if (isNaN(fromMs) || isNaN(toMs)) throw { status: 400, message: "Invalid date" };

    const col = adminDb().collection(COLLECTION);
    const snaps = [];
    if (email) {
      let uidHash = null;
      try { uidHash = hashId((await adminAuth().getUserByEmail(email)).uid); } catch { /* unknown to Firebase Auth */ }
      if (uidHash) snaps.push(await col.where("uidHash", "==", uidHash).limit(LIMIT).get());
      if (c.isSuper) snaps.push(await col.where("subjectHash", "==", hashId(email)).limit(LIMIT).get());
    } else if (c.isSuper) {
      snaps.push(await col.where("receivedAt", ">=", Timestamp.fromMillis(fromMs)).orderBy("receivedAt", "desc").limit(LIMIT).get());
    } else {
      snaps.push(await col.where("orgHash", "==", own).limit(LIMIT).get());
    }

    const rows = new Map();
    const now = Date.now();
    const add = (d) => {
      const r = d.data();
      const exp = r.expireAt?.toMillis?.();
      if (exp && exp < now) return;
      rows.set(d.id, { ...r, receivedAt: iso(r.receivedAt), expireAt: undefined, _own: r.orgHash || null });
    };
    snaps.forEach((s) => s.docs.forEach(add));

    // Join the anonymous pre-sign-in events of the same journeys.
    const ids = [...new Set([...rows.values()].map((r) => r.journeyId))].slice(0, MAX_JOURNEYS);
    for (let i = 0; i < ids.length; i += 30) {
      const s = await col.where("journeyId", "in", ids.slice(i, i + 30)).limit(LIMIT).get();
      s.docs.forEach(add);
    }

    let all = [...rows.values()];
    if (own) {
      // Tenant isolation: keep only journeys that have at least one row for this org.
      const ok = new Set(all.filter((r) => r._own === own).map((r) => r.journeyId));
      all = all.filter((r) => ok.has(r.journeyId));
    }
    let journeys = buildJourneys(all)
      .filter((j) => Date.parse(j.startedAt) >= fromMs && Date.parse(j.startedAt) < toMs)
      .filter((j) => !appFilter || j.app === appFilter)
      .slice(0, 200);

    const summary = {
      total: journeys.length,
      succeeded: journeys.filter((j) => j.outcome === "success").length,
      failed: journeys.filter((j) => j.outcome === "failed").length,
      retriedThenSucceeded: journeys.filter((j) => j.outcome === "success" && j.failuresBeforeSuccess > 0).length,
    };
    return NextResponse.json({ journeys, summary, truncated: rows.size >= LIMIT });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
