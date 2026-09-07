"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/firebase";
import Nav from "@/components/Nav";
import { useMe } from "@/lib/useMe";

async function api(path, method, body) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function MeetingDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useMe();
  const [meeting, setMeeting] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user === null) router.push("/sign-in");
  }, [user, router]);

  async function load() {
    try {
      const d = await api(`/api/notes/${id}`, "GET");
      setMeeting(d.meeting);
    } catch (e) {
      setErr(e.message || "Couldn't load this meeting.");
    }
  }

  useEffect(() => {
    if (!user) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  // The <audio> tag can't attach an Authorization header, so the playable
  // src is a blob: URL built from an authenticated fetch — same reason
  // AdminTabs.tsx does this for resume downloads.
  useEffect(() => {
    if (!meeting?.hasAudio || !user) return;
    let revoke;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/notes/${id}/audio`, { headers: { Authorization: "Bearer " + token } });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        revoke = url;
        setAudioUrl(url);
      } catch {
        // Playback just won't be available — transcript/summary still show.
      }
    })();
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [meeting?.hasAudio, user, id]);

  async function resummarize() {
    setBusy(true);
    setErr("");
    try {
      await api("/api/notes", "POST", { action: "resummarize", id });
      await load();
    } catch (e) {
      setErr(e.message || "Couldn't regenerate the summary.");
    }
    setBusy(false);
  }

  async function remove() {
    if (!confirm("Delete this meeting? This can't be undone.")) return;
    try {
      await api("/api/notes", "POST", { action: "delete", id });
      router.push("/notes");
    } catch (e) {
      setErr(e.message || "Couldn't delete this meeting.");
    }
  }

  if (err && !meeting) {
    return (
      <div>
        <Nav />
        <div className="admin-shell">
          <p className="error">{err}</p>
          <Link href="/notes" className="btn-primary-sm">Back to meetings</Link>
        </div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div>
        <Nav />
        <div className="admin-shell"><p className="muted">Loading…</p></div>
      </div>
    );
  }

  return (
    <div>
      <Nav />
      <div className="admin-shell" style={{ maxWidth: 780 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <div>
            <h1 className="dash-heading" style={{ fontSize: 20, marginBottom: 4 }}>{meeting.title}</h1>
            <p className="dash-sub" style={{ marginBottom: 0 }}>
              {meeting.startedAt ? new Date(meeting.startedAt).toLocaleString() : ""}
            </p>
          </div>
          <Link href="/notes" className="link-btn">Back to meetings</Link>
        </div>

        {err && <p className="error" style={{ margin: "12px 0" }}>{err}</p>}

        {meeting.status === "recording" && (
          <p className="muted" style={{ marginTop: 12 }}>
            This meeting is still marked as recording — it may have ended unexpectedly. The transcript below is
            whatever was auto-saved before that happened.
          </p>
        )}
        {meeting.status === "processing" && (
          <p className="muted" style={{ marginTop: 12 }}>Generating summary…</p>
        )}

        {audioUrl && (
          <div className="card" style={{ marginTop: 16 }}>
            <audio controls src={audioUrl} style={{ width: "100%" }} />
          </div>
        )}

        <div className="card" style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h2 style={{ fontSize: 15, margin: 0 }}>Summary</h2>
            <button className="link-btn" onClick={resummarize} disabled={busy}>
              {busy ? "Regenerating…" : "Regenerate summary"}
            </button>
          </div>
          {meeting.summaryStatus === "failed" && (
            <p className="error" style={{ marginBottom: 10 }}>Summary generation failed{meeting.error ? `: ${meeting.error}` : "."}</p>
          )}
          {meeting.summary?.text ? (
            <p style={{ whiteSpace: "pre-wrap" }}>{meeting.summary.text}</p>
          ) : (
            <p className="muted">No summary yet.</p>
          )}
          {meeting.summary?.actionItems?.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, marginTop: 16, marginBottom: 8, textTransform: "uppercase", color: "var(--muted, #64748b)" }}>
                Action items
              </h3>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {meeting.summary.actionItems.map((a, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    {a.text}
                    {a.owner && <span className="muted"> — {a.owner}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 10 }}>Transcript</h2>
          {meeting.transcript?.text ? (
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{meeting.transcript.text}</p>
          ) : (
            <p className="muted">No transcript recorded.</p>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <button className="link-btn danger" onClick={remove}>Delete meeting</button>
        </div>
      </div>
    </div>
  );
}
