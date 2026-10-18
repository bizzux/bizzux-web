"use client";

import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import { MODES, MODE_LABEL, quote, validateBook, adviceFor, cliffReport, marginFor, normalizeBook } from "@/lib/attendancePricing";

// Global Admin → Revenue & Billing → Attendance Pricing. Versioned price books with a two-person publish, customer contracts and the
// cost/margin model. Everything here is PREVIEW and configuration: nothing on this screen charges a customer or changes an existing
// subscription. Prices are never edited in place: a published version is history; changes are made in a new draft.
async function api(method, body) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch("/api/admin/attendance-pricing", { method, headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
const money = (n) => "₹" + (Math.round(Number(n || 0) * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const STATUS_LABEL = { draft: "Draft", pending_approval: "Waiting for approval", scheduled: "Scheduled", published: "Published", retired: "Retired" };
const STATUS_CLS = { draft: "trial", pending_approval: "trial", scheduled: "active", published: "active", retired: "" };
const SECTIONS = [["books", "Price books"], ["contracts", "Customer contracts"], ["margin", "Cost & margin"]];

export default function AttendancePricingManager() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [section, setSection] = useState("books");
  async function load() { try { setData(await api("GET")); setErr(""); } catch (e) { setErr(e.message); } }
  useEffect(() => { load(); }, []);
  if (err && !data) return <p className="error">{err}</p>;
  if (!data) return <p className="muted">Loading Attendance pricing…</p>;
  return (
    <div>
      <div className="card" style={{ marginBottom: 16, background: "#f0fdfa", borderColor: "#99f6e4" }}>
        <p style={{ fontSize: 13, margin: 0 }}>
          <strong>Attendance Pricing.</strong> One price book for Bizzux Attendance: an organisation fee plus a per-employee price for each of the four modes, an optional Face + GPS add-on, volume and annual discounts.
          A version is edited as a <strong>draft</strong>, then a <strong>different person</strong> approves it. Published versions are never changed, and existing customers can stay on the version they signed up to.
          This screen only previews — it does not charge anyone or change an existing subscription.
        </p>
      </div>
      <div className="admin-tabs" role="tablist" style={{ marginBottom: 16 }}>
        {SECTIONS.map(([id, l]) => <button key={id} role="tab" aria-selected={section === id} className={"admin-tab" + (section === id ? " active" : "")} onClick={() => setSection(id)}>{l}</button>)}
      </div>
      {section === "books" && <Books data={data} reload={load} />}
      {section === "contracts" && <Contracts data={data} reload={load} />}
      {section === "margin" && <Margin data={data} reload={load} />}
    </div>
  );
}

// ---- price books ---------------------------------------------------------------------------------------------------------------------
function Books({ data, reload }) {
  const [selId, setSelId] = useState(data.inForceId || data.books[0]?.id || null);
  const [msg, setMsg] = useState({ text: "", bad: false });
  const [busy, setBusy] = useState(false);
  const sel = data.books.find((b) => b.id === selId) || null;
  const say = (text, bad = false) => setMsg({ text, bad });
  async function act(body, ok) { setBusy(true); try { const r = await api("POST", body); say(ok || "Done."); await reload(); return r; } catch (e) { say(e.message, true); } finally { setBusy(false); } }

  return (
    <div>
      {msg.text && <p className={msg.bad ? "error" : "muted"} role="status" style={{ fontSize: 13 }}>{msg.text}</p>}
      <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <button className="btn-primary-sm" disabled={busy} onClick={async () => { const r = await act({ action: "createDraft", fromProposed: true }, "Draft created from the proposed numbers. They are proposals only — not approved, not measured for profitability."); if (r?.id) setSelId(r.id); }}>+ New draft from the proposed numbers</button>
        {sel && <button className="btn-outline-dark" disabled={busy} onClick={async () => { const r = await act({ action: "createDraft", basedOn: sel.id }, "Draft copied."); if (r?.id) setSelId(r.id); }}>Copy v{sel.version} into a new draft</button>}
      </div>
      {data.books.length === 0 ? <p className="muted">No price book yet. Start from the proposed numbers, review them, then submit for approval.</p> : (
        <table className="table" style={{ width: "100%", marginBottom: 14 }}>
          <thead><tr><th style={{ textAlign: "left" }}>Version</th><th style={{ textAlign: "left" }}>Name</th><th style={{ textAlign: "left" }}>Status</th><th style={{ textAlign: "left" }}>Effective</th><th style={{ textAlign: "left" }}>Drafted by</th><th /></tr></thead>
          <tbody>
            {data.books.map((b) => (
              <tr key={b.id} style={selId === b.id ? { background: "#f0fdfa" } : undefined}>
                <td>v{b.version}</td><td>{b.name}</td>
                <td><span className={"status-pill " + (STATUS_CLS[b.status] || "")}>{STATUS_LABEL[b.status] || b.status}</span>{data.inForceId === b.id && <span className="status-pill active" style={{ marginLeft: 6 }}>in force</span>}</td>
                <td>{b.effectiveFrom || "—"}</td><td className="muted" style={{ fontSize: 12 }}>{b.createdByEmail}</td>
                <td><button className="btn-outline-dark" onClick={() => setSelId(b.id)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {sel && <Editor key={sel.id + sel.status + (sel.history?.length || 0)} book={sel} act={act} busy={busy} />}
    </div>
  );
}

function Editor({ book, act, busy }) {
  const editable = book.status === "draft";
  const [b, setB] = useState(() => structuredClone(book.book));
  const [name, setName] = useState(book.name || "");
  const [eff, setEff] = useState(book.effectiveFrom || "");
  const [note, setNote] = useState("");
  const problems = useMemo(() => validateBook(b), [b]);
  const advice = useMemo(() => adviceFor(b), [b]);
  const cliffs = useMemo(() => cliffReport(b).filter((c) => c.drop > 0), [b]);
  const set = (path, v) => setB((x) => { const n = structuredClone(x); let o = n; const ks = path.split("."); ks.slice(0, -1).forEach((k) => { o = o[k]; }); o[ks.at(-1)] = v; return n; });
  const field = (label, path, props = {}) => {
    const v = path.split(".").reduce((o, k) => o?.[k], b);
    return <label style={{ display: "block", fontSize: 12.5 }}>{label}<input className="input" type="number" min="0" step="any" disabled={!editable} value={v ?? ""} onChange={(e) => set(path, e.target.value === "" ? "" : Number(e.target.value))} style={{ width: "100%" }} {...props} /></label>;
  };
  return (
    <div className="card" style={{ marginTop: 8 }}>
      <h3 style={{ marginTop: 0 }}>v{book.version} <span className={"status-pill " + (STATUS_CLS[book.status] || "")}>{STATUS_LABEL[book.status]}</span></h3>
      {!editable && <p className="muted" style={{ fontSize: 13 }}>This version is {book.status === "pending_approval" ? "waiting for a different person to approve it" : "history and can't be edited"}. Copy it into a new draft to change anything.</p>}
      {book.note && <p className="muted" style={{ fontSize: 12.5 }}>{book.note}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 12.5 }}>Version name<input className="input" disabled={!editable} value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} /></label>
        {field("Organisation fee (₹/month)", "baseFee")}
        {MODES.map((m) => field(`${MODE_LABEL[m]} (₹/employee/month)`, `modePrices.${m}`))}
        {field("Annual payment discount (%)", "annualDiscountPct")}
        {field("Minimum monthly fee (₹)", "minimumMonthlyFee")}
        {field("Free trial (days)", "trialDays")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: 12.5 }}><input type="checkbox" disabled={!editable} checked={!!b.faceGps?.enabled} onChange={(e) => set("faceGps.enabled", e.target.checked)} /> Offer Face + GPS (needs Verified or Smart Geofence)</label>
        {field("Face + GPS (₹/eligible employee/month)", "faceGps.price")}
        {field("Face checks included / employee / month", "faceGps.allowancePerEmployee")}
        {field("Price per extra face check (₹)", "faceGps.overagePerCheck")}
        <label style={{ display: "block", fontSize: 12.5 }}>Volume tiers<select className="input" disabled={!editable} value={b.tierMode} onChange={(e) => set("tierMode", e.target.value)} style={{ width: "100%" }}>
          <option value="whole">Whole-bill (tier % off the whole per-employee bill)</option>
          <option value="graduated">Graduated (tier % only for people inside each band)</option></select></label>
      </div>
      <h4 style={{ margin: "8px 0 4px" }}>Volume discount tiers</h4>
      <table className="table" style={{ width: "100%", maxWidth: 520 }}>
        <thead><tr><th style={{ textAlign: "left" }}>From employees</th><th style={{ textAlign: "left" }}>Discount %</th><th style={{ textAlign: "left" }}>Needs admin approval</th><th /></tr></thead>
        <tbody>
          {(b.volumeTiers || []).map((t, i) => (
            <tr key={i}>
              <td><input className="input" type="number" min="1" disabled={!editable} value={t.min} onChange={(e) => set(`volumeTiers.${i}.min`, Number(e.target.value))} style={{ width: 90 }} /></td>
              <td><input className="input" type="number" min="0" max="100" step="any" disabled={!editable} value={t.pct} onChange={(e) => set(`volumeTiers.${i}.pct`, Number(e.target.value))} style={{ width: 90 }} /></td>
              <td><input type="checkbox" disabled={!editable} checked={!!t.requiresApproval} onChange={(e) => set(`volumeTiers.${i}.requiresApproval`, e.target.checked)} /></td>
              <td>{editable && i > 0 && <button className="btn-outline-dark" onClick={() => set("volumeTiers", b.volumeTiers.filter((_, j) => j !== i))}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editable && <button className="btn-outline-dark" style={{ marginTop: 6 }} onClick={() => set("volumeTiers", [...(b.volumeTiers || []), { min: (b.volumeTiers?.at(-1)?.min || 1) + 50, pct: b.volumeTiers?.at(-1)?.pct || 0 }])}>+ Add tier</button>}
      <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>Only one discount applies: the greater of the volume discount and the annual discount, never both unless a customer contract (approved by the Platform Owner) says so. Discounts apply to per-employee fees, not the organisation fee.</p>

      {problems.length > 0 && <ul className="error" style={{ fontSize: 13 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {advice.length > 0 && <ul style={{ fontSize: 13, color: "#92400e" }}>{advice.map((p) => <li key={p}>{p}</li>)}</ul>}
      {b.tierMode === "whole" && cliffs.length > 0 && (
        <p className="muted" style={{ fontSize: 12.5 }}>Where the bill drops as a company grows: {cliffs.map((c) => `${c.min - 1} → ${c.min} people saves ${money(c.drop)}`).join(" · ")}.</p>
      )}

      <Preview book={b} />

      <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        {editable && <button className="btn-primary-sm" disabled={busy} onClick={() => act({ action: "updateDraft", id: book.id, name, book: b }, "Draft saved.")}>Save draft</button>}
        {editable && (
          <>
            <label style={{ fontSize: 12.5 }}>Effective from <input className="input" type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></label>
            <button className="btn-outline-dark" disabled={busy || problems.length > 0 || !eff} onClick={() => act({ action: "updateDraft", id: book.id, name, book: b }).then(() => act({ action: "submit", id: book.id, effectiveFrom: eff }, "Submitted. A different person must now approve it."))}>Save and submit for approval</button>
            <button className="btn-outline-dark" disabled={busy} onClick={() => confirm("Discard this draft?") && act({ action: "discardDraft", id: book.id }, "Draft discarded.")}>Discard draft</button>
          </>
        )}
        {book.status === "pending_approval" && (
          <>
            <button className="btn-primary-sm" disabled={busy} onClick={() => confirm(`Publish v${book.version}, effective ${book.effectiveFrom}? Customers on their own pinned version are not affected.`) && act({ action: "approve", id: book.id }, "Approved.")}>Approve and publish (Platform Owner)</button>
            <input className="input" placeholder="Reason, if sending back" value={note} onChange={(e) => setNote(e.target.value)} style={{ minWidth: 200 }} />
            <button className="btn-outline-dark" disabled={busy || !note.trim()} onClick={() => act({ action: "sendBack", id: book.id, note }, "Sent back to draft.")}>Send back</button>
          </>
        )}
      </div>
      <Impact id={book.id} />
      <details style={{ marginTop: 10 }}>
        <summary className="muted" style={{ fontSize: 12.5, cursor: "pointer" }}>History</summary>
        <ul style={{ fontSize: 12.5 }}>{(book.history || []).map((h, i) => <li key={i}>{h.at?.slice(0, 16).replace("T", " ")} — {h.type}{h.note ? ` (${h.note})` : ""} <span className="muted">{h.byEmail}</span></li>)}</ul>
      </details>
    </div>
  );
}

function Preview({ book }) {
  const [counts, setCounts] = useState({ manager: 40, self: 30, verified: 20, smart_geofence: 10 });
  const [face, setFace] = useState(0);
  const [cycle, setCycle] = useState("month");
  const q = useMemo(() => quote(normalizeBook(book), { counts, faceGpsCount: face, cycle }), [book, counts, face, cycle]);
  return (
    <div className="card" style={{ background: "#f8fafc", marginTop: 12 }}>
      <h4 style={{ marginTop: 0 }}>Try it: what would an organisation pay?</h4>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        {MODES.map((m) => <label key={m} style={{ fontSize: 12 }}>{MODE_LABEL[m]}<input className="input" type="number" min="0" value={counts[m]} onChange={(e) => setCounts({ ...counts, [m]: Number(e.target.value) })} style={{ width: 90, display: "block" }} /></label>)}
        <label style={{ fontSize: 12 }}>With Face + GPS<input className="input" type="number" min="0" value={face} onChange={(e) => setFace(Number(e.target.value))} style={{ width: 90, display: "block" }} /></label>
        <label style={{ fontSize: 12 }}>Billing<select className="input" value={cycle} onChange={(e) => setCycle(e.target.value)} style={{ display: "block" }}><option value="month">Monthly</option><option value="year">Annual</option></select></label>
      </div>
      <table className="table" style={{ width: "100%", maxWidth: 560 }}>
        <tbody>
          {q.lines.map((l) => <tr key={l.key}><td>{l.label}</td><td>{l.qty} × {money(l.unit)}</td><td style={{ textAlign: "right" }}>{money(l.amount)}</td></tr>)}
          {q.discount.pct > 0 && <tr><td>Discount ({q.discount.type}, {q.discount.pct}%)</td><td /><td style={{ textAlign: "right" }}>−{money(q.discount.amount)}</td></tr>}
          {q.minimum.applied && <tr><td>Minimum monthly fee applied</td><td /><td style={{ textAlign: "right" }}>{money(q.minimum.monthly)}</td></tr>}
          <tr><td><strong>Total {q.periodLabel}</strong></td><td /><td style={{ textAlign: "right" }}><strong>{money(q.total)}</strong></td></tr>
        </tbody>
      </table>
      {q.needsApproval && <p className="muted" style={{ fontSize: 12.5 }}>{q.needsApproval.reason}</p>}
      {q.threshold.next && <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>{q.threshold.next.employeesToGo} more employee{q.threshold.next.employeesToGo === 1 ? "" : "s"} reaches the {q.threshold.next.pct}% tier ({q.threshold.next.min}+).</p>}
      {q.notes.map((n) => <p key={n} className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>{n}</p>)}
    </div>
  );
}

function Impact({ id }) {
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  async function go() { setBusy(true); try { setR(await api("POST", { action: "impact", id })); } catch (e) { setR({ error: e.message }); } setBusy(false); }
  return (
    <div style={{ marginTop: 10 }}>
      <button className="btn-outline-dark" disabled={busy} onClick={go}>Preview impact on organisations</button>
      {r?.error && <span className="error" style={{ marginLeft: 8 }}>{r.error}</span>}
      {r && !r.error && (
        <p className="muted" style={{ fontSize: 12.5 }}>
          {r.organisations} organisation{r.organisations === 1 ? "" : "s"} on licence pricing: {r.affected} would change ({r.increases} up, {r.decreases} down; net {money(r.deltaMonthly)}/month); {r.protected} protected by a pinned version.
          Organisations still on their current per-user plan are not part of this.
          {r.top.length > 0 && <> Largest changes: {r.top.slice(0, 5).map((t) => `${t.name} ${t.delta > 0 ? "+" : ""}${money(t.delta)}`).join(", ")}.</>}
        </p>
      )}
    </div>
  );
}

// ---- contracts -----------------------------------------------------------------------------------------------------------------------
function Contracts({ data, reload }) {
  const blank = { orgId: "", billingBasis: "assigned", pinnedVersion: "", baseFee: "", minimumMonthlyFee: "", faceGpsPrice: "", modePrices: {}, purchased: {}, fixedDiscountPct: "", approvedTiers: "", notes: "" };
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState({ text: "", bad: false });
  const [busy, setBusy] = useState(false);
  const published = data.books.filter((b) => ["published", "scheduled", "retired"].includes(b.status));
  const [ob, setOb] = useState({ manager: 0, self: 0, verified: 0, smart_geofence: 0, cycle: "month" });
  async function onboard(mode) {
    setBusy(true);
    try {
      const r = await api("POST", { action: "onboardOrg", orgId: f.orgId, counts: ob, cycle: ob.cycle, mode });
      setMsg({ text: mode === "trial" ? `Trial started for ${f.orgId} (${r.days} days, ends ${r.trialEnds}). No payment was taken.` : "Contracted start recorded. Billing happens outside the portal until gateway billing is enabled.", bad: false });
    } catch (e) { setMsg({ text: e.message, bad: true }); }
    setBusy(false);
  }
  async function save() {
    setBusy(true);
    try {
      await api("POST", { action: "saveContract", ...f, approvedTiers: String(f.approvedTiers || "").split(",").map((x) => x.trim()).filter(Boolean) });
      setMsg({ text: "Contract saved.", bad: false }); setF(null); await reload();
    } catch (e) { setMsg({ text: e.message, bad: true }); }
    setBusy(false);
  }
  return (
    <div>
      <p className="muted" style={{ fontSize: 13 }}>A contract puts an organisation on licence-based pricing and records its terms: the billing basis (never mixed), the price version it is protected on, its own rates, and any discount the Platform Owner has approved. Organisations without a contract stay on their current plan.</p>
      {msg.text && <p className={msg.bad ? "error" : "muted"} role="status">{msg.text}</p>}
      <button className="btn-primary-sm" onClick={() => setF(blank)}>+ New contract</button>
      <table className="table" style={{ width: "100%", marginTop: 10 }}>
        <thead><tr><th style={{ textAlign: "left" }}>Organisation</th><th style={{ textAlign: "left" }}>Basis</th><th style={{ textAlign: "left" }}>Pinned version</th><th style={{ textAlign: "left" }}>Own rates / discount</th><th /></tr></thead>
        <tbody>
          {data.contracts.map((c) => (
            <tr key={c.id}>
              <td>{c.id}</td><td>{c.billingBasis}</td><td>{c.pinnedVersion ? `v${data.books.find((b) => b.id === c.pinnedVersion)?.version ?? "?"}` : "follows current"}</td>
              <td className="muted" style={{ fontSize: 12 }}>{[c.baseFee != null && `base ${money(c.baseFee)}`, Object.keys(c.modePrices || {}).length && "mode rates", c.fixedDiscountPct != null && `${c.fixedDiscountPct}% fixed`, c.tierLock && `tier lock to ${c.tierLock.until}`].filter(Boolean).join(", ") || "published rates"}</td>
              <td><button className="btn-outline-dark" onClick={() => setF({ ...blank, ...c, orgId: c.id, baseFee: c.baseFee ?? "", minimumMonthlyFee: c.minimumMonthlyFee ?? "", faceGpsPrice: c.faceGpsPrice ?? "", fixedDiscountPct: c.fixedDiscountPct ?? "", approvedTiers: (c.approvedTiers || []).join(", ") })}>Edit</button></td>
            </tr>
          ))}
          {!data.contracts.length && <tr><td colSpan={5} className="muted">No contracts yet.</td></tr>}
        </tbody>
      </table>
      {f && (
        <div className="card" style={{ marginTop: 12 }}>
          <h4 style={{ marginTop: 0 }}>Contract</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
            <label style={{ fontSize: 12.5 }}>Organisation id<input className="input" value={f.orgId} onChange={(e) => setF({ ...f, orgId: e.target.value.trim() })} style={{ width: "100%" }} /></label>
            <label style={{ fontSize: 12.5 }}>Billing basis<select className="input" value={f.billingBasis} onChange={(e) => setF({ ...f, billingBasis: e.target.value })} style={{ width: "100%" }}><option value="assigned">Assigned licences (people actually on each mode)</option><option value="purchased">Purchased quantities</option></select></label>
            <label style={{ fontSize: 12.5 }}>Protected on version<select className="input" value={f.pinnedVersion} onChange={(e) => setF({ ...f, pinnedVersion: e.target.value })} style={{ width: "100%" }}><option value="">Follow the current version</option>{published.map((b) => <option key={b.id} value={b.id}>v{b.version} — {b.name}</option>)}</select></label>
            <label style={{ fontSize: 12.5 }}>Own organisation fee<input className="input" type="number" value={f.baseFee} onChange={(e) => setF({ ...f, baseFee: e.target.value })} style={{ width: "100%" }} /></label>
            <label style={{ fontSize: 12.5 }}>Own minimum monthly fee<input className="input" type="number" value={f.minimumMonthlyFee} onChange={(e) => setF({ ...f, minimumMonthlyFee: e.target.value })} style={{ width: "100%" }} /></label>
            {MODES.map((m) => <label key={m} style={{ fontSize: 12.5 }}>{MODE_LABEL[m]} own rate<input className="input" type="number" value={f.modePrices?.[m] ?? ""} onChange={(e) => setF({ ...f, modePrices: { ...f.modePrices, [m]: e.target.value } })} style={{ width: "100%" }} /></label>)}
            {f.billingBasis === "purchased" && MODES.map((m) => <label key={"p" + m} style={{ fontSize: 12.5 }}>{MODE_LABEL[m]} purchased<input className="input" type="number" min="0" value={f.purchased?.[m] ?? 0} onChange={(e) => setF({ ...f, purchased: { ...f.purchased, [m]: e.target.value } })} style={{ width: "100%" }} /></label>)}
          </div>
          <h4 style={{ margin: "12px 0 4px" }}>Discount approvals <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>(Platform Owner only — saved only if you are the Owner)</span></h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
            <label style={{ fontSize: 12.5 }}>Fixed discount % (replaces volume/annual)<input className="input" type="number" value={f.fixedDiscountPct} onChange={(e) => setF({ ...f, fixedDiscountPct: e.target.value })} style={{ width: "100%" }} /></label>
            <label style={{ fontSize: 12.5 }}>Approved tiers needing approval (e.g. 500)<input className="input" value={f.approvedTiers} onChange={(e) => setF({ ...f, approvedTiers: e.target.value })} style={{ width: "100%" }} /></label>
          </div>
          <h4 style={{ margin: "12px 0 4px" }}>Sales-assisted onboarding <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>(no payment is taken)</span></h4>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
            {MODES.map((m) => <label key={"o" + m} style={{ fontSize: 12 }}>{MODE_LABEL[m]} people<input className="input" type="number" min="0" value={ob[m]} onChange={(e) => setOb({ ...ob, [m]: Number(e.target.value) })} style={{ display: "block", width: 90 }} /></label>)}
            <label style={{ fontSize: 12 }}>Billing<select className="input" value={ob.cycle} onChange={(e) => setOb({ ...ob, cycle: e.target.value })} style={{ display: "block" }}><option value="month">Monthly</option><option value="year">Annual</option></select></label>
            <button className="btn-outline-dark" disabled={busy || !f.orgId} onClick={() => onboard("trial")}>Start a free trial</button>
            <button className="btn-outline-dark" disabled={busy || !f.orgId} onClick={() => confirm("Record an active, manually billed start? (Platform Owner only)") && onboard("contracted")}>Contracted start (Owner)</button>
          </div>
          <label style={{ fontSize: 12.5, display: "block", marginTop: 8 }}>Notes<input className="input" value={f.notes || ""} onChange={(e) => setF({ ...f, notes: e.target.value })} style={{ width: "100%" }} /></label>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="btn-primary-sm" disabled={busy || !f.orgId} onClick={save}>{busy ? "Saving…" : "Save contract"}</button>
            <button className="btn-outline-dark" onClick={() => setF(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- cost & margin -------------------------------------------------------------------------------------------------------------------
const COST_FIELDS = [["perGpsEvent", "Per GPS / location event (₹)"], ["perPhotoGb", "Photo storage per GB (₹)"], ["perFaceCheck", "Per face check (₹)"], ["perNotification", "Per notification (₹)"], ["perReport", "Per report (₹)"], ["paymentPct", "Payment processing (% of revenue)"], ["paymentFixed", "Payment fixed fee per organisation (₹)"], ["supportPerOrg", "Support per organisation / month (₹)"], ["infraPerOrg", "Infrastructure share per organisation / month (₹)"]];
function Margin({ data, reload }) {
  const [m, setM] = useState(data.costModel);
  const [rev, setRev] = useState(10000);
  const [usage, setUsage] = useState({ gpsEvents: 0, photoGb: 0, faceChecks: 0, notifications: 0, reports: 0 });
  const [orgs, setOrgs] = useState(1);
  const [msg, setMsg] = useState("");
  const r = marginFor({ revenueMonthly: rev, usage, orgs, costModel: m });
  async function save() { try { await api("POST", { action: "saveCostModel", ...m }); setMsg("Cost model saved."); await reload(); } catch (e) { setMsg(e.message); } }
  return (
    <div>
      <p className="muted" style={{ fontSize: 13 }}>Enter measured unit costs (from your Firebase, Vercel, storage, biometric-provider, notification and payment bills). Until costs are entered the calculator says so instead of showing a flattering margin. Don't treat any price as profitable before this is filled in from real usage.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
        {COST_FIELDS.map(([k, l]) => <label key={k} style={{ fontSize: 12.5 }}>{l}<input className="input" type="number" min="0" step="any" value={m[k] ?? 0} onChange={(e) => setM({ ...m, [k]: Number(e.target.value) })} style={{ width: "100%" }} /></label>)}
      </div>
      <p><button className="btn-primary-sm" onClick={save}>Save cost model</button> <span className="muted" style={{ fontSize: 12.5 }}>{msg}</span></p>
      <h4>Margin calculator</h4>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>Monthly revenue (₹)<input className="input" type="number" value={rev} onChange={(e) => setRev(Number(e.target.value))} style={{ display: "block", width: 120 }} /></label>
        <label style={{ fontSize: 12 }}>Organisations<input className="input" type="number" min="1" value={orgs} onChange={(e) => setOrgs(Number(e.target.value))} style={{ display: "block", width: 90 }} /></label>
        {Object.keys(usage).map((k) => <label key={k} style={{ fontSize: 12 }}>{k}<input className="input" type="number" min="0" value={usage[k]} onChange={(e) => setUsage({ ...usage, [k]: Number(e.target.value) })} style={{ display: "block", width: 100 }} /></label>)}
      </div>
      <p style={{ fontSize: 13.5 }}>Cost {money(r.cost)} · Margin {money(r.margin)}{r.marginPct !== null ? ` (${r.marginPct}%)` : " (unknown)"}</p>
      {r.flags.map((f) => <p key={f} className="error" style={{ fontSize: 13 }}>{f}</p>)}
    </div>
  );
}
