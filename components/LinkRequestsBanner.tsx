"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";

type Req = { id: string; organizationName: string; profile: string; apps: string[] };

// A company asked this signed-in person (an existing username login) to join it. Nothing happens until they accept here.
export default function LinkRequestsBanner() {
  const [reqs, setReqs] = useState<Req[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function call(method: "GET" | "POST", body?: object) {
    const token = await auth.currentUser!.getIdToken();
    const r = await fetch("/api/link-requests", {
      method, headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Something went wrong");
    return d;
  }

  useEffect(() => {
    let off = false;
    call("GET").then((d) => { if (!off) setReqs(d.requests || []); }).catch(() => { /* a banner must never break the page */ });
    return () => { off = true; };
  }, []);

  async function answer(id: string, accept: boolean) {
    setBusy(id); setErr("");
    try {
      await call("POST", { id, accept });
      setReqs((l) => l.filter((x) => x.id !== id));
      if (accept) window.location.reload();
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy("");
  }

  if (!reqs.length) return null;
  return (
    <div role="region" aria-label="Company requests" style={{ background: "#eff6ff", borderTop: "1px solid #bfdbfe", padding: "10px 24px", fontSize: 14 }}>
      {reqs.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: "4px 0" }}>
          <span><strong>{r.organizationName}</strong> asked you to join as {r.profile}. Your login stays the same.</span>
          <button className="btn-primary-sm" disabled={busy === r.id} onClick={() => answer(r.id, true)}>Accept</button>
          <button className="btn-outline-dark" disabled={busy === r.id} onClick={() => answer(r.id, false)}>Decline</button>
        </div>
      ))}
      {err && <p className="error" style={{ margin: "4px 0 0" }}>{err}</p>}
    </div>
  );
}
