import { NextResponse } from "next/server";
import { requireSuperAdmin, getDb } from "@/lib/firebaseAdmin";
import { get } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Streams a career application's resume from the private Blob store. Resume
// files aren't publicly fetchable by URL (see /api/careers) — this route is
// the only way to read one back, and it's Super-Admin gated the same way
// /api/admin/career-applications is. AdminTabs.tsx fetches this with the
// signed-in admin's bearer token and turns the response into a download,
// since a plain <a href> can't attach an Authorization header.
export async function GET(req) {
  try {
    await requireSuperAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: e.message || "Super admin access required" }, { status: e.status || 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) throw { status: 400, message: "Application id required" };

    const doc = await getDb().doc("careerApplications/" + id).get();
    if (!doc.exists) throw { status: 404, message: "Application not found" };
    const data = doc.data();
    if (!data.resumeBlobPath) throw { status: 404, message: "No resume on file for this application" };

    const result = await get(data.resumeBlobPath, { access: "private" });
    if (!result || result.statusCode !== 200) {
      throw { status: 404, message: "Resume file could not be found in storage" };
    }

    const filename = (data.resumeFileName || "resume").replace(/[\r\n"]/g, "_");
    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not load the resume." }, { status: e.status || 500 });
  }
}
