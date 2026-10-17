// SERVER ONLY. Search index for the Organizations directory.
//
// organizationDirectory/{orgId} is a DERIVED, denormalized read model: one
// small document per organization (same id as organizations/{id} and
// customers/{id}) holding exactly what the list needs. It is NOT a second
// customer database - nothing reads it for access control, it is rebuilt from
// organizations + customers + memberships at any time (see
// scripts/backfill-organization-directory.mjs), and deleting it loses nothing.
// It exists so the directory can search, filter, sort and paginate on the
// server at 10,000+ organizations without reading every customer per view.
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./firebaseAdmin";
import { deriveStatus } from "./orgStatus";
import { resolveOrgOwners } from "./orgOwners";

export const DIRECTORY_COLLECTION = "organizationDirectory";
export const MAX_TOKEN_LEN = 12;
const MAX_TOKENS = 200;
const FILTER_FIELDS = ["accountStatus", "kind", "planType"];
const SORTS = { created: "createdAtMs", name: "nameLower" };

const lower = (v) => String(v ?? "").toLowerCase().trim();
const tsMs = (t) => (t?.toMillis ? t.toMillis() : t?.toDate ? t.toDate().getTime() : t ? new Date(t).getTime() || 0 : 0);

// Lowercase words and their prefixes (2..12 chars), so a typed prefix like
// "cost" finds "Costal Marine" with one array-contains query.
export function tokensFor(strings) {
  const out = new Set();
  for (const s of strings) {
    for (const word of lower(s).split(/[^a-z0-9@._+-]+/).filter(Boolean)) {
      const w = word.slice(0, 64);
      for (let n = 2; n <= Math.min(w.length, MAX_TOKEN_LEN); n++) out.add(w.slice(0, n));
      if (w.length > MAX_TOKEN_LEN) out.add(w.slice(0, MAX_TOKEN_LEN));
      const local = w.split("@")[0];
      if (local && local !== w) for (let n = 2; n <= Math.min(local.length, MAX_TOKEN_LEN); n++) out.add(local.slice(0, n));
    }
  }
  return [...out].slice(0, MAX_TOKENS);
}

export function buildDirectoryEntry({ id, org, customer, owner }) {
  const kind = !org.type ? "placeholder" : org.provisionedVia === "platform-admin" || customer?.createdByAdmin ? "admin-provisioned" : "self-service";
  const name = org.organizationName || org.name || customer?.organizationName || customer?.companyName || "(unnamed)";
  const status = deriveStatus(customer, org);
  const ownerName = owner?.name || (kind === "admin-provisioned" ? org.adminName || customer?.owner?.name || "" : "");
  const ownerEmail = owner?.email || "";
  const adminUsername = org.adminUsername || customer?.owner?.username || "";
  return {
    orgId: id,
    name, nameLower: lower(name),
    kind,
    ownerUid: owner?.uid || null,
    ownerName, ownerEmail, adminUsername,
    hasOwner: !!owner,
    accountStatus: status.account,
    planType: status.plan.type || "NONE",
    planName: status.plan.name || "",
    payment: status.payment,
    trialState: status.trial.state,
    trialEndsAt: status.trial.endsAt,
    onboarding: status.onboarding,
    licensedSeats: org.allowedUsers ?? customer?.allowedUsers ?? null,
    phone: customer?.phone || org.contactPhone || "",
    city: customer?.signupCity || org.city || "", region: customer?.signupRegion || org.state || customer?.state || "",
    customerType: (Number(customer?.paymentCount) || 0) >= 2 ? "Renewal" : (Number(customer?.paymentCount) || 0) === 1 ? "New (paid)" : "Trial",
    industry: org.industry || customer?.industry || "",
    countryCode: org.countryCode || customer?.countryCode || "",
    country: org.countryName || customer?.country || "",
    isTest: org.isTestAccount === true || customer?.isTestAccount === true,
    isInternal: org.type === "INTERNAL",
    appCount: Array.isArray(org.apps) ? org.apps.length : null,
    createdAtMs: tsMs(org.createdAt) || tsMs(customer?.createdAt),
    searchTokens: tokensFor([name, ownerName, ownerEmail, adminUsername, id, customer?.phone || org.contactPhone || "", String(customer?.phone || org.contactPhone || "").replace(/D/g, "")]),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

// Rebuilds one entry from source records. Best-effort by design: callers use
// safeSyncDirectory so an index problem never fails the real operation.
export async function syncOrganizationDirectory(orgId, { owner } = {}) {
  const db = adminDb();
  const [orgSnap, custSnap] = await Promise.all([db.doc("organizations/" + orgId).get(), db.doc("customers/" + orgId).get()]);
  const ref = db.doc(DIRECTORY_COLLECTION + "/" + orgId);
  if (!orgSnap.exists) { await ref.delete().catch(() => {}); return null; }
  const o = owner !== undefined ? owner : (await resolveOrgOwners([orgId]))[orgId]?.owner || null;
  const entry = buildDirectoryEntry({ id: orgId, org: orgSnap.data(), customer: custSnap.exists ? custSnap.data() : null, owner: o });
  await ref.set(entry);
  return entry;
}

export async function safeSyncDirectory(orgId) {
  try { await syncOrganizationDirectory(orgId); } catch (e) { console.error("directory sync failed", orgId, e?.message || e); }
}

export async function removeFromDirectory(orgId) {
  try { await adminDb().doc(DIRECTORY_COLLECTION + "/" + orgId).delete(); } catch { /* best-effort */ }
}

const encodeCursor = (v, id) => Buffer.from(JSON.stringify({ v, id })).toString("base64url");
function decodeCursor(c) {
  try { const d = JSON.parse(Buffer.from(String(c), "base64url").toString("utf8")); return d && "v" in d && d.id ? d : null; } catch { return null; }
}

// Server-side search / filter / sort / cursor pagination.
//   q            prefix search on name, owner name/email, username, id
//   accountStatus | kind | planType   equality filters
//   sort         "created" (default) | "name"      dir  "desc" | "asc"
//   limit        1..100                            cursor  opaque, from nextCursor
// One condition is pushed to Firestore (q, else the first filter present, each
// backed by a composite index); the rest are applied to the fetched batch,
// and batches keep loading until the page is full or the data ends.
export async function queryDirectory({ q = "", accountStatus, kind, planType, excludeStatus, sort = "created", dir, limit = 25, cursor } = {}) {
  const sortField = SORTS[sort] || SORTS.created;
  const direction = (dir || (sort === "name" ? "asc" : "desc")) === "asc" ? "asc" : "desc";
  limit = Math.max(1, Math.min(100, parseInt(limit, 10) || 25));
  const filters = { accountStatus, kind, planType };
  const words = lower(q).split(/\s+/).filter(Boolean);
  const key = [...words].sort((a, b) => b.length - a.length)[0];
  const serverToken = key && key.length >= 2 ? key.slice(0, MAX_TOKEN_LEN) : null;
  const serverFilter = serverToken ? null : FILTER_FIELDS.find((f) => filters[f]);

  const match = (e) =>
    (!excludeStatus || e.accountStatus !== excludeStatus) &&
    FILTER_FIELDS.every((f) => !filters[f] || f === serverFilter || e[f] === filters[f]) &&
    words.every((w) => [e.nameLower, lower(e.ownerName), lower(e.ownerEmail), lower(e.adminUsername), lower(e.orgId), lower(e.phone), String(e.phone || "").replace(/D/g, "")].some((s) => s.includes(w)));

  const cur = cursor ? decodeCursor(cursor) : null;
  if (cursor && !cur) throw { status: 400, message: "Invalid cursor" };
  const rows = [];
  let last = cur;
  let exhausted = false;
  for (let i = 0; i < 6 && rows.length < limit + 1 && !exhausted; i++) {
    let query = adminDb().collection(DIRECTORY_COLLECTION);
    if (serverToken) query = query.where("searchTokens", "array-contains", serverToken);
    else if (serverFilter) query = query.where(serverFilter, "==", filters[serverFilter]);
    query = query.orderBy(sortField, direction).orderBy(FieldPath.documentId(), direction);
    if (last) query = query.startAfter(last.v, last.id);
    const snap = await query.limit(Math.max(50, limit * 2)).get();
    if (snap.size < Math.max(50, limit * 2)) exhausted = true;
    for (const d of snap.docs) {
      const e = d.data();
      last = { v: e[sortField], id: d.id };
      if (match(e)) rows.push({ id: d.id, ...e, updatedAt: undefined, searchTokens: undefined });
    }
  }
  const page = rows.slice(0, limit);
  const lastRow = page[page.length - 1];
  let nextCursor = null;
  if (rows.length > limit && lastRow) nextCursor = encodeCursor(lastRow[sortField], lastRow.id);
  else if (!exhausted && last) nextCursor = encodeCursor(last.v, last.id); // scan cap hit; resume where we stopped
  return { rows: page, nextCursor };
}

// Rebuilds the index in id order, a bounded slice at a time, so it can run
// inside a request or a cron without timing out. Returns { processed, next }
// where next is the cursor to pass back in (null when finished). It only
// writes organizationDirectory documents; source records are read-only here.
export async function reindexBatch({ after = null, budgetMs = 40000, pageSize = 100 } = {}) {
  const db = adminDb();
  const started = Date.now();
  let processed = 0, writes = 0, reads = 0;
  let cursor = after;
  for (;;) {
    let q = db.collection("organizations").orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    reads += snap.size;
    if (snap.empty) return { processed, writes, reads, next: null };
    cursor = snap.docs[snap.docs.length - 1].id;
    const typed = snap.docs.filter((d) => d.data().type);
    const custSnaps = typed.length ? await db.getAll(...typed.map((d) => db.doc("customers/" + d.id))) : [];
    reads += custSnaps.length;
    const customers = Object.fromEntries(custSnaps.map((c) => [c.id, c.exists ? c.data() : null]));
    const owners = await resolveOrgOwners(snap.docs.map((d) => d.id));
    reads += Object.keys(owners).length; // at least one membership query each (documents read are extra, roughly active members)
    const batch = db.batch();
    for (const d of snap.docs) {
      batch.set(db.doc(DIRECTORY_COLLECTION + "/" + d.id), buildDirectoryEntry({ id: d.id, org: d.data(), customer: customers[d.id] || null, owner: owners[d.id]?.owner || null }));
      processed++; writes++;
    }
    await batch.commit();
    if (Date.now() - started > budgetMs) return { processed, writes, reads, next: cursor };
    if (snap.size < pageSize) return { processed, writes, reads, next: null };
  }
}
