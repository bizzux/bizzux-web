import { NextRequest, NextResponse } from "next/server";
import { adminDb, requireSuperAdmin } from "@/lib/firebaseAdmin";
import { parseBody, estimateReadTime } from "@/lib/blog";

export const runtime = "nodejs";

function blogCollection() {
  return adminDb().collection("blogPosts");
}

export async function PATCH(req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    await requireSuperAdmin(req);
    const ref = blogCollection().doc(params.slug);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const { title, excerpt, tags, bodyText, date, status, coverImage } = await req.json();
    const update: Record<string, unknown> = {};
    if (typeof title === "string" && title.trim()) update.title = title.trim();
    if (typeof excerpt === "string") update.excerpt = excerpt.trim();
    if (Array.isArray(tags)) update.tags = tags.filter(Boolean);
    if (typeof date === "string" && date) update.date = date;
    if (typeof status === "string" && ["draft", "published"].includes(status)) update.status = status;
    if (typeof coverImage === "string") update.coverImage = coverImage || null;
    if (typeof bodyText === "string") {
      const body = parseBody(bodyText);
      update.body = body;
      update.readTime = estimateReadTime(body);
    }

    await ref.update(update);
    const updated = await ref.get();
    return NextResponse.json({ ok: true, post: updated.data() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    await requireSuperAdmin(req);
    await blogCollection().doc(params.slug).delete();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
