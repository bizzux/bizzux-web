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
      </div>
    </div>
  );
}
