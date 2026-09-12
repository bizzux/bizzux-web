"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";

type Review = {
  id: string;
  name: string;
  photoUrl?: string | null;
  rating: number;
  text: string;
  status: "pending" | "approved" | "rejected";
  createdAt?: { _seconds: number } | string;
};

const FILTERS: { id: Review["status"] | "all"; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "all", label: "All" },
];

function formatDate(v: any) {
  if (!v) return "";
  const d = v._seconds ? new Date(v._seconds * 1000) : new Date(v);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

// Nothing submitted via /api/reviews (the public About-page form) ever
// shows on the site until it's approved here — see that route's comment
// for why an open, unmoderated review wall was deliberately ruled out.
export default function AdminReviewsPanel() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Review["status"] | "all">("pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function authHeader() {
    const token = await auth.currentUser?.getIdToken();
    return { Authorization: "Bearer " + token };
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/admin/reviews", { headers: await authHeader() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load reviews");
      setReviews(d.reviews || []);
    } catch (e: any) {
      setError(e?.message || "Could not load reviews");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function setStatus(id: string, status: Review["status"]) {
    setBusyId(id);
    try {
      const r = await fetch("/api/admin/reviews", {
        method: "PATCH",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Could not update");
      setReviews((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch (e: any) {
      setError(e?.message || "Could not update");
    }
    setBusyId(null);
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this review permanently?")) return;
    setBusyId(id);
    try {
      const r = await fetch("/api/admin/reviews?id=" + id, { method: "DELETE", headers: await authHeader() });
      if (!r.ok) throw new Error((await r.json()).error || "Could not delete");
      setReviews((rs) => rs.filter((r) => r.id !== id));
    } catch (e: any) {
      setError(e?.message || "Could not delete");
    }
    setBusyId(null);
  }

  const shown = filter === "all" ? reviews : reviews.filter((r) => r.status === filter);
  const pendingCount = reviews.filter((r) => r.status === "pending").length;

  return (
    <div>
      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg w-fit mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              filter === f.id ? "bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white shadow-sm" : "text-slate-800"
            }`}
          >
            {f.label}{f.id === "pending" && pendingCount > 0 ? ` (${pendingCount})` : ""}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm p-3">{error}</div>}

      {loading ? (
        <p className="text-slate-400 text-sm py-8 text-center">Loading…</p>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-100 shrink-0">
                    {r.photoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.photoUrl} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{r.name}</p>
                    <p className="text-xs text-slate-400">{formatDate(r.createdAt)}</p>
                    <p className="text-amber-500 text-sm mt-0.5">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</p>
                  </div>
                </div>
                <span
                  className={`text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0 ${
                    r.status === "approved" ? "bg-green-50 text-green-700" :
                    r.status === "rejected" ? "bg-red-50 text-red-700" :
                    "bg-amber-50 text-amber-700"
                  }`}
                >
                  {r.status.toUpperCase()}
                </span>
              </div>
              <p className="text-sm text-slate-700 mt-2">{r.text}</p>
              <div className="flex gap-2 mt-3">
                {r.status !== "approved" && (
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => setStatus(r.id, "approved")}
                    className="text-xs font-semibold text-white bg-green-600 hover:bg-green-700 rounded-full px-3 py-1.5 disabled:opacity-50"
                  >
                    Approve
                  </button>
                )}
                {r.status !== "rejected" && (
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => setStatus(r.id, "rejected")}
                    className="text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-full px-3 py-1.5 disabled:opacity-50"
                  >
                    Reject
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => remove(r.id)}
                  className="text-xs font-medium text-red-600 hover:underline ml-auto"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {shown.length === 0 && <p className="text-slate-400 text-sm py-8 text-center">No {filter === "all" ? "" : filter} reviews.</p>}
        </div>
      )}
    </div>
  );
}
