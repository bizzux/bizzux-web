import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, business, mobile, businessType, shops, challenge, preferredTime } = body || {};

    if (!name || !business || !mobile) {
      return NextResponse.json({ error: "Name, business name and mobile number are required." }, { status: 400 });
    }

    const db = getDb();
    await db.collection("leads").add({
      name,
      business,
      mobile,
      businessType: businessType || null,
      shops: shops || null,
      challenge: challenge || null,
      preferredTime: preferredTime || null,
      createdAt: new Date().toISOString(),
      source: "bizzux.com/contact",
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Contact form error:", err);
    return NextResponse.json(
      { error: "We couldn't save your request right now. Please try again shortly." },
      { status: 500 }
    );
  }
}
