"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { upload } from "@vercel/blob/client";
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

const EXT_MIME = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};
const ACCEPTED_EXT = [".txt", ...Object.keys(EXT_MIME).map((e) => "." + e)];
const FOLDER_ICON = "📁"; // 📁
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);
function isImageExt(ext) {
  return IMAGE_EXTS.has((ext || "").toLowerCase());
}
const FILE_ICONS = {
  pdf: "📕", doc: "📘", docx: "📘", xls: "📗", xlsx: "📗",
  ppt: "📙", pptx: "📙", txt: "📄",
};
function iconFor(ext) {
  return FILE_ICONS[(ext || "").toLowerCase()] || "📄";
}

// The download route (and the notes-audio route it's modeled on) require a
// Bearer token, so a plain <img>/<iframe> `src` or a bare `window.open()`
// can't authenticate — this fetches with the token and hands back a local
// blob: URL, same pattern app/(saas)/notes/[id]/page.js uses for audio.
async function fetchBlobUrl(id) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(`/api/files/${id}/download`, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) throw new Error("Could not load the file");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function triggerBlobDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Turns a date-filter selection into ISO from/to bounds for the API.
// "today"/"week"/"month" are rolling windows ending right now (last 24h,
// last 7 days, last 30 days) rather than calendar boundaries — simpler and
// avoids timezone edge cases around "start of week/month".
function dateBoundsFor(range) {
  if (!range || range.preset === "all") return {};
  if (range.preset === "custom") {
    return {
      from: range.from ? new Date(range.from + "T00:00:00").toISOString() : undefined,
      to: range.to ? new Date(range.to + "T23:59:59.999").toISOString() : undefined,
    };
  }
  const days = { today: 1, week: 7, month: 30 }[range.preset];
  if (!days) return {};
  return { from: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() };
}

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

// Uploads one already-picked File: .txt is read as text and stored inline
// (stays full-text searchable); anything else goes to Vercel Blob directly
// from the browser (see app/api/files/blob-upload), matching the pattern
// app/(saas)/notes/new/page.js uses for meeting recordings.
async function saveFile({ title, folderId, file, pastedContent, accountId }) {
  if (pastedContent !== undefined) {
    return api("/api/files", "POST", { action: "create", title, folderId, content: pastedContent });
  }
  const ext = extOf(file.name);
  if (ext === "txt" || file.type === "text/plain") {
    const content = await file.text();
    return api("/api/files", "POST", { action: "create", title, folderId, content });
  }
  const contentType = EXT_MIME[ext] || file.type || "application/octet-stream";
  // upload() posts to handleUploadUrl itself (outside the shared api()
  // helper above), so it needs its own Authorization header — without it
  // /api/files/blob-upload 401s and the SDK surfaces that as the generic
  // "Failed to retrieve the client token".
  const idToken = await auth.currentUser.getIdToken();
  const result = await upload(`files/${accountId}/${Date.now()}-${file.name}`, file, {
    access: "private",
    contentType,
    handleUploadUrl: "/api/files/blob-upload",
    headers: { Authorization: "Bearer " + idToken },
  });
  return api("/api/files", "POST", {
    action: "create",
    title,
    folderId,
    blobPath: result.pathname,
    contentType,
    ext: ext || "bin",
    sizeBytes: file.size,
  });
}

export default function FilesPage() {
  const router = useRouter();
  const { user, me } = useMe();
  const [view, setView] = useState("files"); // "files" | "trash"
  const [files, setFiles] = useState(null);
  const [folders, setFolders] = useState(null);
  const [totalSizeBytes, setTotalSizeBytes] = useState(0);
  const [expanded, setExpanded] = useState(() => new Set());
  // null = All files, "unfiled" = no folder, otherwise a folder id.
  const [activeFolder, setActiveFolder] = useState(null);
  const [q, setQ] = useState("");
  const [dateRange, setDateRange] = useState({ preset: "all", from: "", to: "" });
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [selectedFolders, setSelectedFolders] = useState(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(null); // { label, onConfirm } | null
  const [promptModal, setPromptModal] = useState(null); // { title, defaultValue, onSubmit } | null
  const [confirmModal, setConfirmModal] = useState(null); // { title, message, onConfirm } | null
  const [trash, setTrash] = useState(null);
  const [shares, setShares] = useState(null);
  const [shareModal, setShareModal] = useState(null); // { targetType, targetId, targetName } | null
  const [shareResult, setShareResult] = useState(null); // { url } | null, shown after creating a link
  const [sort, setSort] = useState({ field: "createdAt", dir: "desc" });
  const [density, setDensity] = useState("list"); // "list" | "compact" | "tiles"
  const [moveModal, setMoveModal] = useState(null); // { id } | null
  const [detailsFile, setDetailsFile] = useState(null);
  const [gallery, setGallery] = useState(null); // all image files, loaded lazily when Photos is opened
  const folderUploadRef = useRef(null);

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

  async function loadFiles(query, folderId, range) {
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (folderId) params.set("folderId", folderId);
      const { from, to } = dateBoundsFor(range);
      if (from) params.set("dateFrom", from);
      if (to) params.set("dateTo", to);
      const qs = params.toString();
      const d = await api(`/api/files${qs ? "?" + qs : ""}`, "GET");
      setFiles(d.files || []);
      setTotalSizeBytes(d.totalSizeBytes || 0);
    } catch (e) {
      setErr(e.message);
      setFiles([]);
    }
  }

  async function loadTrash() {
    try {
      const d = await api("/api/trash", "GET");
      setTrash(d.items || []);
    } catch (e) {
      setErr(e.message);
      setTrash([]);
    }
  }

  useEffect(() => {
    if (!user) return;
    loadFolders();
    loadFiles(q, activeFolder, dateRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => loadFiles(q, activeFolder, dateRange), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, activeFolder, dateRange]);

  useEffect(() => {
    setSelected(new Set());
  }, [files, activeFolder, q]);

  function switchToTrash() {
    setView("trash");
    loadTrash();
  }

  async function loadShares() {
    try {
      const d = await api("/api/shares", "GET");
      setShares(d.shares || []);
    } catch (e) {
      setErr(e.message);
      setShares([]);
    }
  }

  async function createShare({ targetType, targetId, mode, password, expiresInMinutes }) {
    const { id } = await api("/api/shares", "POST", { action: "create", targetType, targetId, mode, password, expiresInMinutes });
    setShareModal(null);
    setShareResult({ url: `${window.location.origin}/share/${id}` });
  }

  async function revokeShare(id) {
    await api("/api/shares", "POST", { action: "revoke", id });
    await loadShares();
  }

  async function openFile(id) {
    try {
      const d = await api(`/api/files/${id}`, "GET");
      setViewing(d.file);
    } catch (e) {
      setErr(e.message);
    }
  }

  function rename(id, currentTitle) {
    setPromptModal({
      title: "Rename file",
      defaultValue: currentTitle,
      onSubmit: async (title) => {
        if (!title || title === currentTitle) {
          setPromptModal(null);
          return;
        }
        try {
          await api("/api/files", "POST", { action: "rename", id, title });
          setPromptModal(null);
          await loadFiles(q, activeFolder, dateRange);
          if (viewing?.id === id) setViewing((v) => ({ ...v, title }));
        } catch (e) {
          setErr(e.message);
          setPromptModal(null);
        }
      },
    });
  }

  function removeOne(id) {
    setConfirmModal({
      title: "Move to recycle bin?",
      message: "This file will move to the recycle bin. You can restore it from there anytime in the next 30 days.",
      onConfirm: async () => {
        try {
          await api("/api/files", "POST", { action: "delete", id });
          if (viewing?.id === id) setViewing(null);
          setConfirmModal(null);
          await loadFiles(q, activeFolder, dateRange);
        } catch (e) {
          setErr(e.message);
          setConfirmModal(null);
        }
      },
    });
  }

  async function moveFile(id, folderId) {
    try {
      await api("/api/files", "POST", { action: "move", id, folderId: folderId || null });
      await loadFiles(q, activeFolder, dateRange);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function duplicateFile(id) {
    try {
      await api("/api/files", "POST", { action: "duplicate", id });
      await loadFiles(q, activeFolder, dateRange);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function downloadFile(row) {
    try {
      if (row.hasBlob) {
        const url = await fetchBlobUrl(row.id);
        const filename = row.title + (row.ext ? "." + row.ext : "");
        triggerBlobDownload(url, filename);
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        return;
      }
      if (row.content !== undefined && row.content !== null) {
        downloadTextFile(row.title, row.content);
        return;
      }
      const { file } = await api(`/api/files/${row.id}`, "GET");
      downloadTextFile(file.title, file.content || "");
    } catch (e) {
      setErr(e.message);
    }
  }

  function fileMenuItems(f) {
    return [
      { label: "Open", onClick: () => openFile(f.id) },
      { label: "Download", onClick: () => downloadFile(f) },
      { label: "Share", onClick: () => setShareModal({ targetType: "file", targetId: f.id, targetName: f.title }) },
      { divider: true },
      { label: "Rename", onClick: () => rename(f.id, f.title) },
      { label: "Move to…", onClick: () => setMoveModal({ id: f.id, folderId: f.folderId }) },
      { label: "Duplicate", onClick: () => duplicateFile(f.id) },
      { label: "Details", onClick: () => setDetailsFile(f) },
      { divider: true },
      { label: "Delete", danger: true, onClick: () => removeOne(f.id) },
    ];
  }

  async function loadGallery() {
    try {
      const d = await api("/api/files", "GET");
      setGallery((d.files || []).filter((f) => isImageExt(f.ext) && f.hasBlob));
    } catch (e) {
      setErr(e.message);
      setGallery([]);
    }
  }

  function toggleSelect(id) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected((s) => (s.size === files.length ? new Set() : new Set(files.map((f) => f.id))));
  }

  function bulkDeleteFiles() {
    const ids = [...selected];
    setConfirmBulk({
      label: `${ids.length} file${ids.length === 1 ? "" : "s"}`,
      onConfirm: async () => {
        await api("/api/files", "POST", { action: "deleteMany", ids });
        setSelected(new Set());
        setConfirmBulk(null);
        await loadFiles(q, activeFolder, dateRange);
      },
    });
  }

  async function bulkMoveFiles(folderId) {
    const ids = [...selected];
    try {
      await api("/api/files", "POST", { action: "moveMany", ids, folderId: folderId || null });
      setSelected(new Set());
      await loadFiles(q, activeFolder, dateRange);
    } catch (e) {
      setErr(e.message);
    }
  }

  function createFolder(parentId) {
    setPromptModal({
      title: "New folder",
      defaultValue: "",
      onSubmit: async (name) => {
        if (!name || !name.trim()) {
          setPromptModal(null);
          return;
        }
        try {
          await api("/api/folders", "POST", { action: "create", name: name.trim(), parentId: parentId || null });
          setPromptModal(null);
          await loadFolders();
        } catch (e) {
          setErr(e.message);
          setPromptModal(null);
        }
      },
    });
  }

  function renameFolder(id, currentName) {
    setPromptModal({
      title: "Rename folder",
      defaultValue: currentName,
      onSubmit: async (name) => {
        if (!name || name === currentName) {
          setPromptModal(null);
          return;
        }
        try {
          await api("/api/folders", "POST", { action: "rename", id, name });
          setPromptModal(null);
          await loadFolders();
        } catch (e) {
          setErr(e.message);
          setPromptModal(null);
        }
      },
    });
  }

  function deleteFolder(id, name) {
    setConfirmBulk({
      label: `the folder "${name}" (and everything inside it)`,
      onConfirm: async () => {
        await api("/api/folders", "POST", { action: "delete", id });
        if (activeFolder === id) setActiveFolder(null);
        setConfirmBulk(null);
        await loadFolders();
        await loadFiles(q, activeFolder === id ? null : activeFolder, dateRange);
      },
    });
  }

  function toggleSelectFolder(id) {
    setSelectedFolders((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function bulkDeleteFolders() {
    const ids = [...selectedFolders];
    setConfirmBulk({
      label: `${ids.length} folder${ids.length === 1 ? "" : "s"} (and everything inside them)`,
      onConfirm: async () => {
        await api("/api/folders", "POST", { action: "deleteMany", ids });
        setSelectedFolders(new Set());
        setConfirmBulk(null);
        await loadFolders();
        await loadFiles(q, activeFolder, dateRange);
      },
    });
  }

  function toggleExpand(id) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleFolderUpload(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    if (picked.length === 0) return;

    const accountId = me?.accountId;
    const pathToFolderId = new Map(); // "TopDir/Sub" -> folderId
    let uploaded = 0;
    let failed = 0;

    async function ensureFolder(pathSegments) {
      if (pathSegments.length === 0) return null;
      const key = pathSegments.join("/");
      if (pathToFolderId.has(key)) return pathToFolderId.get(key);
      const parentId = await ensureFolder(pathSegments.slice(0, -1));
      const name = pathSegments[pathSegments.length - 1];
      const { id } = await api("/api/folders", "POST", { action: "create", name, parentId });
      pathToFolderId.set(key, id);
      return id;
    }

    setErr("");
    for (const file of picked) {
      try {
        const rel = file.webkitRelativePath || file.name;
        const segments = rel.split("/");
        const dirSegments = segments.slice(0, -1); // drop the filename itself
        const folderId = await ensureFolder(dirSegments);
        await saveFile({ title: file.name.replace(/\.[a-zA-Z0-9]+$/, ""), folderId, file, accountId });
        uploaded++;
      } catch (e2) {
        console.error("Folder upload: failed on", file.name, e2.message);
        failed++;
      }
    }

    await loadFolders();
    await loadFiles(q, activeFolder, dateRange);
    setErr(failed > 0 ? `Uploaded ${uploaded} file(s), ${failed} failed.` : "");
  }

  const rootFolders = useMemo(() => (folders || []).filter((f) => !f.parentId), [folders]);
  const childrenOf = (id) => (folders || []).filter((f) => f.parentId === id);
  const folderName = (id) => folders?.find((f) => f.id === id)?.name;

  const sortedFiles = useMemo(() => {
    if (!files) return files;
    const arr = [...files];
    const dir = sort.dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let av, bv;
      if (sort.field === "name") { av = a.title.toLowerCase(); bv = b.title.toLowerCase(); }
      else if (sort.field === "size") { av = a.sizeBytes || 0; bv = b.sizeBytes || 0; }
      else if (sort.field === "type") { av = a.ext || ""; bv = b.ext || ""; }
      else { av = a.createdAt || ""; bv = b.createdAt || ""; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [files, sort]);

  if (view === "trash") {
    return (
      <TrashView
        items={trash}
        onBack={() => setView("files")}
        onRestore={async (type, id) => {
          await api("/api/trash", "POST", { action: "restore", type, id });
          await loadTrash();
        }}
        onPermanentDelete={(type, id, title) => {
          setConfirmBulk({
            label: `"${title}" forever`,
            onConfirm: async () => {
              await api("/api/trash", "POST", { action: "permanentDelete", type, id });
              setConfirmBulk(null);
              await loadTrash();
            },
          });
        }}
        onEmpty={() => {
          setConfirmBulk({
            label: "everything in the recycle bin, permanently",
            onConfirm: async () => {
              await api("/api/trash", "POST", { action: "emptyTrash" });
              setConfirmBulk(null);
              await loadTrash();
            },
          });
        }}
        confirmBulk={confirmBulk}
        onCancelConfirm={() => setConfirmBulk(null)}
        err={err}
      />
    );
  }

  if (view === "shares") {
    return (
      <SharesView
        shares={shares}
        onBack={() => setView("files")}
        onRevoke={revokeShare}
        err={err}
      />
    );
  }

  if (view === "gallery") {
    return (
      <GalleryView
        images={gallery}
        onBack={() => setView("files")}
        onOpen={openFile}
        err={err}
      />
    );
  }

  return (
    <div>
      <Nav />
      <div className="admin-shell">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <div>
            <h1 className="dash-heading" style={{ fontSize: 20 }}>Bizzux Files</h1>
            <p className="dash-sub" style={{ marginBottom: 0 }}>
              Upload or paste transcripts, documents and spreadsheets, organize them into folders, and search across all of them later.
            </p>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button
              className="link-btn"
              onClick={() => {
                setView("gallery");
                loadGallery();
              }}
            >
              Photos
            </button>
            <button
              className="link-btn"
              onClick={() => {
                setView("shares");
                loadShares();
              }}
            >
              Shared links
            </button>
            <button className="link-btn" onClick={switchToTrash}>Recycle bin</button>
            <button className="btn-outline-dark" onClick={() => folderUploadRef.current?.click()}>Upload folder</button>
            <button className="btn-primary-sm" onClick={() => setShowAdd(true)}>+ Add file</button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
          Storage used: {fmtSize(totalSizeBytes)}
        </p>
        {/* eslint-disable-next-line jsx-a11y/no-redundant-roles */}
        <input
          ref={folderUploadRef}
          type="file"
          webkitdirectory=""
          directory=""
          multiple
          style={{ display: "none" }}
          onChange={handleFolderUpload}
        />

        {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}

        <div className="row" style={{ gap: 20, alignItems: "flex-start" }}>
          <aside style={{ width: 220, flexShrink: 0 }}>
            <div className="card" style={{ padding: 10 }}>
              <FolderRow label="All files" icon="" active={activeFolder === null} onClick={() => setActiveFolder(null)} />
              <FolderRow label="No folder" icon="" active={activeFolder === "unfiled"} onClick={() => setActiveFolder("unfiled")} />
              {folders && folders.length > 0 && <div style={{ borderTop: "1px solid var(--line)", margin: "8px 0" }} />}
              {folders === null && <p className="muted" style={{ fontSize: 12, padding: "4px 8px" }}>Loading…</p>}
              {rootFolders.map((f) => (
                <FolderTree
                  key={f.id}
                  folder={f}
                  depth={0}
                  activeFolder={activeFolder}
                  expanded={expanded}
                  childrenOf={childrenOf}
                  selectedFolders={selectedFolders}
                  onSelect={setActiveFolder}
                  onToggleExpand={toggleExpand}
                  onRename={renameFolder}
                  onDelete={deleteFolder}
                  onNewSubfolder={createFolder}
                  onToggleCheck={toggleSelectFolder}
                  onShare={(id, name) => setShareModal({ targetType: "folder", targetId: id, targetName: name })}
                />
              ))}
              <button className="link-btn" onClick={() => createFolder(null)} style={{ marginTop: 8, fontSize: 13 }}>+ New folder</button>
              {selectedFolders.size > 0 && (
                <button className="link-btn danger" onClick={bulkDeleteFolders} style={{ display: "block", marginTop: 6, fontSize: 13 }}>
                  Delete {selectedFolders.size} selected folder{selectedFolders.size === 1 ? "" : "s"}
                </button>
              )}
            </div>
          </aside>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
              <input
                className="input"
                placeholder="Search file names and contents…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ maxWidth: 420, flex: 1, minWidth: 200 }}
              />
              <select
                className="input"
                style={{ width: "auto" }}
                value={dateRange.preset}
                onChange={(e) => setDateRange({ preset: e.target.value, from: "", to: "" })}
              >
                <option value="all">All time</option>
                <option value="today">Last 24 hours</option>
                <option value="week">Last 7 days</option>
                <option value="month">Last 30 days</option>
                <option value="custom">Custom range…</option>
              </select>
              {dateRange.preset === "custom" && (
                <>
                  <input
                    type="date"
                    className="input"
                    style={{ width: "auto" }}
                    value={dateRange.from}
                    onChange={(e) => setDateRange((r) => ({ ...r, from: e.target.value }))}
                  />
                  <span className="muted" style={{ alignSelf: "center" }}>to</span>
                  <input
                    type="date"
                    className="input"
                    style={{ width: "auto" }}
                    value={dateRange.to}
                    onChange={(e) => setDateRange((r) => ({ ...r, to: e.target.value }))}
                  />
                </>
              )}
              <div style={{ flex: 1 }} />
              <SortMenu sort={sort} onChange={setSort} />
              <ViewMenu density={density} onChange={setDensity} />
            </div>

            {selected.size > 0 && (
              <div className="card" style={{ marginBottom: 12, padding: 10 }}>
                <div className="row" style={{ gap: 14, alignItems: "center" }}>
                  <span style={{ fontSize: 13 }}>{selected.size} selected</span>
                  <select
                    className="input"
                    style={{ fontSize: 13, padding: "4px 6px", width: "auto" }}
                    defaultValue=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      bulkMoveFiles(e.target.value === "__none__" ? null : e.target.value);
                      e.target.value = "";
                    }}
                  >
                    <option value="" disabled>Move to…</option>
                    <option value="__none__">No folder</option>
                    {folders?.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                  <button className="link-btn danger" onClick={bulkDeleteFiles}>Delete selected</button>
                  <button className="link-btn" onClick={() => setSelected(new Set())}>Clear selection</button>
                </div>
              </div>
            )}

            <div className="card">
              {files === null && <p className="muted">Loading…</p>}
              {files && files.length === 0 && (
                <p className="muted">{q ? `No files match "${q}".` : "No files here yet."}</p>
              )}
              {files && files.length > 0 && density === "tiles" && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 14 }}>
                  {sortedFiles.map((f) => (
                    <div key={f.id} style={{ position: "relative", border: "1px solid var(--line)", borderRadius: 8, padding: 10, cursor: "pointer" }} onClick={() => openFile(f.id)}>
                      <div style={{ position: "absolute", top: 6, left: 6, zIndex: 2 }} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggleSelect(f.id)} />
                      </div>
                      <div style={{ position: "absolute", top: 2, right: 2, zIndex: 2 }} onClick={(e) => e.stopPropagation()}>
                        <RowMenu items={fileMenuItems(f)} />
                      </div>
                      <div style={{ width: "100%", aspectRatio: "1", marginBottom: 8 }}>
                        <FileThumb file={f} fill />
                      </div>
                      <p style={{ fontSize: 12, fontWeight: 600, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.title}>{f.title}</p>
                      <p className="muted" style={{ fontSize: 11, margin: "2px 0 0" }}>{fmtSize(f.sizeBytes)}</p>
                    </div>
                  ))}
                </div>
              )}
              {files && files.length > 0 && density !== "tiles" && (
                <div style={{ overflowX: "auto", fontSize: density === "compact" ? 12 : undefined }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 28 }}>
                          <input type="checkbox" checked={selected.size === files.length} onChange={toggleSelectAll} />
                        </th>
                        <th>Name</th><th>Folder</th><th>Type</th><th>Date</th><th>Size</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedFiles.map((f) => (
                        <tr key={f.id}>
                          <td><input type="checkbox" checked={selected.has(f.id)} onChange={() => toggleSelect(f.id)} /></td>
                          <td>
                            <div className="row" style={{ gap: 8, alignItems: "center" }}>
                              {density !== "compact" && <FileThumb file={f} size={28} />}
                              <div>
                                <button className="link-btn" onClick={() => openFile(f.id)} style={{ textAlign: "left" }}>
                                  {f.title}
                                </button>
                                {f.snippet && (
                                  <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>…{f.snippet}…</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td>{folderName(f.folderId) || "—"}</td>
                          <td style={{ textTransform: "uppercase", fontSize: 12 }}>{f.ext}</td>
                          <td>{f.createdAt ? new Date(f.createdAt).toLocaleDateString() : "—"}</td>
                          <td>{fmtSize(f.sizeBytes)}</td>
                          <td>
                            <RowMenu items={fileMenuItems(f)} />
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
          accountId={me?.accountId}
          defaultFolderId={typeof activeFolder === "string" && activeFolder !== "unfiled" ? activeFolder : null}
          onClose={() => setShowAdd(false)}
          onAdded={async () => {
            setShowAdd(false);
            await loadFiles(q, activeFolder, dateRange);
          }}
        />
      )}

      {viewing && (
        <ViewFileModal
          file={viewing}
          folderName={folderName(viewing.folderId)}
          onClose={() => setViewing(null)}
          onDownload={() => downloadFile(viewing)}
          onRename={() => rename(viewing.id, viewing.title)}
          onDelete={() => removeOne(viewing.id)}
          onDuplicate={() => {
            setViewing(null);
            duplicateFile(viewing.id);
          }}
          onShare={() => {
            setViewing(null);
            setShareModal({ targetType: "file", targetId: viewing.id, targetName: viewing.title });
          }}
        />
      )}

      {moveModal && (
        <MoveModal
          folders={folders}
          currentFolderId={moveModal.folderId}
          onCancel={() => setMoveModal(null)}
          onMove={async (folderId) => {
            await moveFile(moveModal.id, folderId);
            setMoveModal(null);
          }}
        />
      )}

      {detailsFile && (
        <DetailsModal file={detailsFile} folderName={folderName(detailsFile.folderId)} onClose={() => setDetailsFile(null)} />
      )}

      {confirmBulk && (
        <ConfirmDeleteModal
          label={confirmBulk.label}
          onConfirm={confirmBulk.onConfirm}
          onCancel={() => setConfirmBulk(null)}
        />
      )}

      {promptModal && (
        <PromptModal
          title={promptModal.title}
          defaultValue={promptModal.defaultValue}
          onSubmit={promptModal.onSubmit}
          onCancel={() => setPromptModal(null)}
        />
      )}

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {shareModal && (
        <ShareModal
          target={shareModal}
          onClose={() => setShareModal(null)}
          onCreate={createShare}
          onError={(msg) => setErr(msg)}
        />
      )}

      {shareResult && <ShareResultModal url={shareResult.url} onClose={() => setShareResult(null)} />}
    </div>
  );
}

// In-app replacement for window.prompt() — a plain browser dialog looks and
// behaves nothing like the rest of the product (unstyled, can't be themed,
// shows the raw domain). Same shape as every other modal here.
function PromptModal({ title, defaultValue, onSubmit, onCancel }) {
  const [value, setValue] = useState(defaultValue || "");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    await onSubmit(value.trim());
    setBusy(false);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h2 style={{ marginBottom: 14 }}>{title}</h2>
        <form onSubmit={submit} noValidate>
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus style={{ marginBottom: 16 }} />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn-outline-dark" onClick={onCancel}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// In-app replacement for window.confirm() — same reasoning as PromptModal.
function ConfirmModal({ title, message, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);

  async function confirmClick() {
    setBusy(true);
    await onConfirm();
    setBusy(false);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h2 style={{ marginBottom: 10 }}>{title}</h2>
        {message && <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>{message}</p>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn-outline-dark" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={confirmClick}>{busy ? "Working…" : "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

// OneDrive-style "⋯" more-actions menu — one trigger, closes on outside click.
function RowMenu({ items, label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="link-btn"
        aria-label={label || "More actions"}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        style={{ fontSize: 16, padding: "2px 8px", lineHeight: 1 }}
      >
        ⋯
      </button>
      {open && (
        <div
          className="card"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute", right: 0, top: "100%", marginTop: 4, zIndex: 30,
            minWidth: 180, padding: 6, boxShadow: "0 8px 24px rgba(0,0,0,.18)",
          }}
        >
          {items.map((it, i) =>
            it.divider ? (
              <div key={i} style={{ borderTop: "1px solid var(--line)", margin: "4px 2px" }} />
            ) : (
              <button
                key={i}
                type="button"
                className={"link-btn" + (it.danger ? " danger" : "")}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 8px", fontSize: 13 }}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                {it.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

// Thumbnail for a file row/tile: a real preview for images (fetched
// authenticated, once, then cached as a blob: URL), an emoji icon otherwise.
// size in px for a fixed square thumbnail (e.g. a 28px row icon); pass
// fill=true instead to have it stretch to whatever container sizes it
// (tiles/gallery grid cells sized by CSS grid, not a pixel value here).
function FileThumb({ file, size = 36, fill = false }) {
  const [url, setUrl] = useState(null);
  const showImage = isImageExt(file.ext) && file.hasBlob;
  const box = fill ? { width: "100%", height: "100%" } : { width: size, height: size };

  useEffect(() => {
    if (!showImage) return;
    let objectUrl;
    let cancelled = false;
    fetchBlobUrl(file.id)
      .then((u) => {
        if (cancelled) return;
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, showImage]);

  if (showImage) {
    return (
      <div style={{ ...box, borderRadius: 6, overflow: "hidden", background: "var(--line)", flexShrink: 0 }}>
        {url && <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      </div>
    );
  }
  return (
    <div style={{ ...box, borderRadius: 6, background: "var(--line)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: fill ? 40 : size * 0.55 }}>
      {iconFor(file.ext)}
    </div>
  );
}

function MoveModal({ folders, currentFolderId, onMove, onCancel }) {
  const [folderId, setFolderId] = useState(currentFolderId || "");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    await onMove(folderId || null);
    setBusy(false);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h2 style={{ marginBottom: 14 }}>Move to</h2>
        <form onSubmit={submit} noValidate>
          <select className="input" value={folderId} onChange={(e) => setFolderId(e.target.value)} autoFocus style={{ marginBottom: 16 }}>
            <option value="">No folder</option>
            {folders?.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn-outline-dark" onClick={onCancel}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? "Moving…" : "Move"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DetailsModal({ file, folderName, onClose }) {
  const rows = [
    ["Name", file.title],
    ["Type", isImageExt(file.ext) ? "Image (." + file.ext + ")" : "." + (file.ext || "txt")],
    ["Size", fmtSize(file.sizeBytes)],
    ["Folder", folderName || "No folder"],
    ["Created", file.createdAt ? new Date(file.createdAt).toLocaleString() : "—"],
    ["Created by", file.createdByEmail || "—"],
  ];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Details</h2>
          <button className="link-btn" onClick={onClose}>Close</button>
        </div>
        {rows.map(([label, value]) => (
          <div key={label} className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <span className="muted" style={{ fontSize: 13 }}>{label}</span>
            <span style={{ fontSize: 13, textAlign: "right", wordBreak: "break-word", maxWidth: "70%" }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SORT_FIELDS = [
  { key: "createdAt", label: "Modified" },
  { key: "name", label: "Name" },
  { key: "size", label: "File size" },
  { key: "type", label: "Type" },
];

function SortMenu({ sort, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" className="btn-outline-dark" onClick={() => setOpen((o) => !o)}>Sort</button>
      {open && (
        <div className="card" style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, zIndex: 30, minWidth: 160, padding: 6, boxShadow: "0 8px 24px rgba(0,0,0,.18)" }}>
          {SORT_FIELDS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="link-btn"
              style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 8px", fontSize: 13, fontWeight: sort.field === f.key ? 700 : 400 }}
              onClick={() => { onChange({ ...sort, field: f.key }); setOpen(false); }}
            >
              {sort.field === f.key ? "✓ " : ""}{f.label}
            </button>
          ))}
          <div style={{ borderTop: "1px solid var(--line)", margin: "4px 2px" }} />
          {[["asc", "Ascending"], ["desc", "Descending"]].map(([dir, label]) => (
            <button
              key={dir}
              type="button"
              className="link-btn"
              style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 8px", fontSize: 13, fontWeight: sort.dir === dir ? 700 : 400 }}
              onClick={() => { onChange({ ...sort, dir }); setOpen(false); }}
            >
              {sort.dir === dir ? "✓ " : ""}{label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ViewMenu({ density, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const OPTIONS = [
    ["list", "List"],
    ["compact", "Compact list"],
    ["tiles", "Tiles"],
  ];
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" className="btn-outline-dark" onClick={() => setOpen((o) => !o)}>View</button>
      {open && (
        <div className="card" style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, zIndex: 30, minWidth: 150, padding: 6, boxShadow: "0 8px 24px rgba(0,0,0,.18)" }}>
          {OPTIONS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="link-btn"
              style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 8px", fontSize: 13, fontWeight: density === key ? 700 : 400 }}
              onClick={() => { onChange(key); setOpen(false); }}
            >
              {density === key ? "✓ " : ""}{label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const EXPIRY_PRESETS = [
  { label: "1 hour", minutes: 60 },
  { label: "1 day", minutes: 24 * 60 },
  { label: "3 days", minutes: 3 * 24 * 60 },
  { label: "7 days", minutes: 7 * 24 * 60 },
  { label: "30 days", minutes: 30 * 24 * 60 },
];

function ShareModal({ target, onClose, onCreate, onError }) {
  const [mode, setMode] = useState("view"); // "view" | "upload" — upload only offered for folders
  const [password, setPassword] = useState("");
  const [expiryMinutes, setExpiryMinutes] = useState(EXPIRY_PRESETS[1].minutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 4) {
      setError("Password must be at least 4 characters");
      return;
    }
    setBusy(true);
    try {
      await onCreate({
        targetType: target.targetType,
        targetId: target.targetId,
        mode: target.targetType === "folder" ? mode : "view",
        password,
        expiresInMinutes: expiryMinutes,
      });
    } catch (e2) {
      setError(e2.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h2 style={{ marginBottom: 4 }}>Share "{target.targetName}"</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          Anyone with the link and this password can access it — no Bizzux account needed on their end.
        </p>
        <form onSubmit={submit} noValidate>
          {target.targetType === "folder" && (
            <div style={{ marginBottom: 14 }}>
              <label className="label">Access</label>
              <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="view">View & download only</option>
                <option value="upload">View, download & upload</option>
              </select>
            </div>
          )}
          <div style={{ marginBottom: 14 }}>
            <label className="label">Password *</label>
            <input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 4 characters" required />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label className="label">Expires after</label>
            <select className="input" value={expiryMinutes} onChange={(e) => setExpiryMinutes(Number(e.target.value))}>
              {EXPIRY_PRESETS.map((p) => (
                <option key={p.minutes} value={p.minutes}>{p.label}</option>
              ))}
            </select>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              The link stops working the moment this passes — or immediately if you revoke it sooner from "Shared links".
            </p>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn-outline-dark" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create link"}</button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}

function ShareResultModal({ url, onClose }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard permission denied or unavailable — the link is still
      // shown selected/visible below for a manual copy.
    }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h2 style={{ marginBottom: 10 }}>Link created</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
          Share this URL and the password with them separately (e.g. a different message) — anyone with both can access it until it expires or you revoke it.
        </p>
        <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} style={{ marginBottom: 14, fontSize: 13 }} />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn-outline-dark" onClick={copy}>{copied ? "Copied!" : "Copy link"}</button>
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function SharesView({ shares, onBack, onRevoke, err }) {
  return (
    <div>
      <Nav />
      <div className="admin-shell">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <h1 className="dash-heading" style={{ fontSize: 20 }}>Shared links</h1>
            <p className="dash-sub" style={{ marginBottom: 0 }}>Every link you've created to share a file or folder externally.</p>
          </div>
          <button className="link-btn" onClick={onBack}>Back to files</button>
        </div>

        {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}

        <div className="card">
          {shares === null && <p className="muted">Loading…</p>}
          {shares && shares.length === 0 && <p className="muted">No share links yet — use "Share" on a file or folder.</p>}
          {shares && shares.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th><th>Type</th><th>Access</th><th>Expires</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {shares.map((s) => {
                  const expired = !s.revoked && s.expiresAt && new Date(s.expiresAt) <= new Date();
                  const statusLabel = s.revoked ? "Revoked" : expired ? "Expired" : "Active";
                  return (
                    <tr key={s.id}>
                      <td>{s.targetType === "folder" ? FOLDER_ICON + " " : ""}{s.targetName}</td>
                      <td style={{ textTransform: "capitalize" }}>{s.targetType}</td>
                      <td style={{ textTransform: "capitalize" }}>{s.mode}</td>
                      <td>{s.expiresAt ? new Date(s.expiresAt).toLocaleString() : "—"}</td>
                      <td><span className={"status-pill " + (statusLabel === "Active" ? "active" : "expired")}>{statusLabel}</span></td>
                      <td>
                        {statusLabel === "Active" && <button className="link-btn danger" onClick={() => onRevoke(s.id)}>Revoke</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// OneDrive-style "Sep 8" / "Apr 28, 2023" group header — the year is
// dropped for dates within the current calendar year.
function dayLabel(iso) {
  if (!iso) return "Unknown date";
  const d = new Date(iso);
  const opts = d.getFullYear() === new Date().getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString(undefined, opts);
}

function GalleryView({ images, onBack, onOpen, err }) {
  const groups = useMemo(() => {
    if (!images) return [];
    const byDay = new Map();
    for (const f of images) {
      const key = f.createdAt ? f.createdAt.slice(0, 10) : "unknown";
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(f);
    }
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, items]) => ({ label: dayLabel(items[0].createdAt), items }));
  }, [images]);

  return (
    <div>
      <Nav />
      <div className="admin-shell">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <h1 className="dash-heading" style={{ fontSize: 20 }}>Photos</h1>
            <p className="dash-sub" style={{ marginBottom: 0 }}>Every image you've uploaded to Bizzux Files, across every folder.</p>
          </div>
          <button className="link-btn" onClick={onBack}>Back to files</button>
        </div>

        {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}

        {images === null && <p className="muted">Loading…</p>}
        {images && images.length === 0 && <p className="muted">No images yet — upload a photo from "+ Add file" to see it here.</p>}
        {groups.map((g) => (
          <div key={g.label} style={{ marginBottom: 22 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{g.label}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
              {g.items.map((f) => (
                <div
                  key={f.id}
                  style={{ aspectRatio: "1", borderRadius: 8, overflow: "hidden", cursor: "pointer" }}
                  onClick={() => onOpen(f.id)}
                  title={f.title}
                >
                  <FileThumb file={f} fill />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FolderRow({ label, icon, active, onClick, onRename, onDelete, onNewSubfolder, onShare, checked, onToggleCheck, style }) {
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
        ...style,
      }}
    >
      <div className="row" style={{ gap: 6, alignItems: "center", overflow: "hidden" }} onClick={onClick}>
        {onToggleCheck && (
          <input
            type="checkbox"
            checked={!!checked}
            onChange={(e) => {
              e.stopPropagation();
              onToggleCheck();
            }}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {icon && <span>{icon}</span>}
        <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
      </div>
      {(onRename || onDelete || onNewSubfolder || onShare) && (
        <div className="row" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>
          {onNewSubfolder && <button className="link-btn" style={{ fontSize: 11 }} onClick={onNewSubfolder}>+</button>}
          {onShare && <button className="link-btn" style={{ fontSize: 11 }} onClick={onShare}>Share</button>}
          {onRename && <button className="link-btn" style={{ fontSize: 11 }} onClick={onRename}>Edit</button>}
          {onDelete && <button className="link-btn danger" style={{ fontSize: 11 }} onClick={onDelete}>×</button>}
        </div>
      )}
    </div>
  );
}

function FolderTree({ folder, depth, activeFolder, expanded, childrenOf, selectedFolders, onSelect, onToggleExpand, onRename, onDelete, onNewSubfolder, onToggleCheck, onShare }) {
  const kids = childrenOf(folder.id);
  const isExpanded = expanded.has(folder.id);
  return (
    <>
      <FolderRow
        label={(kids.length > 0 ? (isExpanded ? "▾ " : "▸ ") : "") + folder.name}
        icon={FOLDER_ICON}
        active={activeFolder === folder.id}
        checked={selectedFolders.has(folder.id)}
        onToggleCheck={() => onToggleCheck(folder.id)}
        onClick={() => (kids.length > 0 ? onToggleExpand(folder.id) : null) || onSelect(folder.id)}
        onRename={() => onRename(folder.id, folder.name)}
        onDelete={() => onDelete(folder.id, folder.name)}
        onNewSubfolder={() => onNewSubfolder(folder.id)}
        onShare={() => onShare(folder.id, folder.name)}
        style={{ paddingLeft: 8 + depth * 16 }}
      />
      {isExpanded &&
        kids.map((child) => (
          <FolderTree
            key={child.id}
            folder={child}
            depth={depth + 1}
            activeFolder={activeFolder}
            expanded={expanded}
            childrenOf={childrenOf}
            selectedFolders={selectedFolders}
            onSelect={onSelect}
            onToggleExpand={onToggleExpand}
            onRename={onRename}
            onDelete={onDelete}
            onNewSubfolder={onNewSubfolder}
            onToggleCheck={onToggleCheck}
            onShare={onShare}
          />
        ))}
    </>
  );
}

function AddFileModal({ folders, accountId, defaultFolderId, onClose, onAdded }) {
  const [mode, setMode] = useState("upload"); // upload | paste
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pickedFile, setPickedFile] = useState(null);
  const [folderId, setFolderId] = useState(defaultFolderId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  async function handleFilePicked(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPickedFile(file);
    const ext = extOf(file.name);
    if (ext === "txt") {
      setContent(await file.text());
    } else {
      setContent(""); // not used for binary, just marks "something is loaded"
    }
    // Exporters (Otter included) tend to name every download the same
    // generic thing — strip the extension so it's a clean starting point.
    setTitle(file.name.replace(/\.[a-zA-Z0-9]+$/, ""));
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!title.trim()) {
      setError("Give this file a name");
      return;
    }
    if (mode === "upload" && !pickedFile) {
      setError("Choose a file first");
      return;
    }
    if (mode === "paste" && !content.trim()) {
      setError("Paste some text first");
      return;
    }
    setBusy(true);
    try {
      if (mode === "paste") {
        await saveFile({ title, folderId: folderId || null, pastedContent: content, accountId });
      } else {
        await saveFile({ title, folderId: folderId || null, file: pickedFile, accountId });
      }
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
              Upload a file
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
              <input ref={fileInputRef} type="file" accept={ACCEPTED_EXT.join(",")} onChange={handleFilePicked} />
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {pickedFile ? `${pickedFile.name} (${fmtSize(pickedFile.size)}) ready.` : "Accepts .txt, Word, Excel, PowerPoint, PDF, and images."}
              </p>
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

function ViewFileModal({ file, folderName, onClose, onDownload, onRename, onDelete, onDuplicate, onShare }) {
  const isPdf = file.ext === "pdf" && file.hasBlob;
  const isImage = isImageExt(file.ext) && file.hasBlob;
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewErr, setPreviewErr] = useState(false);

  // The download route needs a Bearer token, which a plain <img>/<iframe>
  // src can't attach — fetch it authenticated and preview a blob: URL.
  useEffect(() => {
    if (!isPdf && !isImage) return;
    let objectUrl;
    let cancelled = false;
    setPreviewErr(false);
    fetchBlobUrl(file.id)
      .then((u) => {
        if (cancelled) return;
        objectUrl = u;
        setPreviewUrl(u);
      })
      .catch(() => !cancelled && setPreviewErr(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, isPdf, isImage]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>{file.title}</h2>
          <button className="link-btn" onClick={onClose}>Close</button>
        </div>
        {folderName && <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>In folder: {folderName}</p>}

        {file.content ? (
          <div
            style={{
              maxHeight: 360, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8,
              padding: 14, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", marginTop: 10, marginBottom: 16,
            }}
          >
            {file.content}
          </div>
        ) : isImage ? (
          previewErr ? (
            <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 24, textAlign: "center", marginTop: 10, marginBottom: 16 }}>
              <p className="muted">Couldn't load this image — try downloading it instead.</p>
            </div>
          ) : (
            <div style={{ textAlign: "center", marginTop: 10, marginBottom: 16 }}>
              {previewUrl ? (
                <img src={previewUrl} alt={file.title} style={{ maxWidth: "100%", maxHeight: 420, borderRadius: 8, border: "1px solid var(--line)" }} />
              ) : (
                <p className="muted">Loading preview…</p>
              )}
            </div>
          )
        ) : isPdf ? (
          previewErr ? (
            <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 24, textAlign: "center", marginTop: 10, marginBottom: 16 }}>
              <p className="muted">Couldn't load this PDF — try downloading it instead.</p>
            </div>
          ) : previewUrl ? (
            <iframe src={previewUrl} style={{ width: "100%", height: 400, border: "1px solid var(--line)", borderRadius: 8, marginTop: 10, marginBottom: 16 }} />
          ) : (
            <p className="muted" style={{ marginTop: 10, marginBottom: 16 }}>Loading preview…</p>
          )
        ) : (
          <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 24, textAlign: "center", marginTop: 10, marginBottom: 16 }}>
            <p className="muted">Preview isn't available for .{file.ext} files — download to view.</p>
          </div>
        )}

        <div className="row" style={{ gap: 14 }}>
          <button className="btn-primary-sm" onClick={onDownload}>Download</button>
          {onShare && <button className="link-btn" onClick={onShare}>Share</button>}
          <button className="link-btn" onClick={onRename}>Rename</button>
          {onDuplicate && <button className="link-btn" onClick={onDuplicate}>Duplicate</button>}
          <button className="link-btn danger" onClick={onDelete}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// Bulk-destructive confirmation — requires typing the word "delete" before
// the confirm button enables, on top of already having chosen to act on
// multiple items (or empty the whole recycle bin).
function ConfirmDeleteModal({ label, onConfirm, onCancel }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = text.trim().toLowerCase() === "delete";

  async function confirm() {
    setBusy(true);
    await onConfirm();
    setBusy(false);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h2 style={{ marginBottom: 10 }}>Delete {label}?</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
          Type <strong>delete</strong> to confirm.
        </p>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} autoFocus style={{ marginBottom: 16 }} />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn-outline-dark" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" disabled={!ready || busy} onClick={confirm} style={!ready ? { opacity: 0.5 } : undefined}>
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TrashView({ items, onBack, onRestore, onPermanentDelete, onEmpty, confirmBulk, onCancelConfirm, err }) {
  return (
    <div>
      <Nav />
      <div className="admin-shell">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <h1 className="dash-heading" style={{ fontSize: 20 }}>Recycle bin</h1>
            <p className="dash-sub" style={{ marginBottom: 0 }}>
              Deleted files and folders stay here for 30 days before being removed for good.
            </p>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button className="link-btn" onClick={onBack}>Back to files</button>
            {items && items.length > 0 && <button className="link-btn danger" onClick={onEmpty}>Empty recycle bin</button>}
          </div>
        </div>

        {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}

        <div className="card">
          {items === null && <p className="muted">Loading…</p>}
          {items && items.length === 0 && <p className="muted">Recycle bin is empty.</p>}
          {items && items.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th><th>Type</th><th>Deleted</th><th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.type + it.id}>
                    <td>{it.type === "folder" ? FOLDER_ICON + " " : ""}{it.title}</td>
                    <td style={{ textTransform: "capitalize" }}>{it.type === "folder" ? "Folder" : it.ext || "File"}</td>
                    <td>{it.deletedAt ? new Date(it.deletedAt).toLocaleDateString() : "—"}</td>
                    <td>
                      <div className="row" style={{ gap: 14 }}>
                        <button className="link-btn" onClick={() => onRestore(it.type, it.id)}>Restore</button>
                        <button className="link-btn danger" onClick={() => onPermanentDelete(it.type, it.id, it.title)}>Delete forever</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {confirmBulk && (
        <ConfirmDeleteModal label={confirmBulk.label} onConfirm={confirmBulk.onConfirm} onCancel={onCancelConfirm} />
      )}
    </div>
  );
}
