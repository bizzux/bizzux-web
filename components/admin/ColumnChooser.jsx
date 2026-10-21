"use client";
// Microsoft-style "Choose columns" panel: Display name is locked on, Save is enabled only after a change, Reset restores the default set.
import { useEffect, useState } from "react";
import Drawer from "./Drawer";
import { USER_COLUMNS, DEFAULT_COLUMNS, cleanColumns, sameColumns } from "@/lib/adminColumns";

export default function ColumnChooser({ open, columns, onClose, onSave, saving, error }) {
  const [draft, setDraft] = useState(columns);
  useEffect(() => { if (open) setDraft(columns); }, [open, columns]);
  const toggle = (k) => setDraft((d) => cleanColumns(d.includes(k) ? d.filter((x) => x !== k) : [...d, k]));
  const changed = !sameColumns(cleanColumns(draft), columns);
  return (
    <Drawer open={open} title="Choose columns" onClose={onClose} size="narrow"
      footer={(
        <>
          <button type="button" className="btn-primary-sm" disabled={!changed || saving} onClick={() => onSave(cleanColumns(draft))}>{saving ? "Saving…" : "Save"}</button>
          <button type="button" className="btn-outline-dark" onClick={() => setDraft([...DEFAULT_COLUMNS])} disabled={sameColumns(cleanColumns(draft), DEFAULT_COLUMNS)}>Reset to default</button>
          <button type="button" className="btn-outline-dark" onClick={onClose}>Cancel</button>
        </>
      )}>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>Choose which columns the list shows. Your choice is saved for you only. Search and filters keep working on name, username and email whichever columns are shown.</p>
      <ul className="adm-checklist">
        {USER_COLUMNS.map((c) => (
          <li key={c.key}>
            <label>
              <input type="checkbox" data-autofocus={c.key === "signin" ? "" : undefined} checked={draft.includes(c.key)} disabled={c.locked} onChange={() => toggle(c.key)} />
              <span>{c.label}</span>{c.locked && <span className="muted" style={{ fontSize: 11.5 }}> (always shown)</span>}
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="error" role="alert">{error}</p>}
    </Drawer>
  );
}
