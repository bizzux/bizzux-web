import { NextResponse } from "next/server";
import { Resend } from "resend";
import { requireUser, adminAuth } from "@/lib/firebaseAdmin";
import { verificationEmailHtml } from "@/lib/emailTemplates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Replaces the client SDK's sendEmailVerification(), which sends from
// Firebase's own shared address (noreply@<project-id>.firebaseapp.com) —
// no SPF/DKIM alignment with bizzux.com, so it lands in spam for a lot of
// inboxes. This route generates the same underlying Firebase verification
// link server-side (Admin SDK never sends anything on its own) and
// delivers it through Resend from a bizzux.com address instead, so it
// passes normal sender-authentication checks.
//
// Requires RESEND_API_KEY (and optionally RESEND_FROM_EMAIL) to be set —
// see .env.example. Until those are configured, this fails closed with a
// clear error rather than silently doing nothing.
export async function POST(req) {
  try {
    const c = await requireUser(req);

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw { status: 500, message: "Email delivery isn't configured yet. Contact support." };
    }

    let body = {};
    try {
      body = await req.json();
    } catch {
      // no body sent
    }
    const continueUrl = typeof body.continueUrl === "string" && body.continueUrl ? body.continueUrl : "https://bizzux.com/dashboard";

    const link = await adminAuth().generateEmailVerificationLink(c.email, {
      url: continueUrl,
      handleCodeInApp: false,
    });

    const resend = new Resend(apiKey);
    const from = process.env.RESEND_FROM_EMAIL || "Bizzux <verify@verify.bizzux.com>";
    const { error } = await resend.emails.send({
      from,
      to: c.email,
      subject: "Verify your email for Bizzux",
      html: verificationEmailHtml({ link }),
    });
    if (error) throw new Error(error.message || "Could not send verification email");

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
