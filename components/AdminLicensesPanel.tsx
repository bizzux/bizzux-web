"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";

type License = {
  key: string;
  productId: string;
  email: string;
  status: string;
  source?: "admin" | "purchase";
  createdAt?: { _seconds: number } | string;
};

function formatDate(v: any) {
  if (!v) return "";
  const d = v._seconds ? new Date(v._seconds * 1000) : new Date(v);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

// Lets a Platform Owner/Admin mint a license key directly — no payment
// involved. Used for the maker's own personal-use copy and any comp'd
// support licenses; goes through the exact same activation path a paying
// customer's key does (see app/api/admin/licenses/route.js).
export default function AdminLicensesPanel() {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [justIssued, setJustIssued] = useState<string | null>(null);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);

  async function authHeader() {
    const token = await auth.currentUser?.getIdToken();
    return { Authorization: "Bearer " + token };
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/admin/licenses", { headers: await authHeader() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load licenses");
      setLicenses(d.licenses || []);
    } catch (e: any) {
      setError(e?.message || "Could not load licenses");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Revoking only makes the license fail its NEXT check — see the API
  // route's comment — so this doesn't uninstall anything or reach any
  // particular machine; it just means the app will stop working the next
  // time it's online and re-validates, however often that is.
  async function setStatus(key: string, status: "active" | "revoked") {
    if (status === "revoked" && !window.confirm(`Revoke license ${key}? It'll stop working the next time that app checks in online — this doesn't undo anything already recorded.`)) {
      return;
    }
    setUpdatingKey(key);
    setError("");
    try {
      const r = await fetch("/api/admin/licenses", {
        method: "PATCH",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ key, status }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not update that license");
      load();
    } catch (e: any) {
      setError(e?.message || "Could not update that license");
    }
    setUpdatingKey(null);
  }

  async function issue() {
    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Enter a valid email address first.");
      return;
    }
    setBusy(true);
    setError("");
    setJustIssued(null);
    try {
      const r = await fetch("/api/admin/licenses", {
        method: "POST",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, productId: "screen-recorder" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not generate license");
      setJustIssued(d.key);
      setEmail("");
      load();
    } catch (e: any) {
      setError(e?.message || "Could not generate license");
    }
    setBusy(false);
  }

  return (
    <div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 mb-5">
        <p className="text-sm font-semibold text-ink mb-2">Issue a Bizzux Screen Recorder license</p>
        <p className="text-xs text-slate-500 mb-3">
          No payment involved — use this for your own personal-use copy, or a comp'd/support license. The key is
          emailed the same way a purchase confirmation is.
        </p>
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            onClick={issue}
            disabled={busy}
            className="rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-brand-tealDark to-brand-blueDark px-4 py-2 disabled:opacity-50"
          >
            {busy ? "Issuing…" : "Issue key"}
          </button>
        </div>
        {justIssued && (
          <p className="text-sm mt-3 font-mono bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            {justIssued}
          </p>
        )}
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm p-3">{error}</div>}

      {loading ? (
        <p className="text-slate-400 text-sm py-8 text-center">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-4">Key</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Product</th>
                <th className="py-2 pr-4">Source</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Issued</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {licenses.map((l) => (
                <tr key={l.key} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-mono text-xs">{l.key}</td>
                  <td className="py-2 pr-4">{l.email}</td>
                  <td className="py-2 pr-4">{l.productId}</td>
                  <td className="py-2 pr-4">{l.source === "admin" ? "Admin-issued" : "Purchase"}</td>
                  <td className="py-2 pr-4">
                    <span className={l.status === "revoked" ? "text-red-600" : "text-emerald-600"}>{l.status}</span>
                  </td>
                  <td className="py-2 pr-4 text-slate-400">{formatDate(l.createdAt)}</td>
                  <td className="py-2 pr-4">
                    <button
                      onClick={() => setStatus(l.key, l.status === "revoked" ? "active" : "revoked")}
                      disabled={updatingKey === l.key}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50"
                    >
                      {updatingKey === l.key ? "…" : l.status === "revoked" ? "Reactivate" : "Revoke"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {licenses.length === 0 && <p className="text-slate-400 text-sm py-8 text-center">No licenses issued yet.</p>}
        </div>
      )}
    </div>
  );
}
