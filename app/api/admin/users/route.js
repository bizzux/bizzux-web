import { NextResponse } from "next/server";
import { requirePlatformOwner, adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { logAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Platform Owner -> Delete User. Permanently removes a sign-in and every
// Bizzux portal record tied to it, so the same email can sign up again and
// go through the new-user flow from scratch (mainly for testing onboarding
// without burning through email addresses).
//
// What it removes:
//   - the Firebase Auth user (a new sign-up then gets a brand-new uid)
//   - users/{uid}, twoFactor/{uid}, memberships/{uid}
//   - if they're a team member elsewhere: their row in that business's
//     customers/{accountId}/team roster, plus their organizationMemberships
//     and appAssignments
//   - if they own a business: customers/{uid} (with its team/ and any other
//     subcollections), organizations/{uid}, and every membership, app
//     subscription, app assignment and unused invite for that business. Team
//     members' own logins are kept; they just stop belonging to it.
//
// What it leaves: data stored inside the individual apps (CRM records,
// notes, files, shop sales…). It's keyed by the old uid, which nothing can
// reach once that uid is gone, and each app has its own storage this route
// doesn't know about.
//
// Refuses: your own account, any Platform Owner/Admin, and a business on a
// paid plan (cancel or downgrade it first; this is not a billing tool).

const PLATFORM_OWNER_EMAIL = (process.env.PLATFORM_OWNER_EMAIL || "info.bizzux@gmail.com").toLowerCase();

async function lookup(email, actor) {
  let authUser;
  try {
    authUser = await adminAuth().getUserByEmail(email);
  } catch (e) {
    if (e?.code === "auth/user-not-found") throw { status: 404, message: "No Bizzux sign-in uses " + email + "." };
    throw e;
  }
  const uid = authUser.uid;
  const db = adminDb();

  const [customerSnap, membershipSnap, platformAdminSnap] = await Promise.all([
    db.doc("customers/" + uid).get(),
    db.doc("memberships/" + uid).get(),
    db.doc("platformAdmins/" + uid).get(),
  ]);

  const customer = customerSnap.exists ? customerSnap.data() : null;
  let teamCount = 0;
  if (customer) {
    const teamSnap = await db.collection("customers/" + uid + "/team").get();
    teamCount = teamSnap.size;
  }

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
  if (uid === actor.uid) blockedReason = "You can't delete your own account.";
  else if (email === PLATFORM_OWNER_EMAIL || platformAdminSnap.exists) {
    blockedReason = "This is a Platform Owner/Admin account. Remove it from Platform Admins first.";
  } else if (customer && (customer.status === "active" || customer.planId)) {
    blockedReason = "This business is on a paid plan. Cancel or downgrade it first.";
  }

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
    blockedReason,
  };
}

// Deletes in chunks; Firestore batches cap at 500 writes.
async function deleteRefs(refs) {
  const db = adminDb();
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch();
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

export async function GET(req) {
  try {
    const actor = await requirePlatformOwner(req);
    const email = String(new URL(req.url).searchParams.get("email") || "").trim().toLowerCase();
    if (!email) throw { status: 400, message: "Enter an email address" };
    return NextResponse.json({ user: await lookup(email, actor) });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const actor = await requirePlatformOwner(req);
    const body = await req.json();
    if (body.action !== "delete") throw { status: 400, message: "Unknown action" };

    const email = String(body.email || "").trim().toLowerCase();
    if (!email) throw { status: 400, message: "Enter an email address" };
    // Typed confirmation, checked server-side too, so a stray request
    // can't delete someone.
    if (String(body.confirmEmail || "").trim().toLowerCase() !== email) {
      throw { status: 400, message: "Type the email address exactly to confirm." };
    }

    const info = await lookup(email, actor);
    if (info.blockedReason) throw { status: 409, message: info.blockedReason };

    const { uid } = info;
    const db = adminDb();
    const refs = [];
    const queryRefs = async (q) => (await q.get()).docs.map((d) => d.ref);

    // As a member of someone else's business.
    if (info.memberOf?.accountId) {
      refs.push(...(await queryRefs(db.collection("customers/" + info.memberOf.accountId + "/team").where("uid", "==", uid))));
    }
    refs.push(...(await queryRefs(db.collection("organizationMemberships").where("userId", "==", uid))));
    refs.push(...(await queryRefs(db.collection("appAssignments").where("userId", "==", uid))));

    // As the owner of their own business.
    if (info.ownsBusiness) {
      refs.push(...(await queryRefs(db.collection("memberships").where("accountId", "==", uid))));
      refs.push(...(await queryRefs(db.collection("organizationMemberships").where("organizationId", "==", uid))));
      refs.push(...(await queryRefs(db.collection("organizationAppSubscriptions").where("organizationId", "==", uid))));
      refs.push(...(await queryRefs(db.collection("appAssignments").where("organizationId", "==", uid))));
      const invites = await db.collection("invites").where("accountId", "==", uid).get();
      refs.push(...invites.docs.map((d) => d.ref));
      refs.push(db.doc("organizations/" + uid));
    }

    refs.push(db.doc("users/" + uid), db.doc("twoFactor/" + uid), db.doc("memberships/" + uid));

    // De-dupe (the same doc can match both the member and owner queries).
    const unique = [...new Map(refs.map((r) => [r.path, r])).values()];
    await deleteRefs(unique);
    if (info.ownsBusiness) await db.recursiveDelete(db.doc("customers/" + uid));

    // Last, so a Firestore failure above leaves the login in place to retry
    // against, rather than orphaned records nothing can look up by email.
    await adminAuth().deleteUser(uid);

    await logAuditEvent({
      action: "user.delete", actor, targetType: "user", targetId: uid,
      details: { email, organizationName: info.ownsBusiness?.organizationName || null, memberOf: info.memberOf?.accountId || null },
    });

    return NextResponse.json({ ok: true, deletedDocs: unique.length });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
