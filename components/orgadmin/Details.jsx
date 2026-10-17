"use client";

// One organization's workspace: Overview, Users & Access, Subscription,
// Applications, Usage & Activity, Support, Audit & Lifecycle. It carries over
// every control that exists in Support / Customers (extend trial, mark paid,
// free licence, guest seats, reset link, set password, sign out, 2FA, add team
// member, suspend, delete user, activity, open-as-org), reusing the same
// server endpoints, so nothing is lost when that tab is later retired.
import { useEffect, useState } from "react";
import { APPS } from "@/lib/appCatalog";
import { api, orgCall, UsersTab, DetailsTab, plusDays, Field } from "./shared";

const ACCOUNT = { active: "Active", suspended: "Suspended", expired: "Expired", archived: "Archived", pending_admin: "No administrator", closed: "Closed" };
const PAYMENT = { paid: "Paid", complimentary: "Free / complimentary", unpaid: "Not paid", not_recorded: "Payment not recorded", past_due: "Past due", cancelled: "Cancelled", none: "None" };
const ONBOARD = { onboarded: "Onboarded", not_onboarded: "Not onboarded", awaiting_first_login: "Awaiting first login", trial_not_started: "Trial not started", pending_verification: "Verifying", not_applicable: "—" };
const PLAN = { TRIAL: "Trial", PAID: "Paid", FREE: "Free licence", TEST: "Test", INTERNAL: "Internal" };
const TABS = [
  ["overview", "Overview"], ["users", "Users & Access"], ["subscription", "Subscription"], ["apps", "Applications"],
  ["usage", "Usage & Activity"], ["support", "Support"], ["audit", "Audit & Lifecycle"],
];

const Fact = ({ label, children }) => (
  <div style={{ minWidth: 150 }}>
    <div className="label">{label}</div>
    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{children || "—"}</div>
  </div>
);

export default function Details({ id, onBack, onChanged, legacy }) {
  const [tab, setTab] = useState("overview");
  const [d, setD] = useState(null);
  const [cust, setCust] = useState(undefined); // legacy customer row; null = none/no access
  const [err, setErr] = useState("");

  async function load() {
    try { setD(await api("/api/admin/org-directory?id=" + id, "GET")); setErr(""); } catch (e) { setErr(e.message); }
    try { setCust((await api("/api/admin/customers?row=" + id, "GET")).customer); } catch { setCust(null); }
  }
  useEffect(() => { setD(null); setCust(undefined); setTab("overview"); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = async () => { await load(); onChanged && onChanged(); };

  if (!d) return <div className="card"><button className="link-btn" onClick={onBack}>← Directory</button><p className={err ? "error" : "muted"}>{err || "Loading…"}</p></div>;

  const { row, status } = d;
  const can = (p) => d.permissions.includes(p);
  const isOwner = d.role === "OWNER";
  const managed = d.managed && can("organizations.manage");
  const o = { id, name: row.name, readOnly: !managed, ...row };

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="link-btn" onClick={onBack}>← Directory</button>
        <span className="muted" style={{ fontSize: 12 }}>ID: <code>{id}</code></span>
      </div>
      <h2 style={{ margin: "6px 0 4px" }}>{row.name}</h2>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <span className="status-pill">{ACCOUNT[status.account] || status.account}</span>
        <span className="status-pill">{PLAN[status.plan.type] || status.plan.type || "No plan"}</span>
        <span className="status-pill">{PAYMENT[status.payment]}</span>
        {status.trial.state !== "none" && <span className="status-pill">Trial {status.trial.state.replace("_", " ")}{status.trial.daysLeft != null ? ` (${status.trial.daysLeft}d)` : ""}</span>}
        <span className="status-pill">{ONBOARD[status.onboarding]}</span>
        {row.isTest && <span className="status-pill">Test</span>}
      </div>
      <div className="admin-tabs" role="tablist" style={{ marginBottom: 14 }}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={"admin-tab" + (tab === k ? " active" : "")} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {err && <p className="error">{err}</p>}

      {tab === "overview" && <Overview d={d} cust={cust} legacy={legacy} managed={managed} o={o} reload={reload} />}
      {tab === "users" && <UsersAccess d={d} o={o} cust={cust} legacy={legacy} reload={reload} isOwner={isOwner} />}
      {tab === "subscription" && <Subscription d={d} o={o} cust={cust} legacy={legacy} managed={managed} isOwner={isOwner} reload={reload} />}
      {tab === "apps" && <Applications d={d} o={o} legacy={legacy} managed={managed} reload={reload} />}
      {tab === "usage" && <Usage d={d} legacy={legacy} cust={cust} />}
      {tab === "support" && <SupportTab d={d} legacy={legacy} id={id} />}
      {tab === "audit" && <AuditLifecycle d={d} o={o} cust={cust} legacy={legacy} isOwner={isOwner} can={can} reload={reload} onBack={onBack} />}
    </div>
  );
}

function Overview({ d, cust, legacy, managed, o, reload }) {
  const { row, status } = d;
  const [editing, setEditing] = useState(false);
  return (
    <div>
      <div className="row" style={{ gap: 22, flexWrap: "wrap", marginBottom: 16 }}>
        <Fact label="Owner / administrator">{d.owner ? `${d.owner.name || d.owner.email}${d.owner.name && d.owner.email ? " · " + d.owner.email : ""}` : (row.adminName ? `${row.adminName}` : <span className="muted">No owner on record</span>)}</Fact>
        {row.adminUsername && <Fact label="Admin username">{row.adminUsername}</Fact>}
        <Fact label="Source">{{ "self-service": "Self-service", "admin-provisioned": "Admin-provisioned", placeholder: "Placeholder" }[row.kind]}</Fact>
        <Fact label="Industry">{row.industry}</Fact>
        <Fact label="Location">{[row.state, row.country].filter(Boolean).join(", ")}</Fact>
        <Fact label="Time zone · currency">{[row.timezone, row.currency].filter(Boolean).join(" · ")}</Fact>
        <Fact label="Created">{d.createdAt ? new Date(d.createdAt).toLocaleDateString() : ""}</Fact>
      </div>
      <div className="row" style={{ gap: 22, flexWrap: "wrap", marginBottom: 16 }}>
        <Fact label="Active users / seats">{row.activeUsers}{row.licensedSeats ? ` / ${row.licensedSeats}` : ""}</Fact>
        <Fact label="Plan">{PLAN[status.plan.type] || status.plan.type}{status.plan.name ? ` · ${status.plan.name}` : ""}</Fact>
        <Fact label="Payment">{PAYMENT[status.payment]}</Fact>
        <Fact label="Trial ends">{status.trial.state === "not_started" ? "Not started (phone not verified)" : status.trial.endsAt ? new Date(status.trial.endsAt).toLocaleDateString() : "N/A"}</Fact>
        <Fact label="Onboarding">{ONBOARD[status.onboarding]}</Fact>
        {cust && <Fact label="Last login">{legacy.timeAgo(cust.lastLoginAt)}</Fact>}
        {cust && <Fact label="Mobile">{cust.phone}</Fact>}
        {cust && <Fact label="Signed up from">{[cust.city, cust.region, cust.country].filter(Boolean).join(", ")}</Fact>}
        {cust && <Fact label="Customer type">{cust.customerType}</Fact>}
      </div>
      {d.onboarding && (
        <div className="row" style={{ gap: 22, flexWrap: "wrap", marginBottom: 16 }}>
          <Fact label="Job title">{d.onboarding.jobTitle}</Fact>
          <Fact label="Using it for">{d.onboarding.useCase}</Fact>
          <Fact label="Employees">{d.onboarding.employeeCount}</Fact>
          <Fact label="Business type">{d.onboarding.businessType}</Fact>
        </div>
      )}
      {managed
        ? (editing ? <DetailsTab o={o} reload={reload} /> : <button type="button" className="btn-small" onClick={() => setEditing(true)}>Edit organization details</button>)
        : <p className="muted" style={{ fontSize: 12 }}>Self-service organizations keep their own profile; you can see it here and manage status, subscription and sign-in help from the other tabs.</p>}
    </div>
  );
}

function UsersAccess({ d, o, cust, legacy, reload, isOwner }) {
  const [admins, setAdmins] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(null);
  const [showSetPw, setShowSetPw] = useState(false);
  const { AddTeamMemberForm, SetPasswordModal, timeAgo } = legacy;

  async function loadAdmins() {
    try { setAdmins((await api("/api/admin/customers?id=" + o.id, "GET")).admins || []); setErr(""); }
    catch (e) { setErr(e.message); setAdmins([]); }
  }
  useEffect(() => { if (d.hasCustomerRecord) loadAdmins(); else setAdmins([]); }, [o.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function signOut(uid) {
    if (!confirm("Sign this person out of every device right now?")) return;
    setBusy(uid);
    try { await api("/api/admin/customers", "POST", { action: "revokeSessions", uid }); } catch (e) { setErr(e.message); }
    setBusy(null);
  }
  async function toggle2fa(uid, required) {
    setBusy(uid);
    try { await api("/api/admin/two-factor", "POST", { uid, required }); await loadAdmins(); } catch (e) { setErr(e.message); }
    setBusy(null);
  }
  async function resetLink() {
    if (!cust || !confirm(`Email a password reset link to ${cust.email}?`)) return;
    try { await api("/api/admin/customers", "POST", { action: "resetPassword", id: o.id }); alert("Reset email sent."); } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <UsersTab o={o} reload={reload} />
      {d.hasCustomerRecord && (
        <>
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
            <div className="label" style={{ marginBottom: 6 }}>Administrators &amp; sign-in status</div>
            {err && <p className="error">{err}</p>}
            {admins === null && <p className="muted">Loading…</p>}
            {admins && admins.map((a, i) => (
              <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13.5 }}>{a.email}</span><span className="status-pill active">{a.role}</span>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>Last login: {timeAgo(a.lastLoginAt)} · 2FA: {a.twoFactorEnabled ? "on" : "off"}</div>
                {a.uid && (
                  <div className="row" style={{ gap: 14, marginTop: 4, flexWrap: "wrap" }}>
                    <button className="link-btn" disabled={busy === a.uid} onClick={() => signOut(a.uid)}>Sign out of all devices</button>
                    <label className="muted" style={{ fontSize: 12 }}>
                      <input type="checkbox" checked={!!a.twoFactorRequired} disabled={busy === a.uid} onChange={(e) => toggle2fa(a.uid, e.target.checked)} style={{ marginRight: 6 }} />
                      Require 2FA
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
          {cust && (
            <div style={{ marginTop: 16 }}>
              <div className="label" style={{ marginBottom: 6 }}>Owner sign-in &amp; security</div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn-small" onClick={resetLink}>Email a reset link</button>
                <button className="btn-small" onClick={() => setShowSetPw(true)}>Set new password</button>
                <button className="btn-small" disabled={busy === o.id} onClick={() => signOut(o.id)}>Sign out everywhere</button>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>For username logins use the user's Reset password above; these act on the owner's own account.</p>
            </div>
          )}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
            <AddTeamMemberForm accountId={o.id} onDone={() => { loadAdmins(); reload(); }} />
          </div>
          {showSetPw && cust && <SetPasswordModal customer={cust} onClose={() => setShowSetPw(false)} />}
        </>
      )}
    </div>
  );
}

function Subscription({ d, o, cust, legacy, managed, isOwner, reload }) {
  const { ExtendTrialModal, MarkPaidModal, FreeLicenseModal, freeReasonLabel } = legacy;
  const [modal, setModal] = useState(null);
  const [planType, setPlanType] = useState(d.row.planType || "TRIAL");
  const [seats, setSeats] = useState(d.row.licensedSeats || 1);
  const [expiry, setExpiry] = useState(d.row.expiresAt ? d.row.expiresAt.slice(0, 10) : plusDays(30));
  const [guest, setGuest] = useState(cust?.guestSeats || 0);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const isFree = cust?.billing === "complimentary";
  const { status } = d;
  useEffect(() => { setGuest(cust?.guestSeats || 0); }, [cust?.guestSeats]);

  async function endFree() {
    if (!confirm("End this free license? They'll get 7 days of trial to choose a paid plan.")) return;
    try { await api("/api/admin/customers", "POST", { action: "endFree", id: o.id }); await reload(); } catch (e) { setErr(e.message); }
  }
  async function savePlan() {
    if (!confirm(`Change the plan to ${planType}, ${seats} seats${["TEST", "INTERNAL"].includes(planType) ? "" : ", expiring " + expiry}? This is recorded in the audit log.`)) return;
    setErr(""); setMsg("");
    try { await orgCall(o.id, "updateEntitlements", { planType, licensedSeats: seats, expiryDate: expiry }); setMsg("Saved."); await reload(); } catch (e) { setErr(e.message); }
  }
  async function saveGuest() {
    try { await api("/api/admin/customers", "POST", { action: "setGuestSeats", id: o.id, guestSeats: Number(guest) }); setMsg("Guest seats saved."); await reload(); } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      {err && <p className="error">{err}</p>}
      <div className="row" style={{ gap: 22, flexWrap: "wrap", marginBottom: 14 }}>
        <Fact label="Plan">{PLAN[status.plan.type] || status.plan.type}{status.plan.name ? ` · ${status.plan.name}` : ""}</Fact>
        <Fact label="Payment">{PAYMENT[status.payment]}</Fact>
        <Fact label="Trial">{status.trial.state === "none" ? "—" : status.trial.state.replace("_", " ") + (status.trial.endsAt ? " · ends " + new Date(status.trial.endsAt).toLocaleDateString() : "")}</Fact>
        <Fact label="Account">{ACCOUNT[status.account]}</Fact>
        {cust?.subscription && (
          <Fact label="Locked-in price">
            {cust.subscription.quantity} user{cust.subscription.quantity === 1 ? "" : "s"} × ₹{Number(cust.subscription.unitPrice).toLocaleString("en-IN")} / {cust.subscription.billingCycle === "year" ? "yr" : "mo"}
            {cust.subscription.couponCode ? ` · code ${cust.subscription.couponCode}` : ""}
          </Fact>
        )}
      </div>
      {isFree && cust && (
        <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 10, padding: 10, fontSize: 13, marginBottom: 10 }}>
          <strong>Free license</strong> · {cust.planName || "plan"} · {freeReasonLabel(cust.compReason)} · {cust.compUntil ? "until " + new Date(cust.compUntil).toLocaleDateString() : "no end date"}
          {cust.compNote && <div className="muted" style={{ marginTop: 4 }}>{cust.compNote}</div>}
        </div>
      )}
      {cust ? (
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {!isFree && <button className="btn-small" onClick={() => setModal("extend")}>Extend trial</button>}
          <button className="btn-small" onClick={() => setModal("paid")}>Mark as paid</button>
          {isOwner && <button className="btn-small" onClick={() => setModal("free")}>{isFree ? "Change free license" : "Give free license"}</button>}
          {isOwner && isFree && <button className="btn-small" onClick={endFree}>End free license</button>}
        </div>
      ) : <p className="muted" style={{ fontSize: 12 }}>No billing record yet (this organization has no customer account), so trial and payment actions don't apply.</p>}

      {managed && (
        <div style={{ paddingTop: 12, borderTop: "1px solid var(--line)", marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Plan, seats and expiry (admin-provisioned)</div>
          <div className="row">
            <Field label="Plan">
              <select className="input" value={planType} onChange={(e) => setPlanType(e.target.value)}>
                {d.row.planType === "INTERNAL" ? <option value="INTERNAL">Internal</option> : <><option value="TRIAL">Trial</option><option value="PAID">Paid</option><option value="TEST">Test</option></>}
              </select>
            </Field>
            <Field label="Licensed Seats"><input className="input" type="number" min="1" value={seats} onChange={(e) => setSeats(e.target.value)} /></Field>
            {!["TEST", "INTERNAL"].includes(planType) && <Field label="Expiry"><input className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>}
          </div>
          <button type="button" className="btn-primary" onClick={savePlan}>Save plan</button>
          {msg && <span className="muted" style={{ marginLeft: 10 }}>{msg}</span>}
        </div>
      )}

      {cust && (
        <div style={{ paddingTop: 12, borderTop: "1px solid var(--line)" }}>
          <div className="label" style={{ marginBottom: 6 }}>Bizzux Projects guest seats</div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 8, maxWidth: 460 }}>How many outside collaborators this organization may have across all its projects (0 by default).</p>
          <div className="row" style={{ gap: 8 }}>
            <input type="number" min="0" step="1" className="input" style={{ width: 90 }} value={guest} onChange={(e) => setGuest(e.target.value)} />
            <button className="btn-small" onClick={saveGuest}>Save</button>
          </div>
        </div>
      )}

      {modal === "extend" && cust && <ExtendTrialModal customer={cust} onClose={() => setModal(null)} onExtended={async () => { setModal(null); await reload(); }} />}
      {modal === "paid" && cust && <MarkPaidModal customer={cust} onClose={() => setModal(null)} onMarked={async () => { setModal(null); await reload(); }} />}
      {modal === "free" && cust && <FreeLicenseModal customer={cust} onClose={() => setModal(null)} onDone={async () => { setModal(null); await reload(); }} />}
    </div>
  );
}

function Applications({ d, o, legacy, managed, reload }) {
  const [apps, setApps] = useState(null);
  const [sel, setSel] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api("/api/admin/org-directory?id=" + o.id + "&section=apps", "GET")
      .then((r) => { setApps(r.apps); setSel(r.apps.filter((a) => a.enabled).map((a) => a.id)); })
      .catch((e) => setErr(e.message));
  }, [o.id]);
  async function save() {
    const was = apps.filter((a) => a.enabled).map((a) => a.id);
    const removed = was.filter((a) => !sel.includes(a));
    if (!confirm(`Save application access?${removed.length ? "\n\nRemoving " + removed.length + " app(s) immediately blocks them for every user." : ""}\nThis is recorded in the audit log.`)) return;
    setErr(""); setMsg("");
    try { await orgCall(o.id, "updateEntitlements", { apps: sel }); setMsg("Saved."); await reload(); } catch (e) { setErr(e.message); }
  }
  const usage = d.usage || {};
  return (
    <div>
      {err && <p className="error">{err}</p>}
      {!apps && !err && <p className="muted">Loading…</p>}
      {apps && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginBottom: 10 }}>
          {apps.map((a) => (
            <label key={a.id} style={{ fontSize: 13 }}>
              <input type="checkbox" checked={sel.includes(a.id)} disabled={!managed}
                onChange={() => setSel(sel.includes(a.id) ? sel.filter((x) => x !== a.id) : [...sel, a.id])} style={{ marginRight: 5 }} />
              {a.name}{!a.known ? <span className="muted"> (not recorded)</span> : null}
            </label>
          ))}
        </div>
      )}
      {managed
        ? <><button className="btn-primary" disabled={!sel.length} onClick={save}>Save application access</button>{msg && <span className="muted" style={{ marginLeft: 10 }}>{msg}</span>}</>
        : <p className="muted" style={{ fontSize: 12 }}>Self-service organizations manage their own applications; this is a read-only view of what they have.</p>}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        <div className="label" style={{ marginBottom: 6 }}>Apps used (last opened)</div>
        {Object.keys(usage).length === 0 && <span className="muted" style={{ fontSize: 12 }}>Not used yet</span>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {Object.entries(usage).map(([k, v]) => (
            <span key={k} className="status-pill active" style={{ fontSize: 11 }} title={v || ""}>{legacy.APP_USAGE_LABELS[k] || k}{v ? " · " + legacy.timeAgo(v) : ""}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Usage({ d, legacy, cust }) {
  const [act, setAct] = useState(null);
  const [err, setErr] = useState("");
  const { ActivityRow, timeAgo } = legacy;
  useEffect(() => {
    api("/api/admin/customer-activity?id=" + d.row.id, "GET").then(setAct).catch(() => setErr("Couldn't load Bizzux Business activity right now. Try again in a few minutes."));
  }, [d.row.id]);
  return (
    <div>
      <div className="row" style={{ gap: 22, flexWrap: "wrap", marginBottom: 14 }}>
        <Fact label="Active users">{d.row.activeUsers}</Fact>
        <Fact label="Licensed seats">{d.row.licensedSeats}</Fact>
        {cust && <Fact label="Last login">{timeAgo(cust.lastLoginAt)}</Fact>}
        {cust && <Fact label="Customer for">{cust.createdAt ? timeAgo(cust.createdAt) : "N/A"}</Fact>}
        <Fact label="Apps opened">{Object.keys(d.usage || {}).length}</Fact>
      </div>
      <div className="label" style={{ marginBottom: 6 }}>Bizzux Business activity</div>
      {err && <p className="error">{err}</p>}
      {!act && !err && <p className="muted">Loading…</p>}
      {act && (
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>Usage only — sales/purchase/expense amounts are never shown here.</p>
          <ActivityRow label="🧾 Sales" data={act.sales} />
          <ActivityRow label="🛒 Purchases" data={act.purchases} />
          <ActivityRow label="🧺 Expenses" data={act.expenses} />
          <div className="row" style={{ marginTop: 12, gap: 6, flexWrap: "wrap" }}>
            {[["Menu", act.usesMenu], ["Inventory", act.usesInventory], ["Reservations", act.usesReservations], ["CapEx", act.usesCapex]].map(([label, used]) => (
              <span key={label} className={"status-pill " + (used ? "active" : "")} style={!used ? { opacity: 0.5 } : undefined}>{used ? "✓" : "—"} {label}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SupportTab({ d, legacy, id }) {
  const [opening, setOpening] = useState(null);
  const [err, setErr] = useState("");
  async function openAsOrg(label, endpoint) {
    setOpening(label); setErr("");
    try {
      const sep = endpoint.includes("?") ? "&" : "?";
      const r = await api(`${endpoint}${sep}asOrg=${id}`, "GET");
      window.open(r.url, "_blank", "noopener,noreferrer");
    } catch (e) { setErr(e.message); } finally { setOpening(null); }
  }
  return (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>Open apps as this organization</div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 8, maxWidth: 520 }}>
        Opens the app exactly as the organization's owner sees it, for troubleshooting. Every open is recorded in the Audit Logs.
        This is being replaced by approved, time-limited support access (Platform Owner approval) in a later release.
      </p>
      {err && <p className="error">{err}</p>}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {[["Business", "/api/shop-sso"], ["POS", "/api/pos-sso"], ["Notes", "/api/app-sso?app=notes"], ["Files", "/api/app-sso?app=files"], ["Projects", "/api/app-sso?app=projects"], ["Chat", "/api/app-sso?app=chat"]].map(([label, ep]) => (
          <button key={label} className="btn-small" disabled={opening === label} onClick={() => openAsOrg(label, ep)}>{opening === label ? "Opening…" : label}</button>
        ))}
      </div>
      <div className="label" style={{ marginBottom: 6 }}>Tickets &amp; follow-ups</div>
      <p className="muted" style={{ fontSize: 12 }}>
        The Customer Support workspace (tickets, troubleshooting notes, follow-ups) is coming and will be linked to this organization ID: <code>{id}</code>.
      </p>
    </div>
  );
}

function AuditLifecycle({ d, o, cust, legacy, isOwner, can, reload, onBack }) {
  const [entries, setEntries] = useState(null);
  const [err, setErr] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const { DeleteUserPanel } = legacy;
  async function loadAudit() {
    try { setEntries((await api("/api/admin/org-directory?id=" + o.id + "&section=audit", "GET")).entries); } catch (e) { setErr(e.message); setEntries([]); }
  }
  useEffect(() => { loadAudit(); }, [o.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const acct = d.status.account;
  async function act(action, extra, text) {
    if (text && !confirm(text)) return;
    setErr("");
    try { await orgCall(o.id, action, extra); await reload(); await loadAudit(); } catch (e) { setErr(e.message); }
  }
  async function removeForever() {
    const extra = d.row.isTest ? " This is a TEST organization: its users and all their data are deleted too." : "";
    const typed = prompt(`Permanently delete "${o.name}"?${extra} This cannot be undone. Type the organization name to confirm:`);
    if (typed === null) return;
    setErr("");
    try { await orgCall(o.id, "deletePermanently", { confirmName: typed }); onBack(); } catch (e) { setErr(e.message); }
  }
  return (
    <div>
      {err && <p className="error">{err}</p>}
      <div style={{ padding: 14, border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 12, marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 4, color: "var(--red)" }}>Lifecycle</div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Suspend blocks every app right away and can be undone. Archive hides it from the directory (data kept). Deleting removes it for good.</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {!d.row.internal && (
            ["suspended", "archived"].includes(acct)
              ? can("organizations.suspend") && <button className="btn-small" onClick={() => act("reactivate", {}, `Reactivate ${o.name}?`)}>Reactivate</button>
              : can("organizations.suspend") && <button className="btn-small" style={{ borderColor: "#fca5a5", color: "var(--red)" }} onClick={() => act("suspend", {}, `Suspend ${o.name}? Its users are signed out and blocked until reactivated.`)}>Suspend</button>
          )}
          {!d.row.internal && acct !== "archived" && d.row.kind !== "placeholder" && can("organizations.archive") &&
            <button className="btn-small" onClick={() => act("archive", {}, `Archive ${o.name}? It is suspended and hidden from the directory; data is kept.`)}>Archive</button>}
          {isOwner && cust && <button className="btn-small" style={{ background: "var(--red)", borderColor: "var(--red)", color: "#fff" }} onClick={() => setShowDelete(true)}>Delete user…</button>}
          {(d.row.isTest ? can("organizations.delete_test") : isOwner) && (d.row.isTest || ["archived", "pending", "pending_admin"].includes(d.row.status)) &&
            <button className="btn-small" style={{ borderColor: "#fca5a5", color: "var(--red)" }} onClick={removeForever}>Delete permanently</button>}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>Closing or recovering a customer account (60-day recovery) stays under Delete &amp; Recover.</p>
      </div>

      <div className="label" style={{ marginBottom: 6 }}>Audit trail for this organization</div>
      {entries === null && <p className="muted">Loading…</p>}
      {entries && entries.length === 0 && <p className="muted" style={{ fontSize: 12 }}>No audit entries yet.</p>}
      {entries && entries.map((e) => (
        <div key={e.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
          <strong>{e.action}</strong> <span className="muted">· {e.actorEmail || e.actorUid || "system"} · {e.createdAt ? new Date(e.createdAt).toLocaleString() : ""}</span>
          {e.details && Object.keys(e.details).length > 0 && <div className="muted" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{JSON.stringify(e.details).slice(0, 240)}</div>}
        </div>
      ))}

      {showDelete && cust && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => setShowDelete(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, width: "100%" }}>
            <DeleteUserPanel initialEmail={cust.email} onDeleted={() => { setShowDelete(false); onBack(); }} />
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="btn-outline-dark" onClick={() => setShowDelete(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
