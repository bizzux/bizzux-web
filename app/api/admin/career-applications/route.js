import { NextResponse } from "next/server";
import { requireSuperAdmin, getDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Moved from app/admin/page.tsx's server-side getApplications() when the
// old cookie/ADMIN_PASSWORD gate on /admin was removed in favor of the same
// Firebase-Auth Super Admin check every other admin surface uses
// (requireSuperAdmin, same as /api/admin/plans etc.). Career application
// data (names, emails, phone numbers, resume links) must never render into
// a server-rendered page before an auth check runs, so this now lives
// behind a bearer-token-gated API route that AdminTabs calls client-side.
//
// Resumes live in a private Vercel Blob store (see /api/careers), not a
// publicly-fetchable URL, so this route no longer hands out a download
// link directly — it just tells the table whether resumeBlobPath exists.
// The actual file is streamed through /api/admin/resume-file (also
// Super-Admin gated) only when the admin clicks Download.
export async function GET(req) {
  try {
    await requireSuperAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: e.message || "Super admin access required" }, { status: e.status || 403 });
  }

  try {
    const db = getDb();
    const snap = await db.collection("careerApplications").orderBy("createdAt", "desc").get();
    const apps = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return NextResponse.json({ apps });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not load applications." }, { status: 500 });
  }
}
