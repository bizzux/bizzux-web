import { NextResponse } from "next/server";
import { requireUser, resolveAccount, adminDb } from "@/lib/firebaseAdmin";
import { loadOrgSubject } from "@/lib/authz/orgAuthz";
import { getOrganizationAppSubscriptions } from "@/lib/appAccess";
import { shapeMenu, MENU_APPS } from "@/lib/shell/menuModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/shell/menu[?app=attendance]  (Bearer token; CORS for *.bizzux.com is added by the root middleware)
// The ONE place that decides what the shared profile menu shows, from the same policy the servers enforce. Never throws a permission error to the
// header: a person with no company, or any failure, gets a minimal menu (just who they are) so the app's header always renders.
export async function GET(req) {
  let c;
  try { c = await requireUser(req); } catch (e) { return NextResponse.json({ error: e.message || "Not signed in" }, { status: e.status || 401 }); }
  const person = { name: c.name || c.email || "", email: c.email || "" };
  try {
    const current = String(new URL(req.url).searchParams.get("app") || "").slice(0, 30);
    let acct;
    try { acct = await resolveAccount(c.uid); } catch { return NextResponse.json({ ...shapeMenu({ person }), support: false }, { headers: { "Cache-Control": "private, max-age=30" } }); }
    const db = adminDb();
    const [orgSubject, subList, assigns, mem, org] = await Promise.all([
      loadOrgSubject(db, acct, c.uid),
      getOrganizationAppSubscriptions(acct.accountId),
      db.collection("appAssignments").where("organizationId", "==", acct.accountId).where("userId", "==", c.uid).get(),
      acct.isOwner ? null : db.doc(`organizationMemberships/${acct.accountId}_${c.uid}`).get(),
      acct.isOwner ? Promise.resolve({ data: () => acct.customer }) : db.doc("customers/" + acct.accountId).get(),
    ]);
    const subscriptions = Object.fromEntries(subList.map((s) => [s.appId, s]));
    const assignments = Object.fromEntries(assigns.docs.map((d) => [d.data().appId, d.data()]));
    const orgData = org?.data?.() || {};
    const menu = shapeMenu({
      person, organization: { id: acct.accountId, name: orgData.organizationName || orgData.companyName || "" }, orgSubject, isPlatform: false, // a Platform Admin with a company of their own is an ordinary member of it; support sessions are a separate flow
      currentApp: MENU_APPS.some((a) => a.key === current) ? current : "", subscriptions, assignments, membership: mem && mem.exists ? mem.data() : null,
      policyMode: process.env.ENTITLEMENT_POLICY === "strict" ? "strict" : "legacy",
    });
    return NextResponse.json(menu, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (e) {
    console.error("[shell/menu]", e?.message || e);
    return NextResponse.json(shapeMenu({ person }), { headers: { "Cache-Control": "no-store" } });
  }
}
