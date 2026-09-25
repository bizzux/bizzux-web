import { NextResponse } from "next/server";
import { requirePlatformAdmin, adminAuth, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toIso = (v) => (v?.toDate ? v.toDate().toISOString() : v ? new Date(v).toISOString() : null);

// Platform Admin dashboard data: EVERY sign-in, not just business owners.
// /api/admin/customers only lists customers/ docs, which exist once someone
// sets up a business, so people who signed up and stopped there (the
// drop-off the dashboard most needs to show) never appeared anywhere.
// Firebase Auth is the source of truth for "who signed up"; each user is
// then tagged from Firestore with what they did next.
export async function GET(req) {
  try {
    await requirePlatformAdmin(req);
    const db = adminDb();

    const authUsers = [];
    let pageToken;
    do {
      const page = await adminAuth().listUsers(1000, pageToken);
      authUsers.push(...page.users);
      pageToken = page.pageToken;
    } while (pageToken);

    const [customersSnap, membershipsSnap, usersSnap, platformSnap] = await Promise.all([
      db.collection("customers").get(),
      db.collection("memberships").get(),
      db.collection("users").get(),
      db.collection("platformAdmins").get(),
    ]);
    const customers = new Map(customersSnap.docs.map((d) => [d.id, d.data()]));
    const memberships = new Map(membershipsSnap.docs.map((d) => [d.id, d.data()]));
    const userDocs = new Map(usersSnap.docs.map((d) => [d.id, d.data()]));
    const platformUids = new Set(platformSnap.docs.filter((d) => d.data().status !== "disabled").map((d) => d.id));

    const users = authUsers.map((u) => {
      const own = customers.get(u.uid);
      const mem = memberships.get(u.uid);
      const memberOrg = mem?.accountId ? customers.get(mem.accountId) : null;
      const doc = userDocs.get(u.uid) || {};

      // What this person has done since signing up, most specific first.
      let kind = "none"; // signed up, no business yet
      if (platformUids.has(u.uid)) kind = "platform";
      else if (own) kind = "owner";
      else if (mem) kind = "member";

      const org = own || memberOrg;
      return {
        uid: u.uid,
        email: u.email || null,
        name: u.displayName || own?.fullName || doc.fullName || null,
        provider: u.providerData?.[0]?.providerId === "google.com" ? "Google" : "Email",
        emailVerified: !!u.emailVerified,
        disabled: !!u.disabled,
        createdAt: u.metadata.creationTime ? new Date(u.metadata.creationTime).toISOString() : null,
        lastLoginAt: u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).toISOString() : null,
        kind,
        organizationId: own ? u.uid : mem?.accountId || null,
        organizationName: org ? org.organizationName || org.companyName || null : null,
        businessCreatedAt: own ? toIso(own.createdAt) : null,
        status: own ? own.status || "trial" : null,
        planName: own?.planName || null,
        free: own?.billing === "complimentary",
        compReason: own?.compReason || null,
        trialEndDate: own ? toIso(own.trialEndDate) : null,
        appsUsed: own ? Object.keys(own.appUsage || {}) : [],
        country: own?.signupCountry || doc.signupCountry || null,
        city: own?.signupCity || doc.signupCity || null,
      };
    });

    users.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return NextResponse.json({ users });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
