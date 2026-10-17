"use client";

// Organizations directory: server-side search, filters, sort and cursor
// pagination (/api/admin/org-directory). The page never downloads the whole
// customer base; it fetches one page at a time from the search index.
import { useEffect, useRef, useState } from "react";
import { api } from "./shared";

const ACCOUNT = { active: "Active", suspended: "Suspended", expired: "Expired", archived: "Archived", pending_admin: "No administrator", closed: "Closed" };
const PAYMENT = { paid: "Paid", complimentary: "Free / complimentary", unpaid: "Not paid", not_recorded: "Payment not recorded", past_due: "Past due", cancelled: "Cancelled", none: "—" };
const TRIAL = { active: "Trial running", expired: "Trial ended", not_started: "Trial not started", none: "" };
const ONBOARD = { onboarded: "Onboarded", not_onboarded: "Not onboarded", awaiting_first_login: "Awaiting first login", trial_not_started: "Trial not started", pending_verification: "Verifying", not_applicable: "—" };
const KIND = { "self-service": "Self-service", "admin-provisioned": "Admin-provisioned", placeholder: "Placeholder" };
const PLAN = { TRIAL: "Trial", PAID: "Paid", FREE: "Free licence", TEST: "Test", INTERNAL: "Internal", NONE: "—" };
const PAGE = 25;

export default function Directory({ onOpen, onCreate, canCreate, canReindex, isOwner }) {
  const [queue, setQueue] = useState([]);
  useEffect(() => {
    if (!isOwner) return;
    api("/api/admin/support-access?pending=1", "GET").then((r) => setQueue(r.grants || [])).catch(() => {});
  }, [isOwner]);
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [kind, setKind] = useState("");
  const [planType, setPlanType] = useState("");
  const [sort, setSort] = useState("created:desc");
  const [hideArchived, setHideArchived] = useState(true);
  const [rows, setRows] = useState(null);
  const [cursors, setCursors] = useState([null]); // cursor used to load each page
  const [page, setPage] = useState(0);
  const [next, setNext] = useState(null);
  const [err, setErr] = useState("");
  const [reindexMsg, setReindexMsg] = useState("");
  const seq = useRef(0);

  // Debounce typing so each keystroke isn't a request.
  useEffect(() => { const t = setTimeout(() => setApplied(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  async function load(cursor, pageIndex) {
    const mine = ++seq.current;
    const [s, dir] = sort.split(":");
    const params = new URLSearchParams({ q: applied, sort: s, dir, limit: String(PAGE) });
    if (accountStatus) params.set("accountStatus", accountStatus);
    if (kind) params.set("kind", kind);
    if (planType) params.set("planType", planType);
    if (!hideArchived) params.set("hideArchived", "0");
    if (cursor) params.set("cursor", cursor);
    try {
      const d = await api("/api/admin/org-directory?" + params.toString(), "GET");
      if (mine !== seq.current) return; // a newer request superseded this one
      setRows(d.rows); setNext(d.nextCursor); setPage(pageIndex); setErr("");
    } catch (e) {
      if (mine !== seq.current) return;
      setErr(e.message); setRows((r) => r || []);
    }
  }

  // Any change to the search or filters starts again from page 1.
  useEffect(() => { setCursors([null]); load(null, 0); }, [applied, accountStatus, kind, planType, sort, hideArchived]); // eslint-disable-line react-hooks/exhaustive-deps

  function goNext() {
    if (!next) return;
    const stack = [...cursors.slice(0, page + 1), next];
    setCursors(stack); load(next, page + 1);
  }
  function goPrev() { if (page > 0) load(cursors[page - 1], page - 1); }

  async function reindex() {
    if (!confirm("Rebuild the search index from the real records? It reads about 3-4 documents and writes 1 per organization.")) return;
    setReindexMsg("Rebuilding…");
    let after = null, totals = { processed: 0, writes: 0, reads: 0 };
    try {
      do {
        const d = await api("/api/admin/org-directory", "POST", { action: "reindex", after });
        totals = { processed: totals.processed + d.processed, writes: totals.writes + d.writes, reads: totals.reads + d.reads };
        after = d.next;
        setReindexMsg(`Rebuilding… ${totals.processed} so far`);
      } while (after);
      setReindexMsg(`Index rebuilt: ${totals.processed} organizations, about ${totals.reads} reads and ${totals.writes} writes.`);
      load(null, 0);
    } catch (e) {
      setReindexMsg("Rebuild failed: " + e.message);
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Organizations</h3>
        <div className="row" style={{ gap: 12 }}>
          {canReindex && <button type="button" className="link-btn" onClick={reindex}>Rebuild search index</button>}
          {canCreate && <button type="button" className="btn-primary" onClick={onCreate}>+ Create organization</button>}
        </div>
      </div>
      {reindexMsg && <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>{reindexMsg}</p>}
      {queue.length > 0 && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 13 }}>
          <strong>{queue.length} support access request{queue.length === 1 ? "" : "s"} awaiting your approval</strong>
          {queue.map((g) => (
            <div key={g.id}>
              <button type="button" className="link-btn" onClick={() => onOpen(g.organizationId, "support")}>{g.organizationName || g.organizationId}</button>
              <span className="muted"> — {g.requestedByEmail}: {g.reason}</span>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <input className="input" style={{ width: 280 }} placeholder="Search name, owner, email, mobile, username, ID" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: 160 }} value={accountStatus} onChange={(e) => setAccountStatus(e.target.value)}>
          <option value="">All account status</option>
          {Object.entries(ACCOUNT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" style={{ width: 160 }} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All sources</option>
          {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" style={{ width: 150 }} value={planType} onChange={(e) => setPlanType(e.target.value)}>
          <option value="">All plans</option>
          {["TRIAL", "PAID", "FREE", "TEST", "INTERNAL"].map((k) => <option key={k} value={k}>{PLAN[k]}</option>)}
        </select>
        <select className="input" style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="created:desc">Newest first</option>
          <option value="created:asc">Oldest first</option>
          <option value="name:asc">Name A–Z</option>
          <option value="name:desc">Name Z–A</option>
        </select>
        <label className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
          <input type="checkbox" checked={hideArchived} onChange={(e) => setHideArchived(e.target.checked)} style={{ marginRight: 5 }} />
          Hide archived
        </label>
      </div>

      {err && <p className="error">{err}</p>}
      {rows === null && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && !err && <p className="muted">No organizations match.</p>}
      {rows && rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                <th>Organization</th><th>Owner / administrator</th><th>Plan</th><th>Payment</th><th>Account</th><th>Onboarding</th><th>Location</th><th>Signed up</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--line)", verticalAlign: "top", cursor: "pointer" }} onClick={() => onOpen(r.id)}>
                  <td style={{ padding: "8px 8px 8px 0" }}>
                    <button type="button" className="link-btn" style={{ textAlign: "left", fontWeight: 700 }} onClick={(e) => { e.stopPropagation(); onOpen(r.id); }}>{r.name}</button>
                    <div className="muted" style={{ fontSize: 12 }}>{[KIND[r.kind], r.industry, r.customerType !== "Trial" ? r.customerType : ""].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td>
                    {r.hasOwner || r.ownerName
                      ? <>{r.ownerName || r.ownerEmail}<div className="muted" style={{ fontSize: 12 }}>{[r.ownerEmail && r.ownerName ? r.ownerEmail : "", r.adminUsername ? "@" + r.adminUsername : "", r.phone].filter(Boolean).join(" · ")}</div></>
                      : <span className="muted">No owner on record</span>}
                  </td>
                  <td>{PLAN[r.planType] || r.planType}{r.licensedSeats ? <div className="muted" style={{ fontSize: 12 }}>{r.licensedSeats} seats</div> : null}</td>
                  <td>{PAYMENT[r.payment] || r.payment}{TRIAL[r.trialState] ? <div className="muted" style={{ fontSize: 12 }}>{r.planType === "PAID" && r.trialState === "active" ? "Access until" : r.planType === "PAID" && r.trialState === "expired" ? "Access ended" : TRIAL[r.trialState]}{r.trialEndsAt ? " · " + r.trialEndsAt.slice(0, 10) : ""}</div> : null}</td>
                  <td>{ACCOUNT[r.accountStatus] || r.accountStatus}{r.isTest ? <div className="muted" style={{ fontSize: 12 }}>Test</div> : null}</td>
                  <td>{ONBOARD[r.onboarding] || r.onboarding}</td>
                  <td>{[r.city, r.region].filter(Boolean).join(", ")}<div className="muted" style={{ fontSize: 12 }}>{r.country}</div></td>
                  <td>{r.createdAtMs ? new Date(r.createdAtMs).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row" style={{ gap: 12, marginTop: 12, alignItems: "center" }}>
        <button type="button" className="link-btn" disabled={page === 0} onClick={goPrev}>← Previous</button>
        <span className="muted" style={{ fontSize: 12 }}>Page {page + 1}</span>
        <button type="button" className="link-btn" disabled={!next} onClick={goNext}>Next →</button>
      </div>
    </div>
  );
}
