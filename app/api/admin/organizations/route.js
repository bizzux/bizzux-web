import { NextResponse } from "next/server";
import { requireOrgManager, adminDb } from "@/lib/firebaseAdmin";
import { COUNTRIES } from "@/lib/countries";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Provisioning of a brand-new customer organization — deliberately a
// separate `organizations` collection, NOT `customers`. `customers/{uid}`
// docs are keyed by a real Firebase Auth uid created through the actual
// signup flow (see /api/claim); an organization provisioned here doesn't
// have a signed-in owner yet, so it can't safely reuse that collection or
// its id scheme without risking collisions with (or being mistaken for) a
// real account. Turning one of these into an actual `customers/{uid}`
// account, once someone signs up and claims it, is a separate step not
// built yet.
//
// Gated by requireOrgManager: the Super Admin, plus anyone holding the
// Global Admin or Admin profile on their own account (see
// lib/firebaseAdmin.js for why that's intentional, not a loophole).

const USER_RANGES = ["1-10", "11-20", "21-50", "51-100", "101-200", "201-500", "500+"];
const COUNTRY_CODES = new Set(COUNTRIES.map(([code]) => code));

function toIso(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
}

export async function GET(req) {
  try {
    await requireOrgManager(req);
    const snap = await adminDb().collection("organizations").orderBy("createdAt", "desc").get();
    const organizations = snap.docs.map((d) => {
      const data = d.data();
      return { id: d.id, ...data, createdAt: toIso(data.createdAt) };
    });
    return NextResponse.json({ organizations });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const c = await requireOrgManager(req);
    const body = await req.json();

    if (body.action === "delete") {
      if (!body.id) throw { status: 400, message: "Organization id required" };
      await adminDb().doc("organizations/" + body.id).delete();
      return NextResponse.json({ ok: true });
    }

    // create (the only other supported action)
    const organizationName = String(body.organizationName || "").trim().slice(0, 160);
    if (!organizationName) throw { status: 400, message: "Organization name is required" };

    const countryCode = String(body.countryCode || "").trim().toUpperCase();
    const country = COUNTRIES.find(([code]) => code === countryCode);
    if (!country) throw { status: 400, message: "Choose a valid country" };

    const state = String(body.state || "").trim().slice(0, 100);

    const timezone = String(body.timezone || "").trim().slice(0, 60);
    if (!timezone) throw { status: 400, message: "Time zone is required" };

    const currency = String(body.currency || "").trim().toUpperCase().slice(0, 10);
    if (!currency) throw { status: 400, message: "Currency is required" };

    const userRange = String(body.userRange || "");
    if (!USER_RANGES.includes(userRange)) throw { status: 400, message: "Choose a valid number of users" };

    const planId = String(body.planId || "").trim();
    if (!planId) throw { status: 400, message: "Profile (plan) is required" };
    const planSnap = await adminDb().doc("plans/" + planId).get();
    if (!planSnap.exists) throw { status: 400, message: "That plan no longer exists — refresh and try again" };
    const planName = planSnap.data().name || "";

    const ref = await adminDb().collection("organizations").add({
      organizationName,
      countryCode,
      countryName: country[1],
      state,
      timezone,
      currency,
      userRange,
      planId,
      planName,
      status: "pending", // not yet claimed by a real signed-in account
      createdBy: c.email,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, id: ref.id });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
