"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";

type BlockType =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "quote"; text: string };

type Post = {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  readTime: string;
  tags: string[];
  body: BlockType[];
  status: "draft" | "published";
  coverImage?: string | null;
};

const FILTERS: { id: Post["status"] | "all"; label: string }[] = [
  { id: "published", label: "Published" },
  { id: "draft", label: "Drafts" },
  { id: "all", label: "All" },
];

const EMPTY_FORM = { title: "", excerpt: "", tags: "", date: "", bodyText: "", coverImage: "" };

function blocksToText(blocks: BlockType[]): string {
  return blocks
    .map((b) => {
      if (b.type === "h2") return `## ${b.text}`;
      if (b.type === "quote") return `> ${b.text}`;
      if (b.type === "ul") return b.items.map((i) => `- ${i}`).join("\n");
      return b.text;
    })
    .join("\n\n");
}

async function authHeader() {
  const token = await auth.currentUser?.getIdToken();
  return { Authorization: "Bearer " + token };
}

export default function AdminBlogPanel() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Post["status"] | "all">("published");
  const [busySlug, setBusySlug] = useState<string | null>(null);

  const [editingSlug, setEditingSlug] = useState<string | null>(null); // null = not editing, "new" = creating
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [aiTopic, setAiTopic] = useState("");
  const [generating, setGenerating] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/admin/blog", { headers: await authHeader() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load posts");
      setPosts(d.posts || []);
    } catch (e: any) {
      setError(e?.message || "Could not load posts");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function startNew() {
    setForm({ ...EMPTY_FORM, date: new Date().toISOString().slice(0, 10) });
    setEditingSlug("new");
    setFormError("");
  }

  function startEdit(p: Post) {
    setForm({
      title: p.title,
      excerpt: p.excerpt,
      tags: p.tags.join(", "),
      date: p.date,
      bodyText: blocksToText(p.body),
      coverImage: p.coverImage || "",
    });
    setEditingSlug(p.slug);
    setFormError("");
  }

  function cancelEdit() {
    setEditingSlug(null);
    setForm(EMPTY_FORM);
    setAiTopic("");
    setFormError("");
  }

  async function uploadCoverImage(file: File) {
    setUploadingImage(true);
    setFormError("");
    try {
      const fd = new FormData();
      fd.append("image", file);
      const r = await fetch("/api/admin/blog/image-upload", {
        method: "POST",
        headers: await authHeader(),
        body: fd,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Upload failed");
      setForm((f) => ({ ...f, coverImage: d.url }));
    } catch (e: any) {
      setFormError(e?.message || "Upload failed");
    }
    setUploadingImage(false);
  }

  async function generateWithAI() {
    if (!aiTopic.trim()) return;
    setGenerating(true);
    setFormError("");
    try {
      const r = await fetch("/api/admin/blog/generate", {
        method: "POST",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ topic: aiTopic }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Generation failed");
      setForm((f) => ({
        ...f,
        title: d.draft.title || f.title,
        excerpt: d.draft.excerpt || f.excerpt,
        tags: Array.isArray(d.draft.tags) ? d.draft.tags.join(", ") : f.tags,
        bodyText: d.draft.bodyText || f.bodyText,
      }));
    } catch (e: any) {
      setFormError(e?.message || "Generation failed");
    }
    setGenerating(false);
  }

  async function save(status: "draft" | "published") {
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        title: form.title,
        excerpt: form.excerpt,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        date: form.date,
        bodyText: form.bodyText,
        coverImage: form.coverImage,
        status,
      };
      const isNew = editingSlug === "new";
      const r = await fetch(isNew ? "/api/admin/blog" : `/api/admin/blog/${editingSlug}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not save");
      cancelEdit();
      await load();
    } catch (e: any) {
      setFormError(e?.message || "Could not save");
    }
    setSaving(false);
  }

  async function setStatus(slug: string, status: Post["status"]) {
    setBusySlug(slug);
    try {
      const r = await fetch(`/api/admin/blog/${slug}`, {
        method: "PATCH",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Could not update");
      setPosts((ps) => ps.map((p) => (p.slug === slug ? { ...p, status } : p)));
    } catch (e: any) {
      setError(e?.message || "Could not update");
    }
    setBusySlug(null);
  }

  async function remove(slug: string) {
    if (!window.confirm("Delete this post permanently?")) return;
    setBusySlug(slug);
    try {
      const r = await fetch(`/api/admin/blog/${slug}`, { method: "DELETE", headers: await authHeader() });
      if (!r.ok) throw new Error((await r.json()).error || "Could not delete");
      setPosts((ps) => ps.filter((p) => p.slug !== slug));
    } catch (e: any) {
      setError(e?.message || "Could not delete");
    }
    setBusySlug(null);
  }

  const shown = filter === "all" ? posts : posts.filter((p) => p.status === filter);
  const draftCount = posts.filter((p) => p.status === "draft").length;

  if (editingSlug) {
    return (
      <div className="max-w-2xl">
        <button onClick={cancelEdit} className="text-sm text-brand-blue font-semibold hover:underline mb-4">
          ← Back to posts
        </button>
        <h2 className="text-lg font-bold mb-4">{editingSlug === "new" ? "New post" : "Edit post"}</h2>

        {formError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm p-3">{formError}</div>}

        <div className="rounded-lg border border-brand-blue/20 bg-brand-blue/5 p-4 mb-4">
          <p className="text-sm font-semibold mb-1">✨ Generate a draft with AI</p>
          <p className="text-xs text-slate-500 mb-3">
            Give it a topic (trending AI news, a cybersecurity angle, a small-business problem) — it fills in the
            title, excerpt, tags, and body below as a starting draft. Nothing publishes automatically; review and
            edit before saving.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={'e.g. "the latest AI agent news and what it means for small business owners"'}
              value={aiTopic}
              onChange={(e) => setAiTopic(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); generateWithAI(); } }}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              onClick={generateWithAI}
              disabled={generating || !aiTopic.trim()}
              className="text-sm font-semibold text-white bg-gradient-to-r from-brand-tealDark to-brand-blueDark rounded-full px-4 py-2 disabled:opacity-50 whitespace-nowrap"
            >
              {generating ? "Writing…" : "Generate"}
            </button>
          </div>
        </div>

        <div className="mb-4">
          <p className="text-sm font-semibold mb-2">Cover image</p>
          {form.coverImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.coverImage} alt="Cover preview" className="w-full max-w-sm rounded-lg border border-slate-200 mb-2" />
          )}
          <div className="flex items-center gap-3">
            <label className="text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-full px-4 py-2 cursor-pointer">
              {uploadingImage ? "Uploading…" : form.coverImage ? "Replace image" : "Upload image"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploadingImage}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCoverImage(f); e.target.value = ""; }}
              />
            </label>
            {form.coverImage && (
              <button
                onClick={() => setForm((f) => ({ ...f, coverImage: "" }))}
                className="text-xs font-medium text-red-600 hover:underline"
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Generate an image elsewhere (ChatGPT, Gemini, etc.) and upload it here — shows at the top of the post and as the social-share image.
          </p>
        </div>

        <div className="space-y-3">
          <input
            type="text"
            placeholder="Title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
          />
          <textarea
            placeholder="Excerpt — one or two sentences shown on the listing page"
            value={form.excerpt}
            onChange={(e) => setForm((f) => ({ ...f, excerpt: e.target.value }))}
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Tags, comma separated"
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <textarea
              placeholder={"Write the post here.\n\nBlank line = new paragraph.\n## Subheading\n- bullet item\n- another bullet\n> a pull quote"}
              value={form.bodyText}
              onChange={(e) => setForm((f) => ({ ...f, bodyText: e.target.value }))}
              rows={16}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
            />
            <p className="text-xs text-slate-400 mt-1">
              Blank line = new paragraph · <code>## </code> = subheading · <code>- </code> = bullet · <code>&gt; </code> = pull quote
            </p>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={() => save("draft")}
            disabled={saving || !form.title.trim()}
            className="text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-full px-4 py-2 disabled:opacity-50"
          >
            Save as draft
          </button>
          <button
            onClick={() => save("published")}
            disabled={saving || !form.title.trim()}
            className="text-sm font-semibold text-white bg-gradient-to-r from-brand-tealDark to-brand-blueDark rounded-full px-4 py-2 disabled:opacity-50"
          >
            {saving ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg w-fit">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                filter === f.id ? "bg-gradient-to-r from-brand-tealDark to-brand-blueDark text-white shadow-sm" : "text-slate-800"
              }`}
            >
              {f.label}{f.id === "draft" && draftCount > 0 ? ` (${draftCount})` : ""}
            </button>
          ))}
        </div>
        <button
          onClick={startNew}
          className="text-sm font-semibold text-white bg-gradient-to-r from-brand-tealDark to-brand-blueDark rounded-full px-4 py-2"
        >
          + New post
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm p-3">{error}</div>}

      {loading ? (
        <p className="text-slate-400 text-sm py-8 text-center">Loading…</p>
      ) : (
        <div className="space-y-3">
          {shown.map((p) => (
            <div key={p.slug} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{p.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{p.date} · {p.readTime}{p.tags.length > 0 ? ` · ${p.tags.join(", ")}` : ""}</p>
                </div>
                <span
                  className={`text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0 ${
                    p.status === "published" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {p.status.toUpperCase()}
                </span>
              </div>
              <p className="text-sm text-slate-600 mt-2 line-clamp-2">{p.excerpt}</p>
              <div className="flex gap-2 mt-3 items-center">
                <button
                  onClick={() => startEdit(p)}
                  className="text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-full px-3 py-1.5"
                >
                  Edit
                </button>
                {p.status === "published" ? (
                  <>
                    <a
                      href={`/resources/${p.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-brand-blue hover:underline px-1"
                    >
                      View live
                    </a>
                    <button
                      disabled={busySlug === p.slug}
                      onClick={() => setStatus(p.slug, "draft")}
                      className="text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-full px-3 py-1.5 disabled:opacity-50"
                    >
                      Unpublish
                    </button>
                  </>
                ) : (
                  <button
                    disabled={busySlug === p.slug}
                    onClick={() => setStatus(p.slug, "published")}
                    className="text-xs font-semibold text-white bg-green-600 hover:bg-green-700 rounded-full px-3 py-1.5 disabled:opacity-50"
                  >
                    Publish
                  </button>
                )}
                <button
                  disabled={busySlug === p.slug}
                  onClick={() => remove(p.slug)}
                  className="text-xs font-medium text-red-600 hover:underline ml-auto"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {shown.length === 0 && <p className="text-slate-400 text-sm py-8 text-center">No {filter === "all" ? "" : filter} posts.</p>}
        </div>
      )}
    </div>
  );
}
