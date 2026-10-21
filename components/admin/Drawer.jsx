"use client";
// Slide-over panel used by Choose columns, the Add user wizard, User details and Reset password: fixed header, scrolling body, sticky footer,
// Escape / backdrop to close, focus moved in on open, kept inside while open (Tab cycles) and returned to the opener on close.
import { useEffect, useRef } from "react";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function Drawer({ open, title, onClose, children, footer, size = "narrow", dismissible = true, label }) {
  const panel = useRef(null);
  const opener = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement;
    const first = panel.current?.querySelector("[data-autofocus]") || panel.current?.querySelector(FOCUSABLE);
    (first || panel.current)?.focus();
    const onKey = (e) => {
      if (e.key === "Escape" && dismissible) { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const f = [...panel.current.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); try { opener.current?.focus?.(); } catch { /* opener gone */ } };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  return (
    <div className="adm-drawer-wrap">
      <div className="adm-drawer-backdrop" onClick={dismissible ? onClose : undefined} />
      <aside ref={panel} className={"adm-drawer " + size} role="dialog" aria-modal="true" aria-label={label || title} tabIndex={-1}>
        <header className="adm-drawer-head">
          <h2>{title}</h2>
          {dismissible && <button type="button" className="adm-drawer-x" aria-label="Close" onClick={onClose}>×</button>}
        </header>
        <div className="adm-drawer-body">{children}</div>
        {footer && <footer className="adm-drawer-foot">{footer}</footer>}
      </aside>
    </div>
  );
}
