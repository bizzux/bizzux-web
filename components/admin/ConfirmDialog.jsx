"use client";
// The one in-app confirmation dialog for the Admin Center (replaces the browser's confirm()). Centered, focus kept inside, Escape or a click outside cancels,
// destructive actions get a warning look. Use it through the hook so a call site reads like confirm():
//   const [ask, dialog] = useConfirm();   ...   if (!(await ask({ title, body, confirmLabel, tone: "danger" }))) return;   ...   {dialog}
// With an `input` option ({ label, hint, secret }) it also asks for one line of text: ask() then resolves to the entered string (possibly "")
// or null when cancelled, so test with `=== null`, not with truthiness.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const BUTTONS = "button:not([disabled]), input:not([disabled])";
const Warn = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l10 18H2zM12 10v5M12 18.5v.01" /></svg>);

// tone: "danger" (red, for removing or blocking), "warning" (amber, for sensitive changes such as Admin access) or "default".
export function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "default", input, onConfirm, onCancel }) {
  const box = useRef(null);
  const okBtn = useRef(null);
  const cancelBtn = useRef(null);
  const field = useRef(null);
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    setValue(""); setShown(false);
    (input ? field : tone === "default" ? okBtn : cancelBtn).current?.focus(); // a destructive dialog starts on the safe button
    // Captured on window so it runs before the drawer underneath sees the key: Escape closes only this dialog and Tab never leaves it.
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); onCancel?.(); return; }
      if (e.key !== "Tab") return;
      const f = [...(box.current?.querySelectorAll(BUTTONS) || [])];
      if (!f.length) return;
      e.stopImmediatePropagation();
      const first = f[0], last = f[f.length - 1];
      if (!box.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); try { opener?.focus?.(); } catch { /* opener gone */ } };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="adm-modal-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}>
      <div ref={box} className={"adm-modal " + tone} role="alertdialog" aria-modal="true" aria-labelledby="adm-modal-title" aria-describedby="adm-modal-body">
        <div className="adm-modal-head">
          {tone !== "default" && <span className="adm-modal-ic" aria-hidden="true"><Warn /></span>}
          <h2 id="adm-modal-title">{title}</h2>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onConfirm?.(value); }}>
          <div id="adm-modal-body" className="adm-modal-body">{body}</div>
          {input && (
            <div className="adm-modal-field">
              <label htmlFor="adm-modal-input">{input.label}</label>
              <input ref={field} id="adm-modal-input" className="adm-modal-input" type={input.secret && !shown ? "password" : "text"} value={value} autoComplete="off" spellCheck={false}
                onChange={(e) => setValue(e.target.value)} />
              {input.secret && <label className="adm-modal-show"><input type="checkbox" checked={shown} onChange={(e) => setShown(e.target.checked)} /> Show</label>}
              {input.hint && <span className="adm-modal-hint">{input.hint}</span>}
            </div>
          )}
          <div className="adm-modal-actions">
            <button ref={cancelBtn} type="button" className="adm-btn-outline" onClick={onCancel}>{cancelLabel}</button>
            <button ref={okBtn} type="submit" className={"adm-modal-ok " + tone}>{confirmLabel}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

// ask(options) -> Promise<boolean>; render `dialog` once in the component's JSX. Asking again while one is open cancels the first.
export function useConfirm() {
  const [opts, setOpts] = useState(null);
  const resolver = useRef(null);
  const ask = useCallback((o) => new Promise((resolve) => {
    resolver.current?.(null); // superseded: falsy for a confirm; callers of an input dialog test `=== null`
    resolver.current = resolve;
    setOpts(o);
  }), []);
  const settle = (answer) => { const r = resolver.current; resolver.current = null; setOpts(null); r?.(answer); };
  const hasInput = !!opts?.input;
  const dialog = <ConfirmDialog open={!!opts} {...(opts || {})} onConfirm={(v) => settle(hasInput ? v : true)} onCancel={() => settle(hasInput ? null : false)} />;
  return [ask, dialog];
}
