"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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

function fmtSize(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024) return bytes + " B";
  return (bytes / 1024).toFixed(1) + " KB";
}

function downloadTextFile(title, content) {
  const filename = title.toLowerCase().endsWith(".txt") ? title : title + ".txt";
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function FilesPage() {
  const router = useRouter();
  const { user } = useMe();
  const [files, setFiles] = useState(null);
  const [folders, setFolders] = useState(null);
  // null = All files, "unfiled" = no folder, otherwise a folder id.
  const [activeFolder, setActiveFolder] = useState(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [viewing, setViewing] = useState(null); // { id, title, content } | null

  useEffect(() => {
    if (user === null) router.push("/sign-in");
  }, [user, router]);

  async function loadFolders() {
    try {
      const d = await api("/api/folders", "GET");
      setFolders(d.folders || []);
    } catch (e) {
      setErr(e.message);
      setFolders([]);
    }
  }

  async function loadFiles(query, folderId) {
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (folderId) params.set("folderId", folderId);
      const qs = params.toString();
      const d = await api(`/api/files${qs ? "?" + qs : ""}`, "GET");
      setFiles(d.files || []);
    } catch (e) {
      setErr(e.message);
      setFiles([]);
    }
  }

  useEffect(() => {
    if (!user) return;
    loadFolders();
    loadFiles(q, activeFolder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Debounced search-as-you-type; re-fetches immediately when the folder changes.
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => loadFiles(q, activeFolder), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, activeFolder]);

  async function openFile(id) {
    try {
      const d = await api(`/api/files/${id}`, "GET");
      setViewing(d.file);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function rename(id, currentTitle) {
    const title = prompt("Rename file", currentTitle);
    if (!title || title === currentTitle) return;
    try {
      await api("/api/files", "POST", { action: "rename", id, title });
      await loadFiles(q, activeFolder);
      if (viewing?.id === id) setViewing((v) => ({ ...v, title }));
    } catch (e) {
      setErr(e.message);
    }
  }

  async function remove(id) {
    if (!confirm("Delete this file? This can't be undone.")) return;
    try {
      await api("/api/files", "POST", { action: "delete", id });
      if (viewing?.id === id) setViewing(null);
      await loadFiles(q, activeFolder);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function moveFile(id, folderId) {
    try {
      await api("/api/files", "POST", { action: "move", id, folderId: folderId || null });
      await loadFiles(q, activeFolder);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function createFolder() {
    const name = prompt("New folder name");
    if (!name || !name.trim()) return;
    try {
      await api("/api/folders", "POST", { action: "create", name: name.trim() });
      await loadFolders();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function renameFolder(id, currentName) {
    const name = prompt("Rename folder", currentName);
    if (!name || name === currentName) return;
    try {
      await api("/api/folders", "POST", { action: "rename", id, name });
      await loadFolders();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function deleteFolder(id) {
    if (!confirm("Delete this folder? Files inside won't be deleted — they'll move to \"No folder\".")) return;
    try {
      await api("/api/folders", "POST", { action: "delete", id });
      if (activeFolder === id) setActiveFolder(null);
      await loadFolders();
      await loadFiles(q, activeFolder === id ? null : activeFolder);
    } catch (e) {
      setErr(e.message);
    }
  }

  const folderName = (id) => folders?.find((f) => f.id === id)?.name;

  return (
    <div>
      <Nav />
      <div className="admin-shell">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <h1 className="dash-heading" style={{ fontSize: 20 }}>Bizzux Files</h1>
            <p className="dash-sub" style={{ marginBottom: 0 }}>
              Upload or paste your transcripts and notes, organize them into folders, and search across all of them later.
            </p>
          </div>
          <button className="btn-primary-sm" onClick={() => setShowAdd(true)}>+ Add file</button>
        </div>

        {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}

        <div className="row" style={{ gap: 20, alignItems: "flex-start" }}>
          <aside style={{ width: 200, flexShrink: 0 }}>
            <div className="card" style={{ padding: 10 }}>
              <FolderRow label="All files" active={activeFolder === null} onClick={() => setActiveFolder(null)} />
              <FolderRow label="No folder" active={activeFolder === "unfiled"} onClick={() => setActiveFolder("unfiled")} />
              {folders && folders.length > 0 && <div style={{ borderTop: "1px solid var(--line)", margin: "8px 0" }} />}
              {folders === null && <p className="muted" style={{ fontSize: 12, padding: "4px 8px" }}>Loading…</p>}
              {folders?.map((f) => (
                <FolderRow
                  key={f.id}
                  label={f.name}
                  active={activeFolder === f.id}
                  onClick={() => setActiveFolder(f.id)}
                  onRename={() => renameFolder(f.id, f.name)}
                  onDelete={() => deleteFolder(f.id)}
                />
              ))}
              <button className="link-btn" onClick={createFolder} style={{ marginTop: 8, fontSize: 13 }}>+ New folder</button>
            </div>
          </aside>

          <div style={{ flex: 1, minWidth: 0 }}>
            <input
              className="input"
              placeholder="Search file names and contents…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ marginBottom: 16, maxWidth: 420 }}
            />

            <div className="card">
              {files === null && <p className="muted">Loading…</p>}
              {files && files.length === 0 && (
                <p className="muted">{q ? `No files match "${q}".` : "No files here yet."}</p>
              )}
              {files && files.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th><th>Folder</th><th>Date</th><th>Size</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((f) => (
                        <tr key={f.id}>
                          <td>
                            <button className="link-btn" onClick={() => openFile(f.id)} style={{ textAlign: "left" }}>
                              {f.title}
                            </button>
                            {f.snippet && (
                              <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>…{f.snippet}…</p>
                            )}
                          </td>
                          <td>
                            <select
                              className="input"
                              style={{ fontSize: 12, padding: "4px 6px" }}
                              value={f.folderId || ""}
                              onChange={(e) => moveFile(f.id, e.target.value)}
                            >
                              <option value="">No folder</option>
                              {folders?.map((folder) => (
                                <option key={folder.id} value={folder.id}>{folder.name}</option>
                              ))}
                            </select>
                          </td>
                          <td>{f.createdAt ? new Date(f.createdAt).toLocaleDateString() : "—"}</td>
                          <td>{fmtSize(f.sizeBytes)}</td>
                          <td>
                            <div className="row" style={{ gap: 14 }}>
                              <button className="link-btn" onClick={() => rename(f.id, f.title)}>Rename</button>
                              <button className="link-btn danger" onClick={() => remove(f.id)}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showAdd && (
        <AddFileModal
          folders={folders}
          defaultFolderId={typeof activeFolder === "string" && activeFolder !== "unfiled" ? activeFolder : null}
          onClose={() => setShowAdd(false)}
          onAdded={async () => {
            setShowAdd(false);
            await loadFiles(q, activeFolder);
          }}
        />
      )}

      {viewing && (
        <ViewFileModal
          file={viewing}
          folderName={folderName(files?.find((f) => f.id === viewing.id)?.folderId)}
          onClose={() => setViewing(null)}
          onDownload={() => downloadTextFile(viewing.title, viewing.content)}
          onRename={() => rename(viewing.id, viewing.title)}
          onDelete={() => remove(viewing.id)}
        />
      )}
    </div>
  );
}

function FolderRow({ label, active, onClick, onRename, onDelete }) {
  return (
    <div
      className="row"
      style={{
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 8px",
        borderRadius: 6,
        background: active ? "var(--line)" : "transparent",
        cursor: "pointer",
      }}
      onClick={onClick}
    >
      <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      {(onRename || onDelete) && (
        <div className="row" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>
          {onRename && <button className="link-btn" style={{ fontSize: 11 }} onClick={onRename}>Edit</button>}
          {onDelete && <button className="link-btn danger" style={{ fontSize: 11 }} onClick={onDelete}>×</button>}
        </div>
      )}
    </div>
  );
}

function AddFileModal({ folders, defaultFolderId, onClose, onAdded }) {
  const [mode, setMode] = useState("upload"); // upload | paste
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [folderId, setFolderId] = useState(defaultFolderId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  async function handleFilePicked(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setContent(text);
    // Otter (and most exporters) always name the download something
    // generic like "notes.txt" — strip the extension so it's a clean
    // starting point the user is expected to actually rename.
    setTitle(file.name.replace(/\.txt$/i, ""));
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!title.trim()) {
      setError("Give this file a name");
      return;
    }
    if (!content.trim()) {
      setError(mode === "upload" ? "Choose a .txt file first" : "Paste some text first");
      return;
    }
    setBusy(true);
    try {
      await api("/api/files", "POST", { action: "create", title, content, folderId: folderId || null });
      onAdded();
    } catch (e2) {
      setError(e2.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h2 style={{ marginBottom: 14 }}>Add a file</h2>
        <form onSubmit={submit} noValidate>
          <div className="row" style={{ gap: 8, marginBottom: 14 }}>
            <button
              type="button"
              className={mode === "upload" ? "btn-primary-sm" : "btn-outline-dark"}
              onClick={() => setMode("upload")}
            >
              Upload .txt file
            </button>
            <button
              type="button"
              className={mode === "paste" ? "btn-primary-sm" : "btn-outline-dark"}
              onClick={() => setMode("paste")}
            >
              Paste text
            </button>
          </div>

          {mode === "upload" ? (
            <div style={{ marginBottom: 14 }}>
              <input ref={fileInputRef} type="file" accept=".txt,text/plain" onChange={handleFilePicked} />
              {content && <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>{content.length.toLocaleString()} characters loaded.</p>}
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <label className="label">Paste content</label>
              <textarea
                className="input"
                rows={8}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Paste your transcript or notes here…"
              />
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label className="label">File name *</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. CLM Project - Vendor Call - Sep 8"
              autoFocus={mode === "paste"}
              required
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label className="label">Folder</label>
            <select className="input" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">No folder</option>
              {folders?.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn-outline-dark" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}

function ViewFileModal({ file, folderName, onClose, onDownload, onRename, onDelete }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>{file.title}</h2>
          <button className="link-btn" onClick={onClose}>Close</button>
        </div>
        {folderName && <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>In folder: {folderName}</p>}
        <div
          style={{
            maxHeight: 360,
            overflowY: "auto",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: 14,
            fontSize: 13,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            marginTop: 10,
            marginBottom: 16,
          }}
        >
          {file.content}
        </div>
        <div className="row" style={{ gap: 14 }}>
          <button className="btn-primary-sm" onClick={onDownload}>Download .txt</button>
          <button className="link-btn" onClick={onRename}>Rename</button>
          <button className="link-btn danger" onClick={onDelete}>Delete</button>
        </div>
      </div>
    </div>
  );
}
