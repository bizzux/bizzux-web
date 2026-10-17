"use client";

// For an organization created without an administrator: create one now.
// The administrator becomes a Global Admin member of the existing organization
// (the organization id never changes). Shown in Users & Access when there is none.
import { useState } from "react";
import { blankPerson, orgCall, PersonFields, Field, ResultPanel } from "./shared";

export default function AssignAdmin({ orgId, orgName, onDone }) {
  const [p, setP] = useState(blankPerson());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (reason.trim().length < 3) { setErr("Enter a reason (it is recorded in the audit log)"); return; }
    setBusy(true);
    try {
      const d = await orgCall(orgId, "assignAdmin", { admin: p, reason: reason.trim() });
      setResult({ name: orgName, organizationId: orgId, credentials: d.credential ? [{ role: "Organization Admin", fullName: p.fullName, ...d.credential }] : [], invites: d.invite ? [{ ...d.invite, role: "Organization Admin" }] : [], assigned: true });
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  if (result) {
    return (
      <div style={{ marginBottom: 14 }}>
        <ResultPanel result={{ ...result, name: result.name + " — administrator added" }} />
        <button type="button" className="btn-primary" onClick={onDone}>Done</button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: 12, marginBottom: 14 }}>
      <div className="label" style={{ marginBottom: 4 }}>No administrator yet</div>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Create the administrator now. They join this organization as a Global Admin; the organization id and everything already set up for it stay as they are.
      </p>
      <PersonFields p={p} onChange={(k, v) => setP({ ...p, [k]: v })} />
      <Field label="Reason * (recorded in the audit log)">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer confirmed their admin by phone" />
      </Field>
      {err && <p className="error">{err}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create administrator"}</button>
    </form>
  );
}
