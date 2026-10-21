"use client";
// The Admin Center frame: dark Bizzux top bar, left navigation (expand/collapse, icon rail, mobile overlay), breadcrumb and a content area.
// It wraps every /team page, so the pages themselves only render their own content.
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useMe } from "@/lib/useMe";
import { useIsAdminHost, wwwHrefFor } from "@/lib/adminLinks";
import SideNav from "./SideNav";
import { findActive, breadcrumbOf } from "./adminNavConfig";
import "./admin.css";

const KEY = "bzx.admin.nav.v1";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private window: state just is not remembered */ } };

export default function AdminShell({ children }) {
  const routerPath = usePathname();
  const onAdminHost = useIsAdminHost();
  const { user, me } = useMe();
  const [path, setPath] = useState(routerPath || "/");
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState({ users: true });
  const [mobile, setMobile] = useState(false); // overlay open on a narrow screen

  // The browser address is what the person sees (/users on the admin host), so the active item follows window.location, not the rewritten route.
  useEffect(() => { setPath(window.location.pathname); }, [routerPath]);
  useEffect(() => { const s = read(); if (typeof s.collapsed === "boolean") setCollapsed(s.collapsed); if (s.open) setOpen((o) => ({ ...o, ...s.open })); }, []);
  const save = useCallback((c, o) => write({ collapsed: c, open: o }), []);

  const active = findActive(path);
  // A group that contains the current page is open on arrival; opening or closing a group never changes which page is shown.
  useEffect(() => { if (active?.group) setOpen((o) => (o[active.group.key] ? o : { ...o, [active.group.key]: true })); }, [active?.group?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGroup = (k) => setOpen((o) => { const n = { ...o, [k]: !o[k] }; save(collapsed, n); return n; });
  const toggleRail = () => setCollapsed((c) => { save(!c, open); return !c; });
  const expandRail = (k) => { setCollapsed(false); setOpen((o) => { const n = { ...o, [k]: true }; save(false, n); return n; }); };
  useEffect(() => {
    if (!mobile) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setMobile(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobile]);

  const crumbs = breadcrumbOf(active);
  const initial = (me?.email || user?.email || "?").slice(0, 1).toUpperCase();
  return (
    <div className={"adm-shell" + (collapsed ? " rail" : "") + (mobile ? " mobile-open" : "")}>
      <header className="adm-top">
        <button type="button" className="adm-burger" aria-label="Toggle navigation" aria-expanded={mobile} onClick={() => setMobile((m) => !m)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <Link href={onAdminHost ? "/users" : "/team"} className="adm-brand" aria-label="Bizzux Admin Center">
          <Image src="/bizzux-logo-dark-bg.png" alt="Bizzux" width={96} height={26} priority style={{ height: 26, width: "auto" }} />
          <span>Admin Center</span>
        </Link>
        <div className="adm-spacer" />
        {me?.organizationName && <span className="adm-org" title="Company">{me.organizationName}</span>}
        <a className="adm-toplink" href={wwwHrefFor(onAdminHost, "/dashboard")}><span className="adm-long">Back to bizzux.com</span><span className="adm-short">bizzux.com</span></a>
        <button type="button" className="adm-toplink" onClick={async () => { await signOut(auth); window.location.assign(wwwHrefFor(onAdminHost, "/sign-in")); }}>Sign out</button>
        <span className="adm-avatar" title={me?.email || ""} aria-hidden="true">{initial}</span>
      </header>
      <div className="adm-body">
        {mobile && <div className="adm-backdrop" onClick={() => setMobile(false)} />}
        <aside className="adm-aside">
          <button type="button" className="adm-railbtn" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} aria-pressed={collapsed} onClick={toggleRail}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <SideNav active={active} open={open} onToggleGroup={toggleGroup} collapsed={collapsed} onExpandRail={expandRail} onAdminHost={onAdminHost} onNavigate={() => setMobile(false)} />
        </aside>
        <main className="adm-main" id="adm-main">
          <nav className="adm-crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (<span key={c + i}>{i > 0 && <span className="adm-sep" aria-hidden="true">/</span>}<span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c}</span></span>))}
          </nav>
          {children}
        </main>
      </div>
    </div>
  );
}
