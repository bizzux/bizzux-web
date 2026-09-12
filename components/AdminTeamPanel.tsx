"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";

type Member = {
  id: string;
  name: string;
  role?: string;
  bio?: string;
  photoUrl?: string | null;
  isCEO?: boolean;
  order?: number;
};

const BLANK = { name: "", role: "", bio: "", isCEO: false };

// CRUD for the About page's Team section. Photos upload straight to a
// public Vercel Blob path via /api/admin/team/photo-upload, then the
// resulting URL is stored on the team doc — same two-step pattern as any
// other "upload then save the URL" flow, just with a fresh blob path per
// upload rather than reusing one.
export default function AdminTeamPanel() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<any>(BLANK);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function authHeader() {
    const token = await auth.currentUser?.getIdToken();
    return { Authorization: "Bearer " + token };
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/admin/team", { headers: await authHeader() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load team");
      setMembers(d.members || []);
    } catch (e: any) {
      setError(e?.message || "Could not load team");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function startAdd() {
    setEditingId("__new__");
    setForm(BLANK);
    setPhotoFile(null);
    setPhotoPreview(null);
  }

  function startEdit(m: Member) {
    setEditingId(m.id);
    setForm({ name: m.name, role: m.role || "", bio: m.bio || "", isCEO: m.isCEO === true });
    setPhotoFile(null);
    setPhotoPreview(m.photoUrl || null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(BLANK);
    setPhotoFile(null);
    setPhotoPreview(null);
  }

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoFile(f);
    setPhotoPreview(URL.createObjectURL(f));
  }

  async function save() {
    if (!form.name.trim()) return;
    setBusy(true);
    setError("");
    try {
      let photoUrl: string | null | undefined = undefined;
      if (photoFile) {
        const fd = new FormData();
        fd.append("photo", photoFile);
        const r = await fetch("/api/admin/team/photo-upload", {
          method: "POST",
          headers: await authHeader(),
          body: fd,
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Photo upload failed");
        photoUrl = d.url;
      }

      const headers = { ...(await authHeader()), "Content-Type": "application/json" };
      if (editingId === "__new__") {
        const r = await fetch("/api/admin/team", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...form, ...(photoUrl ? { photoUrl } : {}) }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not add team member");
      } else if (editingId) {
        const r = await fetch("/api/admin/team", {
          method: "PATCH",
          headers,
          body: JSON.stringify({ id: editingId, ...form, ...(photoUrl ? { photoUrl } : {}) }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not save changes");
      }
      cancelEdit();
      await load();
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
    }
    setBusy(false);
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this team member from the About page?")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/team?id=" + id, { method: "DELETE", headers: await authHeader() });
      if (!r.ok) throw new Error((await r.json()).error || "Could not remove");
      await load();
    } catch (e: any) {
      setError(e?.message || "Could not remove");
    }
    setBusy(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">{members.length} team member{members.length === 1 ? "" : "s"} on the About page</p>
        {editingId === null && (
          <button
            type="button"
            onClick={startAdd}
            className="inline-flex items-center h-9 rounded-full bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-sm font-semibold px-4"
            style={{ color: "#fff" }}
          >
            + Add team member
          </button>
        )}
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm p-3">{error}</div>}

      {editingId !== null && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
          <p className="font-semibold mb-3">{editingId === "__new__" ? "Add team member" : "Edit team member"}</p>
          <div className="flex gap-4 mb-3">
            <div className="w-20 h-20 rounded-full overflow-hidden bg-slate-100 shrink-0 flex items-center justify-center">
              {photoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoPreview} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-slate-400 text-xs">No photo</span>
              )}
            </div>
            <div>
              <label className="inline-flex items-center h-9 rounded-lg border border-slate-300 text-sm font-medium px-3 cursor-pointer hover:border-brand-blue">
                {photoFile ? "Change photo" : "Upload photo"}
                <input type="file" accept="image/*" hidden onChange={onPickPhoto} />
              </label>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs font-medium text-slate-500">Name</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Priya Sharma"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Role / title</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                placeholder="e.g. Founder & CEO"
              />
            </div>
          </div>
          <label className="text-xs font-medium text-slate-500">Short bio (optional)</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-3"
            rows={2}
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
            placeholder="One or two lines about them"
          />
          <label className="inline-flex items-center gap-2 text-sm mb-4">
            <input type="checkbox" checked={form.isCEO} onChange={(e) => setForm({ ...form, isCEO: e.target.checked })} />
            Show as CEO / leadership (featured first, larger card)
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || !form.name.trim()}
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
          {members.map((m) => (
            <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-4 flex gap-3">
              <div className="w-14 h-14 rounded-full overflow-hidden bg-slate-100 shrink-0 flex items-center justify-center">
                {m.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.photoUrl} alt={m.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-slate-400 text-xs">No photo</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">
                  {m.name} {m.isCEO && <span className="text-[10px] font-bold text-brand-blue bg-blue-50 rounded-full px-2 py-0.5 ml-1">CEO</span>}
                </p>
                <p className="text-xs text-slate-500 truncate">{m.role}</p>
                <div className="flex gap-3 mt-2">
                  <button type="button" onClick={() => startEdit(m)} className="text-xs font-medium text-brand-blue hover:underline">Edit</button>
                  <button type="button" onClick={() => remove(m.id)} className="text-xs font-medium text-red-600 hover:underline">Remove</button>
                </div>
              </div>
            </div>
          ))}
          {members.length === 0 && (
            <p className="text-slate-400 text-sm py-8 text-center col-span-full">No team members yet — add one above.</p>
          )}
        </div>
      )}
    </div>
  );
}
