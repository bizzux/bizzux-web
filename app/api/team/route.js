import { NextResponse } from "next/server";
import { requireAccountAdmin, adminAuth, adminDb, sendAuthEmail } from "@/lib/firebaseAdmin";
import { PROFILE_VALUES, DEFAULT_PROFILE } from "@/lib/roles";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function toIso(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
}

function teamCollection(accountId) {
  return adminDb().collection("customers/" + accountId + "/team");
}

async function sendInvite({ accountId, teamMemberId, email, firstName, lastName, role, profile, origin }) {
  const token = randomUUID();
  await adminDb()
    .doc("invites/" + token)
    .set({
      accountId,
      teamMemberId,
      email,
      firstName,
      lastName,
      role,
      profile,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + INVITE_TTL_MS),
      used: false,
    });

  await sendAuthEmail({
    requestType: "PASSWORD_RESET",
    email,
    continueUrl: `${origin}/accept-invite?invite=${token}`,
  });
}

// Lists everyone on the caller's account: the owner plus every invited /
// active teammate. Global Admin / Admin profiles only.
export async function GET(req) {
  try {
    const acct = await requireAccountAdmin(req);
    const ownerSnap = await adminDb().doc("customers/" + acct.accountId).get();
    const owner = ownerSnap.exists ? ownerSnap.data() : {};
    const teamSnap = await teamCollection(acct.accountId).get();

    const members = [
      {
        id: acct.accountId,
        firstName: owner.fullName || "",
        lastName: "",
        email: owner.email || "",
        role: "Owner",
        profile: "Admin",
        status: "active",
        isOwner: true,
        joinedAt: toIso(owner.createdAt),
      },
      ...teamSnap.docs.map((d) => {
        const t = d.data();
        return {
          id: d.id,
          firstName: t.firstName || "",
          lastName: t.lastName || "",
          email: t.email || "",
          role: t.role || "",
          profile: t.profile || DEFAULT_PROFILE,
          status: t.status || "invited",
          isOwner: false,
          joinedAt: toIso(t.joinedAt),
          invitedAt: toIso(t.invitedAt),
        };
      }),
    ];

    return NextResponse.json({ members });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

// Action-based, same pattern as /api/admin/plans: { action: "invite" | "remove" | "resend", ... }
export async function POST(req) {
  try {
    const acct = await requireAccountAdmin(req);
    const body = await req.json();
    const origin = req.headers.get("origin") || new URL(req.url).origin;

    if (body.action === "invite") {
      const firstName = String(body.firstName || "").trim().slice(0, 60);
      const lastName = String(body.lastName || "").trim().slice(0, 60);
      const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
      const role = String(body.role || "").trim().slice(0, 60);
      const profile = PROFILE_VALUES.includes(body.profile) ? body.profile : DEFAULT_PROFILE;

      if (!firstName) throw { status: 400, message: "First name is required" };
      if (!EMAIL_RE.test(email)) throw { status: 400, message: "Enter a valid email address" };

      const dupe = await teamCollection(acct.accountId).where("email", "==", email).limit(1).get();
      if (!dupe.empty) throw { status: 409, message: "That email is already on your team" };

      let authUser;
      try {
        authUser = await adminAuth().createUser({ email, emailVerified: false });
      } catch (e) {
        if (e.code === "auth/email-already-exists") {
          throw {
            status: 409,
            message: "That email already has a Bizzux account and can't be invited as a new teammate yet.",
          };
        }
        throw e;
      }

      const memberRef = await teamCollection(acct.accountId).add({
        firstName,
        lastName,
        email,
        role,
        profile,
        status: "invited",
        uid: authUser.uid,
        invitedBy: acct.email,
        invitedAt: FieldValue.serverTimestamp(),
        joinedAt: null,
      });

      await sendInvite({
        accountId: acct.accountId,
        teamMemberId: memberRef.id,
        email,
        firstName,
        lastName,
        role,
        profile,
        origin,
      });

      return NextResponse.json({ ok: true });
    }

    if (body.action === "resend") {
      const id = String(body.id || "");
      const memberSnap = await adminDb().doc(`customers/${acct.accountId}/team/${id}`).get();
      if (!memberSnap.exists) throw { status: 404, message: "Not found" };
      const t = memberSnap.data();
      if (t.status === "active") throw { status: 400, message: "This teammate has already joined" };

      await sendInvite({
        accountId: acct.accountId,
        teamMemberId: id,
        email: t.email,
        firstName: t.firstName,
        lastName: t.lastName,
        role: t.role,
        profile: t.profile,
        origin,
      });

      return NextResponse.json({ ok: true });
    }

    if (body.action === "remove") {
      const id = String(body.id || "");
      if (!id || id === acct.accountId) throw { status: 400, message: "Can't remove the account owner" };
      const memberRef = adminDb().doc(`customers/${acct.accountId}/team/${id}`);
      const snap = await memberRef.get();
      if (snap.exists && snap.data().uid) {
        await adminDb()
          .doc("memberships/" + snap.data().uid)
          .delete()
          .catch(() => {});
      }
      await memberRef.delete();
      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
