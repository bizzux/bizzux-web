import { NextRequest, NextResponse } from "next/server";
import { getDb, getBucket } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const fullName = formData.get("fullName")?.toString() || "";
    const email = formData.get("email")?.toString() || "";
    const mobile = formData.get("mobile")?.toString() || "";
    const college = formData.get("college")?.toString() || null;
    const course = formData.get("course")?.toString() || null;
    const area = formData.get("area")?.toString() || null;
    const linkedin = formData.get("linkedin")?.toString() || null;
    const portfolio = formData.get("portfolio")?.toString() || null;
    const why = formData.get("why")?.toString() || null;
    const resume = formData.get("resume") as File | null;

    if (!fullName || !email || !mobile) {
      return NextResponse.json({ error: "Full name, email and mobile number are required." }, { status: 400 });
    }

    let resumeUrl: string | null = null;
    let resumeFileName: string | null = null;

    if (resume && resume.size > 0) {
      resumeFileName = resume.name;
      try {
        const bucket = getBucket();
        const buffer = Buffer.from(await resume.arrayBuffer());
        const path = `resumes/${Date.now()}-${resume.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const file = bucket.file(path);
        await file.save(buffer, { contentType: resume.type || "application/octet-stream" });
        resumeUrl = path;
      } catch (uploadErr) {
        console.error("Resume upload failed, continuing without file:", uploadErr);
      }
    }

    const db = getDb();
    await db.collection("careerApplications").add({
      fullName,
      email,
      mobile,
      college,
      course,
      area,
      linkedin,
      portfolio,
      why,
      resumeFileName,
      resumeUrl,
      createdAt: new Date().toISOString(),
      source: "bizzux.com/careers",
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Careers form error:", err);
    return NextResponse.json(
      { error: "We couldn't submit your application right now. Please try again shortly." },
      { status: 500 }
    );
  }
}
