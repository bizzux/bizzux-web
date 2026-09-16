import { NextRequest, NextResponse } from "next/server";
import { adminDb, requireSuperAdmin } from "@/lib/firebaseAdmin";
import { parseBody, slugify, estimateReadTime } from "@/lib/blog";

export const runtime = "nodejs";

function blogCollection() {
  return adminDb().collection("blogPosts");
}

export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const snap = await blogCollection().orderBy("date", "desc").get();
    const posts = snap.docs.map((d) => d.data());
    return NextResponse.json({ posts });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const { title, excerpt, tags, bodyText, date, status, coverImage } = await req.json();
    if (!title || !title.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    const body = parseBody(bodyText || "");
    let slug = slugify(title);
    if (!slug) return NextResponse.json({ error: "Title must contain at least one letter or number" }, { status: 400 });

    // If this slug is already taken, append -2, -3, etc. — keeps posting
    // fast (no manual slug field to fill in) without ever silently
    // overwriting an existing post.
    let candidate = slug;
    let n = 2;
    while ((await blogCollection().doc(candidate).get()).exists) {
      candidate = `${slug}-${n}`;
      n++;
    }
    slug = candidate;

    const post = {
      slug,
      title: title.trim(),
      excerpt: (excerpt || "").trim(),
      date: date || new Date().toISOString().slice(0, 10),
      readTime: estimateReadTime(body),
      tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
      body,
      status: status === "published" ? "published" : "draft",
      coverImage: typeof coverImage === "string" && coverImage ? coverImage : null,
    };
    await blogCollection().doc(slug).set(post);
    return NextResponse.json({ ok: true, post });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
