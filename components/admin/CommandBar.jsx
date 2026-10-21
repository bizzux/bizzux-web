"use client";
// Microsoft-style command bar and pager, shared by the Admin Center list screens.
import { useEffect, useRef, useState } from "react";
import { PAGE_SIZES } from "@/lib/adminTable";

const ICON = {
  plus: "M12 5v14M5 12h14", people: "M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M16 5a3 3 0 010 6M21 20a6 6 0 00-4-5.6",
  key: "M15 7a4 4 0 11-3.5 6L4 20.5V17h3v-3h3l1.5-1.5A4 4 0 0115 7z", trash: "M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  refresh: "M20 11a8 8 0 10-2.3 5.7M20 4v7h-7", download: "M12 4v11m0 0l-4-4m4 4l4-4M5 20h14", chevron: "M6 9l6 6 6-6", link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
};
const Ic = ({ n }) => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[n]} /></svg>);

export function CommandBar({ children, label = "Actions" }) {
  return <div className="adm-cmd" role="toolbar" aria-label={label}>{children}</div>;
}
export function Cmd({ icon, children, onClick, disabled, title, primary }) {
  return (
    <button type="button" className={"adm-cmdbtn" + (primary ? " primary" : "")} onClick={onClick} disabled={disabled} title={title}>
      {icon && <Ic n={icon} />}<span>{children}</span>
    </button>
  );
}
export const CmdSep = () => <span className="adm-cmdsep" aria-hidden="true" />;

// A command with a drop-down list (for example "Add a user"). Closes on Escape, outside click or choosing an item.
export function CmdMenu({ icon, label, items, primary }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span className="adm-menuwrap" ref={ref}>
      <button type="button" className={"adm-cmdbtn" + (primary ? " primary" : "")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon && <Ic n={icon} />}<span>{label}</span><Ic n="chevron" />
      </button>
      {open && (
        <ul className="adm-menu" role="menu">
          {items.map((it) => (<li key={it.label} role="none"><button type="button" role="menuitem" className="adm-menuitem" onClick={() => { setOpen(false); it.onClick(); }}>{it.icon && <Ic n={it.icon} />}{it.label}</button></li>))}
        </ul>
      )}
    </span>
  );
}

export function Pager({ info, onPage, onSize }) {
  return (
    <div className="adm-pager" role="navigation" aria-label="Pagination">
      <span aria-live="polite">{info.total === 0 ? "0 users" : `${info.from}–${info.to} of ${info.total}`}</span>
      <label>Rows <select className="input" value={info.size} onChange={(e) => onSize(Number(e.target.value))} aria-label="Rows per page">{PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      <button type="button" className="adm-cmdbtn" onClick={() => onPage(info.page - 1)} disabled={info.page <= 0} aria-label="Previous page">‹ Prev</button>
      <span>Page {info.page + 1} of {info.pages}</span>
      <button type="button" className="adm-cmdbtn" onClick={() => onPage(info.page + 1)} disabled={info.page >= info.pages - 1} aria-label="Next page">Next ›</button>
    </div>
  );
}
