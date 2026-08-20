import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { put } from "@vercel/blob";

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

    let resumeBlobPath: string | null = null;
    let resumeFileName: string | null = null;

    if (resume && resume.size > 0) {
      resumeFileName = resume.name;
      try {
        // Private Vercel Blob store (not Firebase Storage — that requires
        // the Firebase project to be on the paid Blaze plan just to
        // provision a bucket, which this project isn't on). Requires a
        // Blob store to exist and be connected to this Vercel project;
        // BLOB_READ_WRITE_TOKEN (or OIDC when running on Vercel) is picked
        // up automatically once that's set up. "private" access means the
        // resulting URL isn't publicly fetchable — only the admin route
        // (which streams it back after a Super Admin check) can read it.
        const path = `resumes/${Date.now()}-${resume.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const blob = await put(path, resume, {
          access: "private",
          contentType: resume.type || "application/octet-stream",
        });
        resumeBlobPath = blob.pathname;
      } catch (uploadErr: any) {
        // Application still gets saved (name/email/mobile matter more than
        // the resume) but the applicant's chosen file name is kept even
        // though resumeBlobPath stays null, so the admin table can tell "a
        // file was picked but the upload failed" apart from "no file was
        // picked" instead of both looking identical. Logged with the real
        // error (not just a generic message) since this is currently the
        // only place this failure is visible at all — check that a Blob
        // store exists and is connected to this project if this shows up.
        console.error(
          "Resume upload failed for",
          resumeFileName,
          "- application saved without it. Cause:",
          uploadErr?.message || uploadErr,
          uploadErr?.code ? `(code: ${uploadErr.code})` : ""
        );
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
      resumeBlobPath,
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
