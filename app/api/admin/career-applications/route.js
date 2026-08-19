import { NextResponse } from "next/server";
import { requireSuperAdmin, getDb, getBucket } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Moved from app/admin/page.tsx's server-side getApplications() when the
// old cookie/ADMIN_PASSWORD gate on /admin was removed in favor of the same
// Firebase-Auth Super Admin check every other admin surface uses
// (requireSuperAdmin, same as /api/admin/plans etc.). Career application
// data (names, emails, phone numbers, resume links) must never render into
// a server-rendered page before an auth check runs, so this now lives
// behind a bearer-token-gated API route that AdminTabs calls client-side.
export async function GET(req) {
  try {
    await requireSuperAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: e.message || "Super admin access required" }, { status: e.status || 403 });
  }

  try {
    const db = getDb();
    const snap = await db.collection("careerApplications").orderBy("createdAt", "desc").get();
    const bucket = getBucket();

    const apps = await Promise.all(
      snap.docs.map(async (doc) => {
        const data = doc.data();
        let resumeSignedUrl = null;
        if (data.resumeUrl) {
          try {
            const [url] = await bucket.file(data.resumeUrl).getSignedUrl({
              action: "read",
              expires: Date.now() + 15 * 60 * 1000,
            });
            resumeSignedUrl = url;
          } catch {
            resumeSignedUrl = null;
          }
        }
        return { id: doc.id, ...data, resumeSignedUrl };
      })
    );

    return NextResponse.json({ apps });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not load applications." }, { status: 500 });
  }
}
