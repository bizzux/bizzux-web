"use client";
// Shared Bizzux profile menu for EVERY Bizzux app (top-right avatar menu). One source file in the portal repo, copied byte-for-byte into each app by
// scripts/sync-shell-kit.mjs (a test fails if any copy drifts). It has no imports from the app: the app passes how to get a sign-in token and how
// to sign out. What it shows comes from ONE server decision (GET {portal}/api/shell/menu); hiding an entry is tidiness, the backends refuse regardless.
//   - Switch Bizzux application: only apps this person can open (licensed + assigned). Opening one uses the existing sign-in mint of that app.
//   - Admin Center: only for company Owners/Admins. Opened through the URL-free hand-off (a one-time code posted as a form), never a URL token.
//   - Sign out.
// If the menu cannot be loaded the header still works (who you are + Sign out).
import { useCallback, useEffect, useRef, useState } from "react";

const PORTAL = () => (process.env.NEXT_PUBLIC_BIZZUX_WEB || "https://www.bizzux.com").replace(/\/+$/, "");

export function useBizzuxMenu({ app, getToken, enabled = true }) {
  const [menu, setMenu] = useState(null);
  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const r = await fetch(`${PORTAL()}/api/shell/menu?app=${encodeURIComponent(app)}`, { headers: { Authorization: "Bearer " + token } });
      if (!r.ok) throw new Error("menu");
      setMenu(await r.json());
    } catch { setMenu((m) => m || { person: {}, organization: null, apps: [], admin: { show: false }, addEmployee: { central: false } }); }
  }, [app, getToken]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (enabled) load(); }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return { menu, reload: load };
}

// Opens the Admin Center. The one-time code is posted as a form so it never appears in any address. `intent` / `returnTo` / `to` are validated by the
// server (an unknown app, a foreign return address or an unlisted page is refused or reset), so nothing here can steer the destination.
export async function openAdminCenter({ app, getToken, intent = "", returnTo = "/", to = "/users" }) {
  const token = await getToken();
  const r = await fetch(`${PORTAL()}/api/admin-center/handoff`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ from: app, intent, returnTo, to }) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 403) throw new Error("The Admin Center is for company owners and admins. Ask your organization administrator.");
  if (!r.ok || !d.code) throw new Error(d.error || "Could not open the Admin Center.");
  const f = document.createElement("form"); f.method = "POST"; f.action = d.action;
  const i = document.createElement("input"); i.type = "hidden"; i.name = "code"; i.value = d.code; f.appendChild(i);
  document.body.appendChild(f); f.submit();
}

const S = {
  wrap: { position: "relative", display: "inline-block" },
  btn: (dark) => ({ width: 32, height: 32, borderRadius: "50%", border: "0", cursor: "pointer", fontWeight: 700, fontSize: 13, color: "#fff", background: dark ? "linear-gradient(135deg,#12a695,#2159d4)" : "linear-gradient(135deg,#12a695,#2159d4)" }),
  panel: { position: "absolute", right: 0, top: 40, zIndex: 1000, width: 290, maxWidth: "92vw", background: "#fff", color: "#1f2937", border: "1px solid #e5e7eb", borderRadius: 8, boxShadow: "0 10px 30px rgba(15,23,42,.18)", padding: "6px 0", fontSize: 13.5, textAlign: "left" },
  head: { padding: "10px 14px", borderBottom: "1px solid #f1f5f9" },
  sec: { padding: "8px 14px 2px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "#6b7280" },
  item: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", padding: "8px 14px", background: "none", border: 0, textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" },
  note: { padding: "6px 14px", color: "#b91c1c", fontSize: 12.5 },
};

export default function BizzuxProfileMenu({ app, menu, getToken, onSignOut, tone = "light", fallbackName = "" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const ref = useRef(null);
  const btnRef = useRef(null);
  const name = menu?.person?.name || fallbackName || menu?.person?.email || "";
  const initials = menu?.person?.initials || String(name || "?").trim().charAt(0).toUpperCase();

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => {
      if (e.key === "Escape") { setOpen(false); btnRef.current?.focus(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [...(ref.current?.querySelectorAll("[role=menuitem]") || [])];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", key);
    setTimeout(() => ref.current?.querySelector("[role=menuitem]")?.focus(), 0);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [open]);

  async function switchTo(a) {
    setBusy(a.key); setErr("");
    try {
      const token = await getToken();
      const r = await fetch(PORTAL() + a.ssoEndpoint, { headers: { Authorization: "Bearer " + token } });
      const d = await r.json();
      if (!r.ok || !d.url) throw new Error(d.error || "Couldn't open that app right now.");
      window.location.href = d.url;
    } catch (e) { setErr(e.message || "Couldn't open that app right now."); setBusy(""); }
  }
  async function admin() {
    setBusy("admin"); setErr("");
    try { await openAdminCenter({ app, getToken, returnTo: "/" }); } catch (e) { setErr(e.message); setBusy(""); }
  }

  const apps = (menu?.apps || []).filter((a) => !a.current);
  return (
    <span style={S.wrap} ref={ref}>
      <button ref={btnRef} type="button" style={S.btn(tone === "dark")} aria-haspopup="menu" aria-expanded={open} aria-label={"Account menu" + (name ? " for " + name : "")} title={name || "Account"} onClick={() => setOpen((o) => !o)}>{initials}</button>
      {open && (
        <div style={S.panel} role="menu" aria-label="Account menu">
          <div style={S.head}><b>{name || "Signed in"}</b>{menu?.person?.email && menu.person.email !== name && <div style={{ color: "#6b7280", fontSize: 12.5 }}>{menu.person.email}</div>}{menu?.organization?.name && <div style={{ color: "#6b7280", fontSize: 12.5 }}>{menu.organization.name}</div>}</div>
          {apps.length > 0 && <div style={S.sec} id="bzx-switch">Switch Bizzux application</div>}
          {apps.map((a) => (<button key={a.key} type="button" role="menuitem" style={S.item} disabled={!!busy} onClick={() => switchTo(a)}><span>{a.name}</span>{busy === a.key && <span aria-hidden="true">…</span>}</button>))}
          {menu?.admin?.show && (<><div style={S.sec}>Administration</div><button type="button" role="menuitem" style={S.item} disabled={!!busy} onClick={admin}><span>Admin Center</span><span aria-hidden="true">{busy === "admin" ? "…" : "↗"}</span></button></>)}
          <div style={{ borderTop: "1px solid #f1f5f9", margin: "6px 0 0" }} />
          {err && <div style={S.note} role="alert">{err}</div>}
          <button type="button" role="menuitem" style={S.item} onClick={() => { setOpen(false); onSignOut?.(); }}><span>Sign out</span></button>
        </div>
      )}
    </span>
  );
}
