"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import Nav from "@/components/Nav";
import { useMe } from "@/lib/useMe";

// Ask to join an existing company with the code its admin gave you. The answer is always the same, so codes cannot be guessed or probed.
export default function JoinCompanyPage() {
  const router = useRouter();
  const { user } = useMe();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState(null);
  // A shared join link (/join-company?code=BZ...) pre-fills the code.
  useEffect(() => { try { const c = new URLSearchParams(window.location.search).get("code"); if (c) setCode(c.slice(0, 16)); } catch { /* no query */ } }, []);
  async function search(e) {
    e.preventDefault(); setErr(""); setFound(null);
    try {
      const token = await auth.currentUser.getIdToken();
      const r = await fetch("/api/join-requests?search=" + encodeURIComponent(q), { headers: { Authorization: "Bearer " + token } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Search failed");
      setFound(d.results);
    } catch (x) { setErr(x.message); }
  }
  useEffect(() => { if (user === null) router.push("/sign-in"); }, [user, router]);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr(""); setResult("");
    try {
      const token = await auth.currentUser.getIdToken();
      const r = await fetch("/api/join-requests", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ action: "request", code, message }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Request failed");
      setResult(d.message);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <div>
      <Nav />
      <div className="admin-shell" style={{ maxWidth: 520 }}>
        <h1 className="dash-heading" style={{ fontSize: 20 }}>Ask to join your company</h1>
        <p className="dash-sub">Enter the company code your admin gave you. An admin will review your request.</p>
        <form onSubmit={submit} className="card" style={{ display: "grid", gap: 10, padding: 16 }}>
          <label>Company code<input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="BZ1A2B3C" autoCapitalize="characters" required /></label>
          <label>Message to the admin (optional)<textarea className="input" rows={3} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
          {err && <p className="error">{err}</p>}
          {result && <p className="muted">{result}</p>}
          <button className="btn-primary" disabled={busy || !code.trim()}>{busy ? "Sending…" : "Send request"}</button>
        </form>
        <form onSubmit={search} className="card" style={{ display: "grid", gap: 10, padding: 16, marginTop: 14 }}>
          <label>No code? Search by company name<input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="At least 3 letters" /></label>
          <button className="btn-outline-dark" disabled={q.trim().length < 3}>Search</button>
          {found && found.length === 0 && <p className="muted">No company found. Some companies are not listed; ask your admin for the code or link.</p>}
          {found && found.map((f) => <button type="button" key={f.code} className="btn-outline-dark" onClick={() => setCode(f.code)}>{f.name}</button>)}
        </form>
      </div>
    </div>
  );
}
