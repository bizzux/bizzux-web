import { NextRequest, NextResponse } from "next/server";
import { adminDb, requireUser } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

// Public reviews, submitted by any signed-in Firebase user (Google sign-in
// on the About page — see components/ReviewForm.tsx) but never shown live:
// every review is created with status "pending" and only appears on the
// public site once a Platform Owner/Admin approves it from /admin (see
// app/api/admin/reviews/route.ts). This is deliberate — see the "will
// reviews help credibility" conversation this feature came out of: an
// open, unmoderated review wall on your own site is a credibility risk,
// not a boost, so nothing goes live unreviewed.
//
// Deliberately does NOT call /api/claim (unlike the real sign-in flow) —
// leaving a review must never create a customers/{uid} SaaS account record
// or start a trial for someone who's just visiting the marketing site.
function reviewsCollection() {
  return adminDb().collection("reviews");
}

export async function POST(req: NextRequest) {
  try {
    const c = await requireUser(req);
    const body = await req.json();
    const text = (body.text || "").trim();
    const rating = Number(body.rating);
    if (!text || text.length < 10) {
      return NextResponse.json({ error: "Please write at least a short sentence." }, { status: 400 });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Please pick a star rating." }, { status: 400 });
    }

    // One review per person, kept up to date rather than duplicated if they
    // submit again — re-submitting resets it to "pending" so an edited
    // review can't skip re-approval.
    const existing = await reviewsCollection().where("uid", "==", c.uid).limit(1).get();
    const payload = {
      uid: c.uid,
      name: (body.name || "").trim() || "Anonymous",
      photoUrl: body.photoUrl || null,
      rating,
      text,
      status: "pending",
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!existing.empty) {
      await existing.docs[0].ref.update(payload);
    } else {
      await reviewsCollection().add({ ...payload, createdAt: FieldValue.serverTimestamp() });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
