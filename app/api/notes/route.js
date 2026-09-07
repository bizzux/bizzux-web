import { NextResponse } from "next/server";
import { requireUser, resolveAccount, adminDb } from "@/lib/firebaseAdmin";
import { canAccessApps } from "@/lib/trial";
import { summarizeTranscript } from "@/lib/groq";
import { FieldValue } from "firebase-admin/firestore";
import { del } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function meetingsCollection(accountId) {
  return adminDb().collection("customers/" + accountId + "/notesMeetings");
}

function toIso(ts) {
  if (!ts) return null;
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
}

// Same defense-in-depth shape as /api/shop-sso: the UI already hides/greys
// out the tile when canAccessApps() is false, this just stops someone from
// hitting the API directly after their trial lapses mid-session.
async function requireAccountWithAppsAccess(req) {
  const c = await requireUser(req);
  const acct = await resolveAccount(c.uid);
  const customer = acct.isOwner
    ? acct.customer
    : (await adminDb().doc("customers/" + acct.accountId).get()).data();
  if (!canAccessApps(customer)) {
    throw { status: 402, message: "Your trial has ended. Choose a plan to keep using Bizzux apps." };
  }
  return { ...c, ...acct };
}

export async function GET(req) {
  try {
    const acct = await requireAccountWithAppsAccess(req);
    const snap = await meetingsCollection(acct.accountId).orderBy("startedAt", "desc").get();
    const meetings = snap.docs.map((d) => {
      const m = d.data();
      return {
        id: d.id,
        title: m.title || "Untitled meeting",
        status: m.status || "recording",
        startedAt: toIso(m.startedAt),
        durationSec: m.durationSec ?? null,
      };
    });
    return NextResponse.json({ meetings });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const acct = await requireAccountWithAppsAccess(req);
    const body = await req.json();

    if (body.action === "start") {
      const ref = await meetingsCollection(acct.accountId).add({
        title: body.title?.trim() || `Meeting on ${new Date().toLocaleDateString()}`,
        createdBy: acct.uid,
        createdByEmail: acct.email,
        startedAt: FieldValue.serverTimestamp(),
        endedAt: null,
        durationSec: null,
        status: "recording",
        transcript: { text: "", segments: [] },
        lastSavedAt: null,
        audioBlobPath: null,
        audioContentType: null,
        audioSizeBytes: null,
        summary: null,
        summaryStatus: "pending",
        error: null,
      });
      return NextResponse.json({ id: ref.id });
    }

    // Periodic crash-recovery write while a meeting is still recording —
    // see app/(saas)/notes/new/page.js. Only ever touches the transcript,
    // never audio (the recording itself is only uploaded once, at Stop).
    if (body.action === "autosave") {
      const id = String(body.id || "");
      if (!id) throw { status: 400, message: "Meeting id required" };
      const ref = meetingsCollection(acct.accountId).doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Meeting not found" };
      await ref.update({
        transcript: {
          text: String(body.transcriptText || ""),
          segments: Array.isArray(body.segments) ? body.segments : [],
        },
        lastSavedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "finalize") {
      const id = String(body.id || "");
      if (!id) throw { status: 400, message: "Meeting id required" };
      const ref = meetingsCollection(acct.accountId).doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Meeting not found" };

      const transcriptText = String(body.transcriptText || "");
      await ref.update({
        transcript: {
          text: transcriptText,
          segments: Array.isArray(body.segments) ? body.segments : [],
        },
        endedAt: FieldValue.serverTimestamp(),
        durationSec: typeof body.durationSec === "number" ? body.durationSec : null,
        audioBlobPath: body.audioBlobPath || null,
        audioContentType: body.audioContentType || null,
        audioSizeBytes: typeof body.audioSizeBytes === "number" ? body.audioSizeBytes : null,
        status: "processing",
      });

      try {
        const title = (snap.data().title) || "Untitled meeting";
        const { summary, actionItems } = await summarizeTranscript(transcriptText, { title });
        await ref.update({
          summary: { text: summary, actionItems },
          summaryStatus: "done",
          status: "ready",
        });
      } catch (e) {
        console.error("Notes: summarization failed for", id, "-", e.message || e);
        await ref.update({ summaryStatus: "failed", status: "ready", error: e.message || "Summarization failed" });
      }

      return NextResponse.json({ ok: true });
    }

    if (body.action === "resummarize") {
      const id = String(body.id || "");
      if (!id) throw { status: 400, message: "Meeting id required" };
      const ref = meetingsCollection(acct.accountId).doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Meeting not found" };
      const m = snap.data();

      try {
        const { summary, actionItems } = await summarizeTranscript(m.transcript?.text, { title: m.title });
        await ref.update({ summary: { text: summary, actionItems }, summaryStatus: "done", error: null });
      } catch (e) {
        await ref.update({ summaryStatus: "failed", error: e.message || "Summarization failed" });
        throw { status: 500, message: e.message || "Summarization failed" };
      }

      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete") {
      const id = String(body.id || "");
      if (!id) throw { status: 400, message: "Meeting id required" };
      const ref = meetingsCollection(acct.accountId).doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw { status: 404, message: "Meeting not found" };
      const audioBlobPath = snap.data().audioBlobPath;
      await ref.delete();
      if (audioBlobPath) {
        await del(audioBlobPath).catch((e) => {
          console.error("Notes: failed to delete blob", audioBlobPath, "-", e.message || e);
        });
      }
      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
