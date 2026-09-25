// Full, permanent removal of a Bizzux user, and of their business if they
// own one, across every app. Shared by the Platform Owner's "Delete now"
// (app/api/admin/users/route.js) and the daily job that wipes closed
// accounts once their 60-day recovery window ends
// (app/api/cron/purge-closed/route.js).
//
// Where each app keeps its data, and how it's removed here:
//   - Notes, Files, Projects, CRM, Chat: subcollections of customers/{orgId}
//     -> removed by recursiveDelete of that doc.
//   - Files share links: top-level shareLinks, field accountId.
//   - Uploaded files (Vercel Blob), all under a "<kind>/<orgId>/" prefix:
//       files/, notes/            -> bizzux-web's own store (same store)
//       task-attachments/         -> bizzux-projects' store
//       lead-photos/, contact-photos/ -> bizzux-crm's store
//     The other two stores need their tokens set on bizzux-web as
//     PROJECTS_BLOB_READ_WRITE_TOKEN and CRM_BLOB_READ_WRITE_TOKEN; if one
//     is missing that store is skipped and reported, never silently.
//   - Mail: mailboxAddresses (field uid) -> mailboxes/{localPart} tree.
//   - Assistant: lifeAccounts/{uid} tree, lifeMembers, lifeInvites.
//   - Bizzux Business / POS: a separate Firebase project, so it's asked to
//     wipe its own data via a signed request (bizzux-shop's
//     /api/admin/purge-org, same SHOP_SSO_SECRET HMAC as the SSO hand-off).
//   - PaisaTrack: separate project with its own, separate sign-in; not
//     linked to a Bizzux account at all, so nothing to remove here.
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { list, del } from "@vercel/blob";
import { signShopToken } from "@/lib/shopHmac";

export const RECOVERY_DAYS = 60;
const PLATFORM_OWNER_EMAIL = (process.env.PLATFORM_OWNER_EMAIL || "info.bizzux@gmail.com").toLowerCase();

const toIso = (v) => (v?.toDate ? v.toDate().toISOString() : v ? new Date(v).toISOString() : null);

export async function lookupUser(email, actor) {
  let authUser;
  try {
    authUser = await adminAuth().getUserByEmail(email);
  } catch (e) {
    if (e?.code === "auth/user-not-found") throw { status: 404, message: "No Bizzux sign-in uses " + email + "." };
    throw e;
  }
  const uid = authUser.uid;
  const db = adminDb();

  const [customerSnap, membershipSnap, platformAdminSnap, closedSnap] = await Promise.all([
    db.doc("customers/" + uid).get(),
    db.doc("memberships/" + uid).get(),
    db.doc("platformAdmins/" + uid).get(),
    db.doc("closedAccounts/" + uid).get(),
  ]);

  const customer = customerSnap.exists ? customerSnap.data() : null;
  let teamCount = 0;
  if (customer) teamCount = (await db.collection("customers/" + uid + "/team").get()).size;

  let memberOf = null;
  if (membershipSnap.exists) {
    const accountId = membershipSnap.data().accountId;
    const ownerSnap = accountId ? await db.doc("customers/" + accountId).get() : null;
    memberOf = {
      accountId,
      organizationName: ownerSnap?.exists ? ownerSnap.data().organizationName || ownerSnap.data().companyName || null : null,
    };
  }

  let blockedReason = null;
  if (actor && uid === actor.uid) blockedReason = "You can't delete your own account.";
  else if (email === PLATFORM_OWNER_EMAIL || platformAdminSnap.exists) {
    blockedReason = "This is a Platform Owner/Admin account. Remove it from Platform Admins first.";
  } else if (customer && customer.billing !== "complimentary" && (customer.status === "active" || customer.planId)) {
    blockedReason = "This business is on a paid plan. Cancel or downgrade it first.";
  }

  const closed = closedSnap.exists ? closedSnap.data() : null;
  return {
    uid,
    email: authUser.email,
    displayName: authUser.displayName || customer?.fullName || null,
    createdAt: authUser.metadata.creationTime ? new Date(authUser.metadata.creationTime).toISOString() : null,
    lastLoginAt: authUser.metadata.lastSignInTime ? new Date(authUser.metadata.lastSignInTime).toISOString() : null,
    ownsBusiness: customer
      ? { organizationName: customer.organizationName || customer.companyName || null, status: customer.status || "trial", teamCount }
      : null,
    memberOf,
    closed: closed ? { closedAt: toIso(closed.closedAt), purgeAfter: toIso(closed.purgeAfter) } : null,
    blockedReason,
  };
}

const SHOP_URL = process.env.SHOP_URL || "https://business.bizzux.com";

async function deleteRefs(refs) {
  const db = adminDb();
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch();
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

async function queryRefs(q) {
  return (await q.get()).docs.map((d) => d.ref);
}

// Deletes every blob under prefix in one store. Returns the count removed.
async function purgeBlobPrefix(prefix, token) {
  let removed = 0;
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000, ...(token ? { token } : {}) });
    if (page.blobs.length) {
      await del(page.blobs.map((b) => b.url), token ? { token } : undefined);
      removed += page.blobs.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return removed;
}

async function purgeOrgBlobs(orgId, report) {
  const stores = [
    { name: "Files/Notes uploads", token: process.env.BLOB_READ_WRITE_TOKEN, prefixes: ["files/", "notes/"] },
    { name: "Projects attachments", token: process.env.PROJECTS_BLOB_READ_WRITE_TOKEN, prefixes: ["task-attachments/"] },
    { name: "CRM photos", token: process.env.CRM_BLOB_READ_WRITE_TOKEN, prefixes: ["lead-photos/", "contact-photos/"] },
  ];
  for (const s of stores) {
    // bizzux-web's own store also works via its connected project with no
    // explicit token in production; the other two always need theirs.
    if (!s.token && s.name !== "Files/Notes uploads") {
      report.skipped.push(s.name + " (token not configured)");
      continue;
    }
    try {
      let n = 0;
      for (const p of s.prefixes) n += await purgeBlobPrefix(p + orgId + "/", s.token);
      report.blobs += n;
    } catch (e) {
      report.skipped.push(s.name + " (" + (e?.message || "failed") + ")");
    }
  }
}

async function purgeShop(orgId, email, report) {
  try {
    const token = signShopToken({ orgId, email, action: "purge", iat: Date.now() });
    const r = await fetch(SHOP_URL + "/api/admin/purge-org", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    report.shopDocs = d.deletedDocs || 0;
  } catch (e) {
    report.skipped.push("Bizzux Business (" + (e?.message || "failed") + ")");
  }
}

// info = the lookup result from app/api/admin/users/route.js:
// { uid, email, ownsBusiness, memberOf }.
export async function purgeUser(info) {
  const { uid, email } = info;
  const db = adminDb();
  const report = { docs: 0, blobs: 0, shopDocs: 0, skipped: [] };
  const refs = [];

  // As a team member of someone else's business.
  if (info.memberOf?.accountId) {
    refs.push(...(await queryRefs(db.collection("customers/" + info.memberOf.accountId + "/team").where("uid", "==", uid))));
  }
  refs.push(...(await queryRefs(db.collection("organizationMemberships").where("userId", "==", uid))));
  refs.push(...(await queryRefs(db.collection("appAssignments").where("userId", "==", uid))));

  // Personal app data: Mail and Assistant belong to the person, not the business.
  const mailAddrs = await db.collection("mailboxAddresses").where("uid", "==", uid).get();
  for (const a of mailAddrs.docs) {
    await db.recursiveDelete(db.doc("mailboxes/" + a.id));
    refs.push(a.ref);
  }
  refs.push(...(await queryRefs(db.collection("lifeMembers").where("accountId", "==", uid))));
  refs.push(...(await queryRefs(db.collection("lifeInvites").where("accountId", "==", uid))));
  refs.push(db.doc("lifeMembers/" + uid));

  // Their own business, and everything every app stored for it.
  if (info.ownsBusiness) {
    refs.push(...(await queryRefs(db.collection("memberships").where("accountId", "==", uid))));
    refs.push(...(await queryRefs(db.collection("organizationMemberships").where("organizationId", "==", uid))));
    refs.push(...(await queryRefs(db.collection("organizationAppSubscriptions").where("organizationId", "==", uid))));
    refs.push(...(await queryRefs(db.collection("appAssignments").where("organizationId", "==", uid))));
    refs.push(...(await queryRefs(db.collection("invites").where("accountId", "==", uid))));
    refs.push(...(await queryRefs(db.collection("shareLinks").where("accountId", "==", uid))));
    refs.push(db.doc("organizations/" + uid));
  }

  refs.push(db.doc("users/" + uid), db.doc("twoFactor/" + uid), db.doc("memberships/" + uid), db.doc("closedAccounts/" + uid));

  const unique = [...new Map(refs.map((r) => [r.path, r])).values()];
  await deleteRefs(unique);
  report.docs = unique.length;
  await db.recursiveDelete(db.doc("lifeAccounts/" + uid));

  if (info.ownsBusiness) {
    await db.recursiveDelete(db.doc("customers/" + uid));
    await purgeOrgBlobs(uid, report);
    await purgeShop(uid, email, report);
  }

  // Last, so a failure above leaves the login in place to retry against
  // rather than orphaned records nothing can look up by email any more.
  try {
    await adminAuth().deleteUser(uid);
  } catch (e) {
    if (e?.code !== "auth/user-not-found") throw e;
  }
  return report;
}
