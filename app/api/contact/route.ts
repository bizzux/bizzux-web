import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, business, interest, message } = body || {};

    if (!name || !email) {
      return NextResponse.json({ error: "Name and email are required." }, { status: 400 });
    }

    const db = getDb();
    await db.collection("leads").add({
      name,
      email,
      business: business || null,
      interest: interest || "other",
      message: message || null,
      createdAt: new Date().toISOString(),
      source: "bizzux.com/contact",
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Contact form error:", err);
    return NextResponse.json(
      { error: "We couldn't save your message right now. Please try again shortly." },
      { status: 500 }
    );
  }
}
