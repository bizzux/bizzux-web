import { NextResponse } from "next/server";
import { Resend } from "resend";
import { requireSuperAdmin, adminDb } from "@/lib/firebaseAdmin";
import { PRODUCTS, generateLicenseKey } from "@/lib/licenses";
import { licenseKeyEmailHtml } from "@/lib/emailTemplates";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOWNLOAD_URL = "https://bizzux.com/screen-recorder/download";

// Manual license issuance — no payment involved. Used for comp'd/support
// licenses and for the maker's own personal-use copy of a product (same
// activation path a paying customer's key goes through, just minted
// directly here instead of via ./verify after a Razorpay payment).
export async function GET(req) {
  try {
    await requireSuperAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: e.message || "Super admin access required" }, { status: e.status || 403 });
  }
  try {
    const snap = await adminDb().collection("licenses").orderBy("createdAt", "desc").limit(200).get();
    const licenses = snap.docs.map((doc) => doc.data());
    return NextResponse.json({ licenses });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not load licenses." }, { status: 500 });
  }
}

export async function POST(req) {
  let admin;
  try {
    admin = await requireSuperAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: e.message || "Super admin access required" }, { status: e.status || 403 });
  }
  try {
    const { email, productId, sendEmail } = await req.json();
    const cleanEmail = (email || "").trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      throw { status: 400, message: "A valid email address is required." };
    }
    const product = PRODUCTS[productId] || PRODUCTS["screen-recorder"];
    const resolvedProductId = PRODUCTS[productId] ? productId : "screen-recorder";
    const key = generateLicenseKey();

    await adminDb().collection("licenses").doc(key).set({
      key,
      productId: resolvedProductId,
      email: cleanEmail,
      status: "active",
      source: "admin",
      issuedBy: admin.email,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (sendEmail !== false) {
      const apiKey = process.env.RESEND_API_KEY;
      if (apiKey) {
        const resend = new Resend(apiKey);
        const from = process.env.RESEND_FROM_EMAIL || "Bizzux <verify@verify.bizzux.com>";
        await resend.emails.send({
          from,
          to: cleanEmail,
          subject: `Your ${product.name} license key`,
          html: licenseKeyEmailHtml({ key, productName: product.name, downloadUrl: DOWNLOAD_URL }),
        }).catch(() => {});
      }
    }

    return NextResponse.json({ ok: true, key });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not generate license." }, { status: e.status || 500 });
  }
}

// Flips a license active/revoked. Doesn't know or care which machine(s) a
// key was activated on (that's not tracked yet — see AdminLicensesPanel's
// comment) — this just makes the NEXT license check for that key fail, so
// it only takes effect once the installed app is online again and re-
// validates, however often that happens to be.
export async function PATCH(req) {
  try {
    await requireSuperAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: e.message || "Super admin access required" }, { status: e.status || 403 });
  }
  try {
    const { key, status } = await req.json();
    const clean = (key || "").trim().toUpperCase();
    if (!clean) throw { status: 400, message: "A license key is required." };
    if (status !== "active" && status !== "revoked") {
      throw { status: 400, message: "status must be 'active' or 'revoked'." };
    }
    const ref = adminDb().collection("licenses").doc(clean);
    const snap = await ref.get();
    if (!snap.exists) throw { status: 404, message: "No license found for that key." };
    await ref.update({ status });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not update that license." }, { status: e.status || 500 });
  }
}
