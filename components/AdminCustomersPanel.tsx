"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";

type Customer = {
  id: string;
  name: string;
  logoUrl: string;
  website?: string;
  active?: boolean;
  order?: number;
};

const BLANK = { name: "", website: "", active: true };

// CRUD for the customer-logo strip that scrolls on the home and Customers
// pages. Same "upload the image, then save its URL on the doc" flow as
// AdminTeamPanel. Order is changed with the ↑/↓ buttons; hidden logos stay
// saved but don't appear on the site.
export default function AdminCustomersPanel() {
  const [items, setItems] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<any>(BLANK);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function authHeader() {
    const token = await auth.currentUser?.getIdToken();
    return { Authorization: "Bearer " + token };
  }

  async function api(method: string, body?: any, query = "") {
    const headers: Record<string, string> = await authHeader();
    if (body) headers["Content-Type"] = "application/json";
    const r = await fetch("/api/admin/customers" + query, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Request failed");
    return d;
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const d = await api("GET");
      setItems(d.customers || []);
    } catch (e: any) {
      setError(e?.message || "Could not load customers");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function startAdd() {
    setEditingId("__new__");
    setForm(BLANK);
    setLogoFile(null);
    setLogoPreview(null);
  }

  function startEdit(c: Customer) {
    setEditingId(c.id);
    setForm({ name: c.name, website: c.website || "", active: c.active !== false });
    setLogoFile(null);
    setLogoPreview(c.logoUrl);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(BLANK);
    setLogoFile(null);
    setLogoPreview(null);
  }

  function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
  }

  async function save() {
    if (!form.name.trim()) return;
    setBusy(true);
    setError("");
    try {
      let logoUrl: string | undefined;
      if (logoFile) {
        const fd = new FormData();
        fd.append("logo", logoFile);
        const r = await fetch("/api/admin/customers/logo-upload", { method: "POST", headers: await authHeader(), body: fd });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Logo upload failed");
        logoUrl = d.url;
      }
      if (editingId === "__new__") {
        if (!logoUrl) throw new Error("Please upload the customer's logo");
        await api("POST", { ...form, logoUrl });
      } else if (editingId) {
        await api("PATCH", { id: editingId, ...form, ...(logoUrl ? { logoUrl } : {}) });
      }
      cancelEdit();
      await load();
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
    }
    setBusy(false);
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
    }
    setBusy(false);
  }

  const remove = (c: Customer) => {
    if (!window.confirm(`Remove ${c.name} from the customer logos?`)) return;
    run(() => api("DELETE", undefined, "?id=" + c.id));
  };

  const toggleActive = (c: Customer) => run(() => api("PATCH", { id: c.id, active: c.active === false }));

  // Swap with the neighbour, then renumber everything 0..n so orders stay
  // clean even if older docs had gaps or duplicates.
  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[index], next[j]] = [next[j], next[index]];
    run(() => Promise.all(next.map((c, i) => (c.order === i ? null : api("PATCH", { id: c.id, order: i })))));
  };

  const activeCount = items.filter((c) => c.active !== false).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <p className="text-sm text-slate-500">
          {activeCount} logo{activeCount === 1 ? "" : "s"} scrolling on the home and Customers pages
          {items.length > activeCount ? ` · ${items.length - activeCount} hidden` : ""}
        </p>
        {editingId === null && (
          <button
            type="button"
            onClick={startAdd}
            className="inline-flex items-center h-9 rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-sm font-semibold px-4"
            style={{ color: "#fff" }}
          >
            + Add customer
          </button>
        )}
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm p-3">{error}</div>}

      {editingId !== null && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
          <p className="font-semibold mb-3">{editingId === "__new__" ? "Add customer" : "Edit customer"}</p>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-44 h-20 rounded-lg border border-dashed border-slate-300 bg-slate-50 shrink-0 flex items-center justify-center p-3">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview} alt="" className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="text-slate-400 text-xs">No logo</span>
              )}
            </div>
            <div>
              <label className="inline-flex items-center h-9 rounded-lg border border-slate-300 text-sm font-medium px-3 cursor-pointer hover:border-brand-blue">
                {logoPreview ? "Change logo" : "Upload logo"}
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onPickLogo} />
              </label>
              <p className="text-xs text-slate-400 mt-1.5">PNG with a transparent background looks best · max 2MB</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs font-medium text-slate-500">Customer / business name</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Fresh Juice Corner"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Website (optional — logo links to it)</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                placeholder="e.g. freshjuice.in"
              />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-sm mb-4">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Show on the website
          </label>
          <p className="text-xs text-slate-400 mb-4">Only add customers who have agreed to have their name and logo shown.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || !form.name.trim() || (editingId === "__new__" && !logoFile)}
              className="inline-flex items-center h-9 rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-sm font-semibold px-4 disabled:opacity-50"
              style={{ color: "#fff" }}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={cancelEdit} className="inline-flex items-center h-9 rounded-full bg-slate-100 text-sm font-medium px-4">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-slate-400 text-sm py-8 text-center">Loading…</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((c, i) => (
            <div key={c.id} className={`rounded-xl border border-slate-200 bg-white p-4 flex gap-3 ${c.active === false ? "opacity-60" : ""}`}>
              <div className="w-24 h-14 rounded-lg bg-slate-50 border border-slate-100 shrink-0 flex items-center justify-center p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.logoUrl} alt={c.name} className="max-w-full max-h-full object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">
                  {c.name}
                  {c.active === false && <span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5 ml-1">Hidden</span>}
                </p>
                <p className="text-xs text-slate-500 truncate">{c.website || "No website"}</p>
                <div className="flex gap-3 mt-2 items-center">
                  <button type="button" onClick={() => startEdit(c)} className="text-xs font-medium text-brand-blue hover:underline">Edit</button>
                  <button type="button" onClick={() => toggleActive(c)} disabled={busy} className="text-xs font-medium text-slate-600 hover:underline">
                    {c.active === false ? "Show" : "Hide"}
                  </button>
                  <button type="button" onClick={() => remove(c)} disabled={busy} className="text-xs font-medium text-red-600 hover:underline">Remove</button>
                  <span className="flex-1" />
                  <button type="button" title="Move earlier" onClick={() => move(i, -1)} disabled={busy || i === 0} className="text-xs text-slate-500 disabled:opacity-30">↑</button>
                  <button type="button" title="Move later" onClick={() => move(i, 1)} disabled={busy || i === items.length - 1} className="text-xs text-slate-500 disabled:opacity-30">↓</button>
                </div>
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-slate-400 text-sm py-8 text-center col-span-full">No customers yet — add one above.</p>
          )}
        </div>
      )}
    </div>
  );
}
