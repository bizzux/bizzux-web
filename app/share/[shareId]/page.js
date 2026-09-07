"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";

// PUBLIC page — no Bizzux account, no Nav, no Firebase auth. This is the
// one surface in the app meant for someone who has never signed up, so it
// deliberately doesn't import anything from the authenticated (saas) tree.

const EXT_MIME = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function extOf(filename) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(filename || "");
  return m ? m[1].toLowerCase() : "";
}
function fmtSize(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

async function guestApi(shareId, path, method, body, token) {
  const res = await fetch(`/api/share/${shareId}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function SharePage() {
  const { shareId } = useParams();
  const [password, setPassword] = useState("");
  const [session, setSession] = useState(null); // { token, mode, targetType, targetName } | null
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState("");
  const [content, setContent] = useState(null); // { files } for folder, or { file } for single file
  const [showAdd, setShowAdd] = useState(false);
  const [viewingFile, setViewingFile] = useState(null);

  // Restores a session within the same tab across a refresh — never across
  // devices/browsers, and the server still re-checks liveness on every call
  // regardless of what's cached here.
  useEffect(() => {
    const saved = sessionStorage.getItem("bizzux-share-" + shareId);
    if (saved) {
      try {
        setSession(JSON.parse(saved));
      } catch {
        // ignore corrupt cache entry
      }
    }
  }, [shareId]);

  useEffect(() => {
    if (session) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function load() {
    try {
      const d = await guestApi(shareId, "", "GET", undefined, session.token);
      setContent(d);
      setErr("");
    } catch (e) {
      setErr(e.message);
      if (e.message.includes("expired") || e.message.includes("revoked")) {
        sessionStorage.removeItem("bizzux-share-" + shareId);
        setSession(null);
      }
    }
  }

  async function submitPassword(e) {
    e.preventDefault();
    setErr("");
    setChecking(true);
    try {
      const d = await guestApi(shareId, "/verify", "POST", { password });
      const s = { token: d.guestToken, mode: d.mode, targetType: d.targetType, targetName: d.targetName };
      sessionStorage.setItem("bizzux-share-" + shareId, JSON.stringify(s));
      setSession(s);
    } catch (e2) {
      setErr(e2.message);
    }
    setChecking(false);
  }

  async function deleteFile(id) {
    if (!confirm("Delete this file? This can't be undone.")) return;
    try {
      await guestApi(shareId, "/files", "POST", { action: "delete", id }, session.token);
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  function downloadUrl(fileId) {
    return `/api/share/${shareId}/download${fileId ? "?fileId=" + fileId : ""}`;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "40px 20px" }}>
        <div className="row" style={{ justifyContent: "center", marginBottom: 24 }}>
          <Image src="/logo-transparent.png" alt="Bizzux" width={132} height={54} style={{ height: 40, width: "auto" }} />
        </div>

        {!session ? (
          <div className="card">
            <h1 style={{ fontSize: 18, marginBottom: 6 }}>This is a shared Bizzux file</h1>
            <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
              Enter the password you were given to access it.
            </p>
            <form onSubmit={submitPassword} noValidate>
              <input
                className="input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                style={{ marginBottom: 14 }}
              />
              <button className="btn-primary" style={{ width: "100%" }} disabled={checking}>
                {checking ? "Checking…" : "Continue"}
              </button>
              {err && <p className="error" style={{ marginTop: 12 }}>{err}</p>}
            </form>
          </div>
        ) : (
          <div>
            <h1 style={{ fontSize: 18, marginBottom: 4 }}>{session.targetName}</h1>
            <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
              {session.targetType === "folder"
                ? session.mode === "upload"
                  ? "You can view, download, and upload files here."
                  : "You can view and download files here."
                : "Shared file"}
            </p>

            {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}

            {content?.targetType === "file" && content.file && (
              <div className="card">
                <h2 style={{ fontSize: 15, marginBottom: 10 }}>{content.file.title}</h2>
                {content.file.content ? (
                  <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 14, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 14 }}>
                    {content.file.content}
                  </div>
                ) : (
                  <p className="muted" style={{ marginBottom: 14 }}>{fmtSize(content.file.sizeBytes)} · .{content.file.ext}</p>
                )}
                {content.file.content ? (
                  <a
                    className="btn-primary-sm"
                    href={`data:text/plain;charset=utf-8,${encodeURIComponent(content.file.content)}`}
                    download={content.file.title + ".txt"}
                  >
                    Download
                  </a>
                ) : (
                  <a className="btn-primary-sm" href={downloadUrl()}>Download</a>
                )}
              </div>
            )}

            {content?.targetType === "folder" && (
              <>
                {session.mode === "upload" && (
                  <button className="btn-primary-sm" onClick={() => setShowAdd(true)} style={{ marginBottom: 14 }}>+ Add file</button>
                )}
                <div className="card">
                  {content.files.length === 0 && <p className="muted">No files here yet.</p>}
                  {content.files.length > 0 && (
                    <table className="table">
                      <thead>
                        <tr><th>Name</th><th>Type</th><th>Date</th><th>Size</th><th></th></tr>
                      </thead>
                      <tbody>
                        {content.files.map((f) => (
                          <tr key={f.id}>
                            <td>
                              <button className="link-btn" onClick={() => setViewingFile(f)} style={{ textAlign: "left" }}>{f.title}</button>
                            </td>
                            <td style={{ textTransform: "uppercase", fontSize: 12 }}>{f.ext}</td>
                            <td>{f.createdAt ? new Date(f.createdAt).toLocaleDateString() : "—"}</td>
                            <td>{fmtSize(f.sizeBytes)}</td>
                            <td>
                              <div className="row" style={{ gap: 12 }}>
                                <a className="link-btn" href={downloadUrl(f.id)}>Download</a>
                                {f.canDelete && <button className="link-btn danger" onClick={() => deleteFile(f.id)}>Delete</button>}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {showAdd && (
        <GuestAddFileModal
          shareId={shareId}
          token={session?.token}
          onClose={() => setShowAdd(false)}
          onAdded={async () => {
            setShowAdd(false);
            await load();
          }}
        />
      )}

      {viewingFile && (
        <div className="modal-overlay" onClick={() => setViewingFile(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>{viewingFile.title}</h2>
              <button className="link-btn" onClick={() => setViewingFile(null)}>Close</button>
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>{fmtSize(viewingFile.sizeBytes)} · .{viewingFile.ext}</p>
            <a className="btn-primary-sm" href={downloadUrl(viewingFile.id)}>Download</a>
          </div>
        </div>
      )}
    </div>
  );
}

function GuestAddFileModal({ shareId, token, onClose, onAdded }) {
  const [mode, setMode] = useState("upload");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pickedFile, setPickedFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleFilePicked(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPickedFile(file);
    setTitle(file.name.replace(/\.[a-zA-Z0-9]+$/, ""));
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!title.trim()) {
      setError("Give this file a name");
      return;
    }
    setBusy(true);
    try {
      if (mode === "paste") {
        if (!content.trim()) throw new Error("Paste some text first");
        await guestApi(shareId, "/files", "POST", { action: "create", title, content }, token);
      } else {
        if (!pickedFile) throw new Error("Choose a file first");
        const ext = extOf(pickedFile.name);
        if (ext === "txt" || pickedFile.type === "text/plain") {
          const text = await pickedFile.text();
          await guestApi(shareId, "/files", "POST", { action: "create", title, content: text }, token);
        } else {
          const { upload } = await import("@vercel/blob/client");
          const contentType = EXT_MIME[ext] || pickedFile.type || "application/octet-stream";
          const result = await upload(`${Date.now()}-${pickedFile.name}`, pickedFile, {
            access: "private",
            contentType,
            handleUploadUrl: `/api/share/${shareId}/blob-upload`,
            headers: { Authorization: "Bearer " + token },
          });
          await guestApi(shareId, "/files", "POST", {
            action: "create", title, blobPath: result.pathname, contentType, ext: ext || "bin", sizeBytes: pickedFile.size,
          }, token);
        }
      }
      onAdded();
    } catch (e2) {
      setError(e2.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h2 style={{ marginBottom: 14 }}>Add a file</h2>
        <form onSubmit={submit} noValidate>
          <div className="row" style={{ gap: 8, marginBottom: 14 }}>
            <button type="button" className={mode === "upload" ? "btn-primary-sm" : "btn-outline-dark"} onClick={() => setMode("upload")}>Upload a file</button>
            <button type="button" className={mode === "paste" ? "btn-primary-sm" : "btn-outline-dark"} onClick={() => setMode("paste")}>Paste text</button>
          </div>
          {mode === "upload" ? (
            <input type="file" onChange={handleFilePicked} style={{ marginBottom: 14 }} />
          ) : (
            <textarea className="input" rows={6} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste text here…" style={{ marginBottom: 14 }} />
          )}
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="File name" style={{ marginBottom: 16 }} />
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
