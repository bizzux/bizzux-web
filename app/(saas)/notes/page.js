"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

const STATUS_LABEL = {
  recording: "Recording",
  processing: "Processing…",
  ready: "Ready",
  failed: "Failed",
};

function fmtDuration(sec) {
  if (!sec && sec !== 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function NotesPage() {
  const router = useRouter();
  const { user } = useMe();
  const [meetings, setMeetings] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (user === null) router.push("/sign-in");
  }, [user, router]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const d = await api("/api/notes", "GET");
        setMeetings(d.meetings || []);
      } catch (e) {
        if (e.message && e.message.toLowerCase().includes("trial")) {
          setErr(e.message);
        } else {
          setErr("Couldn't load your meetings right now.");
        }
        setMeetings([]);
      }
    })();
  }, [user]);

  return (
    <div>
      <Nav />
      <div className="admin-shell">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <h1 className="dash-heading" style={{ fontSize: 20 }}>Bizzux Notes</h1>
            <p className="dash-sub" style={{ marginBottom: 0 }}>Record meetings, get a live transcript, and an AI summary when you're done.</p>
          </div>
          <Link href="/notes/new" className="btn-primary-sm">+ New meeting</Link>
        </div>

        {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}

        <div className="card">
          {meetings === null && !err && <p className="muted">Loading…</p>}
          {meetings && meetings.length === 0 && !err && (
            <p className="muted">No meetings yet. Start one to see it here.</p>
          )}
          {meetings && meetings.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th><th>Date</th><th>Duration</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((m) => (
                  <tr key={m.id}>
                    <td>{m.title}</td>
                    <td>{m.startedAt ? new Date(m.startedAt).toLocaleString() : "—"}</td>
                    <td>{fmtDuration(m.durationSec)}</td>
                    <td>
                      <span className={"status-pill " + (m.status === "ready" ? "active" : m.status === "failed" ? "expired" : "trial")}>
                        {STATUS_LABEL[m.status] || m.status}
                      </span>
                    </td>
                    <td>
                      <Link href={`/notes/${m.id}`} className="link-btn">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
