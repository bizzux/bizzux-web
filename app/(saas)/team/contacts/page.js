"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminClient";
import { useAdminGate, GateMessage } from "@/components/admin/AdminGate";
import { CommandBar, Cmd, CmdSep } from "@/components/admin/CommandBar";
import Drawer from "@/components/admin/Drawer";

const EMPTY = { name: "", email: "", phone: "", company: "", notes: "" };

// Contacts: people and businesses you deal with who do not sign in to Bizzux. A contact is never a login, a membership or app access.
export default function ContactsPage() {
  const { state } = useAdminGate();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null); // { id?, ...fields }
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState("");

  const load = useCallback(async () => {
    try { const d = await adminApi("/api/iam/contacts"); setRows(d.contacts || []); setErr(""); } catch (e) { setErr(e.message); setRows([]); }
  }, []);
  useEffect(() => { if (state === "ok") load(); }, [state, load]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows || []).filter((r) => !s || [r.name, r.email, r.phone, r.company].some((x) => String(x).toLowerCase().includes(s)));
  }, [rows, q]);

  const openEdit = (r) => { setEdit(r || {}); setForm(r ? { name: r.name, email: r.email, phone: r.phone, company: r.company, notes: r.notes } : EMPTY); setFormErr(""); };
  async function save() {
    setBusy(true); setFormErr("");
    try { await adminApi("/api/iam/contacts", edit?.id ? "PUT" : "POST", { ...form, ...(edit?.id ? { id: edit.id } : {}) }); setEdit(null); await load(); }
    catch (e) { setFormErr(e.message); }
    setBusy(false);
  }
  async function remove(r) {
    if (!window.confirm("Delete the contact " + r.name + "? This does not affect any Bizzux login.")) return;
    try { await adminApi("/api/iam/contacts", "DELETE", { id: r.id }); await load(); } catch (e) { setErr(e.message); }
  }

  if (state !== "ok") return <div className="admin-shell"><GateMessage state={state} /></div>;
  return (
    <div className="admin-shell">
      <h1 className="dash-heading" style={{ fontSize: 22, margin: "4px 0 0" }}>Contacts</h1>
      <p className="muted" style={{ margin: "2px 0 0", fontSize: 12.5 }}>People and businesses you deal with who don&apos;t sign in to Bizzux. A contact has no login and no app access.</p>
      <CommandBar label="Contact actions">
        <Cmd primary icon="plus" onClick={() => openEdit(null)}>Add a contact</Cmd>
        <CmdSep />
        <Cmd icon="refresh" onClick={load}>Refresh</Cmd>
        <input className="input" style={{ maxWidth: 240, marginLeft: "auto", height: 32 }} placeholder="Search contacts" aria-label="Search contacts" value={q} onChange={(e) => setQ(e.target.value)} />
      </CommandBar>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="card">
        {rows === null && <p className="muted">Loading…</p>}
        {rows && rows.length === 0 && <p className="muted">No contacts yet. Use Add a contact to keep a record of someone who doesn&apos;t need a Bizzux login.</p>}
        {rows && rows.length > 0 && shown.length === 0 && <p className="muted">No contacts match your search.</p>}
        {shown.length > 0 && (
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Company</th><th></th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td><button type="button" className="adm-namebtn" onClick={() => openEdit(r)}>{r.name}</button></td>
                  <td>{r.email || "—"}</td><td>{r.phone || "—"}</td><td>{r.company || "—"}</td>
                  <td><button type="button" className="adm-link" onClick={() => remove(r)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Drawer open={!!edit} title={edit?.id ? "Edit contact" : "Add a contact"} onClose={() => setEdit(null)} size="narrow"
        footer={(<><button type="button" className="btn-primary-sm" onClick={save} disabled={busy || !form.name.trim()}>{busy ? "Saving…" : "Save"}</button><button type="button" className="btn-outline-dark" onClick={() => setEdit(null)}>Cancel</button></>)}>
        {[["name", "Name", true], ["email", "Email", false], ["phone", "Phone", false], ["company", "Company", false]].map(([k, label, req]) => (
          <div className="adm-field" key={k}>
            <label className="adm-lab" htmlFor={"c-" + k}>{label}{req && <span className="adm-req" aria-hidden="true"> *</span>}</label>
            <input id={"c-" + k} className="input" data-autofocus={k === "name" ? "" : undefined} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          </div>
        ))}
        <div className="adm-field"><label className="adm-lab" htmlFor="c-notes">Notes</label><textarea id="c-notes" className="input" rows={3} maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        {formErr && <p className="error" role="alert">{formErr}</p>}
      </Drawer>
    </div>
  );
}
