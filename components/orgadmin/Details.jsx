"use client";

// One organization's workspace: Overview, Users & Access, Subscription,
// Applications, Usage & Activity, Support, Audit & Lifecycle. It carries over
// every control that exists in Support / Customers (extend trial, mark paid,
// free licence, guest seats, reset link, set password, sign out, 2FA, add team
// member, suspend, delete user, activity, open-as-org), reusing the same
// server endpoints, so nothing is lost when that tab is later retired.
import { useEffect, useState } from "react";
import { APPS } from "@/lib/appCatalog";
import { api, orgCall, UsersTab, DetailsTab, plusDays, Field, useReason } from "./shared";
import OrgTickets from "../support/OrgTickets";
import AddUserWizard from "../admin/AddUserWizard";
import "../admin/admin.css";
import { auth } from "@/lib/firebase";
import AssignAdmin from "./AssignAdmin";
import Overview, { ACCOUNT, PAYMENT, PLAN, Fact } from "./Overview";
import { ONBOARDING_STATUS_LABEL } from "@/lib/orgContacts";

const TABS = [
  ["overview", "Overview"], ["users", "Users & Access"], ["subscription", "Subscription"], ["apps", "Applications"],
  ["usage", "Usage & Activity"], ["support", "Support"], ["audit", "Audit & Lifecycle"],
];


export default function Details({ id, onBack, onChanged, legacy, initialTab }) {
  const [tab, setTab] = useState(initialTab || "overview");
  const [d, setD] = useState(null);
  const [cust, setCust] = useState(undefined); // legacy customer row; null = none/no access
  const [err, setErr] = useState("");

  async function load() {
    try { setD(await api("/api/admin/org-directory?id=" + id, "GET")); setErr(""); } catch (e) { setErr(e.message); }
    try { setCust((await api("/api/admin/customers?row=" + id, "GET")).customer); } catch { setCust(null); }
  }
  useEffect(() => { setD(null); setCust(undefined); setTab(initialTab || "overview"); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = async () => { await load(); onChanged && onChanged(); };

  if (!d) return <div className="card"><button className="link-btn" onClick={onBack}>← Directory</button><p className={err ? "error" : "muted"}>{err || "Loading…"}</p></div>;

  const { row, status } = d;
  const can = (p) => d.permissions.includes(p);
  const isOwner = d.role === "OWNER";
  const managed = d.managed && can("organizations.manage");
  const o = { id, name: row.name, readOnly: !managed, ...row, managedNoAdmin: managed && !row.adminName && status.account === "pending_admin" };

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="link-btn" onClick={onBack}>← Directory</button>
        <span className="muted" style={{ fontSize: 12 }}>ID: <code>{id}</code></span>
      </div>
      <h2 style={{ margin: "6px 0 4px" }}>{row.name}</h2>
      <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>{[row.industry, row.country].filter(Boolean).join(" · ")}</p>
      <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>
        Registration method: <strong>{{ "admin-provisioned": "Admin-Registered", "self-service": "Self-Registered" }[row.kind] || "Unknown"}</strong>
        {" · "}Registered by: <strong>{row.registeredBy || (row.kind === "admin-provisioned" ? "Bizzux Platform Admin" : "Unknown")}</strong>
        {" · "}Registration date: <strong>{row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "Unknown"}</strong>
      </p>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <span className="status-pill">Organization: {ACCOUNT[status.account] || status.account}</span>
        <span className="status-pill">Onboarding: {ONBOARDING_STATUS_LABEL[d.ownership.onboardingStatus]}</span>
        <span className="status-pill">Subscription: {PLAN[status.plan.type] || status.plan.type || "No plan"} · {PAYMENT[status.payment]}</span>
        {status.trial.state !== "none" && <span className="status-pill">Trial {status.trial.state.replace("_", " ")}{status.trial.daysLeft != null ? ` (${status.trial.daysLeft}d)` : ""}</span>}
        {row.isTest && status.plan.type !== "TEST" && <span className="status-pill">Test</span>}
      </div>
      <div className="admin-tabs" role="tablist" style={{ marginBottom: 14 }}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={"admin-tab" + (tab === k ? " active" : "")} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {err && <p className="error">{err}</p>}

      {tab === "overview" && <Overview d={d} cust={cust} legacy={legacy} managed={managed} o={o} reload={reload} />}
      {tab === "users" && <UsersAccess d={d} o={o} cust={cust} legacy={legacy} reload={reload} isOwner={isOwner} canManage={can("organizations.manage")} />}
      {tab === "subscription" && <Subscription d={d} o={o} cust={cust} legacy={legacy} managed={managed} isOwner={isOwner} canSub={can("subscription.manage")} reload={reload} />}
      {tab === "apps" && <Applications d={d} o={o} legacy={legacy} managed={managed} reload={reload} />}
      {tab === "usage" && <Usage d={d} legacy={legacy} cust={cust} />}
      {tab === "support" && <SupportTab d={d} legacy={legacy} id={id} />}
      {tab === "audit" && <AuditLifecycle d={d} o={o} cust={cust} legacy={legacy} isOwner={isOwner} can={can} reload={reload} onBack={onBack} />}
    </div>
  );
}

function UsersAccess({ d, o, cust, legacy, reload, isOwner, canManage }) {
  const [admins, setAdmins] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(null);
  const [showSetPw, setShowSetPw] = useState(false);
  const { SetPasswordModal, timeAgo } = legacy;
  // Platform Admin adds people through the SAME wizard the company Admin Center uses, scoped to this company (one creation path, one ID standard).
  const [wizard, setWizard] = useState(false);
  const [directory, setDirectory] = useState(null);
  const openWizard = () => { setWizard(true); api("/api/iam/directory?organizationId=" + encodeURIComponent(o.id), "GET").then(setDirectory).catch(() => setDirectory({ users: [], enabledApps: [], unavailable: true })); };
  const uploadPhoto = async (uid, blob) => {
    const token = await auth.currentUser.getIdToken();
    const f = new FormData(); f.set("uid", uid); f.set("organizationId", o.id); f.set("photo", blob, "photo.jpg");
    const res = await fetch("/api/iam/photo", { method: "POST", headers: { Authorization: "Bearer " + token }, body: f });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "The photo could not be saved.");
    return d;
  };

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
      {o.managedNoAdmin && <AssignAdmin orgId={o.id} orgName={o.name} onDone={reload} />}
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
                {a.uid && canManage && (
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
          {cust && canManage && (
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
          {canManage && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
              <button type="button" className="btn-small" onClick={openWizard}>+ Add a user</button>
              <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>Same form as the company's Admin Center.</span>
              <AddUserWizard open={wizard} organizationId={o.id} api={api} uploadPhoto={uploadPhoto} directory={directory} canAssignAdmin
                onClose={() => setWizard(false)} onCreated={() => { loadAdmins(); reload(); }} />
            </div>
          )}
          {showSetPw && cust && <SetPasswordModal customer={cust} onClose={() => setShowSetPw(false)} />}
        </>
      )}
    </div>
  );
}

function Subscription({ d, o, cust, legacy, managed, isOwner, canSub, reload }) {
  const { ExtendTrialModal, MarkPaidModal, FreeLicenseModal, freeReasonLabel } = legacy;
  const [askReason, reasonModal] = useReason();
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
    const why = await askReason("End free license", "They'll get 7 days of trial to choose a paid plan.");
    if (!why) return;
    try { await api("/api/admin/customers", "POST", { action: "endFree", id: o.id, reason: why }); await reload(); } catch (e) { setErr(e.message); }
  }
  async function savePlan() {
    const why = await askReason("Change plan", `Plan ${planType}, ${seats} seats${["TEST", "INTERNAL"].includes(planType) ? "" : ", expiring " + expiry}.`);
    if (!why) return;
    setErr(""); setMsg("");
    try { await orgCall(o.id, "updateEntitlements", { planType, licensedSeats: seats, expiryDate: expiry, reason: why }); setMsg("Saved."); await reload(); } catch (e) { setErr(e.message); }
  }
  async function saveGuest() {
    const why = await askReason("Change guest seats", `Set to ${Number(guest)}.`);
    if (!why) return;
    try { await api("/api/admin/customers", "POST", { action: "setGuestSeats", id: o.id, guestSeats: Number(guest), reason: why }); setMsg("Guest seats saved."); await reload(); } catch (e) { setErr(e.message); }
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
      {reasonModal}
      {cust && canSub ? (
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {!isFree && <button className="btn-small" onClick={() => setModal("extend")}>Extend trial</button>}
          <button className="btn-small" onClick={() => setModal("paid")}>Mark as paid</button>
          {isOwner && <button className="btn-small" onClick={() => setModal("free")}>{isFree ? "Change free license" : "Give free license"}</button>}
          {isOwner && isFree && <button className="btn-small" onClick={endFree}>End free license</button>}
        </div>
      ) : <p className="muted" style={{ fontSize: 12 }}>{cust ? "You can view this subscription but not change it (Billing or Platform Admin permission required)." : "No billing record yet (this organization has no customer account), so trial and payment actions don't apply."}</p>}

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

      {cust && canSub && (
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
  const [askReason, reasonModal] = useReason();
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
    const why = await askReason("Change application access", removed.length ? `Removing ${removed.length} app(s) immediately blocks them for every user in this organization.` : "Adding applications for this organization.");
    if (!why) return;
    setErr(""); setMsg("");
    try { await orgCall(o.id, "updateEntitlements", { apps: sel, reason: why }); setMsg("Saved."); await reload(); } catch (e) { setErr(e.message); }
  }
  const usage = d.usage || {};
  return (
    <div>
      {reasonModal}
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

// Friendly names for the ownership / administration events (others show as stored).
const AUDIT_LABEL = {
  "organization.provision": "Organization created",
  "organization.admin_assigned": "Administrator assigned",
  "organization.primary_admin_reassigned": "Primary administrator replaced",
  "organization.business_owner_updated": "Business Owner contact updated",
  "organization.business_owner_verified": "Business Owner verified",
  "organization.authorization_changed": "Authorization status changed",
  "organization.ownership_transferred": "Ownership transferred",
  "organization.entitlements_set": "Subscription / applications changed",
  "organization.suspend": "Suspended", "organization.reactivate": "Reactivated", "organization.archive": "Archived",
};
const APP_LABEL = {
  business: "Business", pos: "POS", notes: "Notes", files: "Files", projects: "Projects", chat: "Chat",
  crm: "CRM", mail: "Mail", capture: "Capture", attendance: "Attendance", finance: "Finance",
};
const appEndpoint = (k) => (k === "business" ? "/api/shop-sso" : k === "pos" ? "/api/pos-sso" : "/api/app-sso?app=" + k);
const minsLeft = (iso) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000));

// Approved, scoped, time-limited support access. Replaces the old unrestricted
// "open as organization" buttons: nothing opens without a grant the Platform
// Owner approved (Owner requests are auto-approved but still scoped, timed and
// audited).
function SupportTab({ d, legacy, id }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [, tick] = useState(0);
  const [apps, setApps] = useState([]);
  const [minutes, setMinutes] = useState(30);
  const [reason, setReason] = useState("");
  const [shorter, setShorter] = useState({});

  async function load() {
    try { setData(await api("/api/admin/support-access?org=" + id, "GET")); setErr(""); } catch (e) { setErr(e.message); setData({ grants: [], denied: true }); }
  }
  useEffect(() => { load(); const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (action, extra, label) => {
    setBusy(label || action); setErr("");
    try { await api("/api/admin/support-access", "POST", { action, ...extra }); await load(); } catch (e) { setErr(e.message); }
    setBusy("");
  };
  async function openApp(g, key) {
    setBusy("open-" + key); setErr("");
    try {
      const ep = appEndpoint(key);
      const r = await api(`${ep}${ep.includes("?") ? "&" : "?"}asOrg=${id}&grant=${g.id}`, "GET");
      window.open(r.url, "_blank", "noopener,noreferrer");
      await load();
    } catch (e) { setErr(e.message); }
    setBusy("");
  }

  if (!data) return <p className="muted">{err || "Loading…"}</p>;
  if (data.denied) return <p className="muted" style={{ fontSize: 13 }}>{err || "Your role can't request support access."}</p>;

  const isOwner = data.isOwner;
  const live = data.grants.filter((g) => ["pending", "active"].includes(g.state));
  const past = data.grants.filter((g) => !["pending", "active"].includes(g.state)).slice(0, 8);

  return (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>Support access to this organization</div>
      <p className="muted" style={{ fontSize: 12, maxWidth: 620, marginBottom: 10 }}>
        Opening a customer's app needs an approved request: you choose the apps and how long, give a reason, and the Platform Owner approves it.
        Access ends automatically and every request, approval and open is in the audit trail. The app opens as the organization's owner, so anything you do there is real
        and it cannot be made read-only; the app's own session timeout governs the browser session once it is open.
      </p>
      {err && <p className="error">{err}</p>}

      {live.length === 0 && <p className="muted" style={{ fontSize: 12 }}>No open requests or active access.</p>}
      {live.map((g) => {
        return (
          <div key={g.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
              <strong>{g.requestedByEmail}</strong>
              <span className="status-pill">{g.state === "active" ? `Active · ${minsLeft(g.expiresAt)} min left` : "Waiting for Owner approval"}</span>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {g.apps.map((a) => APP_LABEL[a] || a).join(", ")} · {g.minutes} min · “{g.reason}”{g.autoApproved ? " · Owner request (auto-approved)" : ""}
            </div>
            <div className="row" style={{ gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              {g.state === "active" && g.requestedByUid === data.me && g.apps.map((a) => (
                <button key={a} className="btn-small" disabled={busy === "open-" + a} onClick={() => openApp(g, a)}>{busy === "open-" + a ? "Opening…" : "Open " + (APP_LABEL[a] || a)}</button>
              ))}
              {isOwner && g.state === "pending" && (
                <>
                  <select className="input" style={{ width: 120 }} value={shorter[g.id] || g.minutes} onChange={(e) => setShorter({ ...shorter, [g.id]: e.target.value })}>
                    {data.durations.filter((m) => m <= g.minutes).map((m) => <option key={m} value={m}>{m} min</option>)}
                  </select>
                  <button className="btn-primary" disabled={!!busy} onClick={() => act("approve", { grantId: g.id, minutes: shorter[g.id] || g.minutes }, "approve")}>Approve</button>
                  <button className="link-btn danger" disabled={!!busy} onClick={() => { const r = prompt("Reason for denying (optional):"); if (r !== null) act("deny", { grantId: g.id, reason: r }, "deny"); }}>Deny</button>
                </>
              )}
              {(isOwner || g.requestedByUid === data.me) && (
                <button className="link-btn" disabled={!!busy} onClick={() => { if (confirm("End this support access now?")) act("revoke", { grantId: g.id }, "revoke"); }}>
                  {g.state === "pending" ? "Withdraw" : "End access now"}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {live.every((g) => g.requestedByUid !== data.me) && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
          <div className="label" style={{ marginBottom: 6 }}>Request access</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginBottom: 8 }}>
            {data.apps.map((a) => (
              <label key={a} style={{ fontSize: 13 }}>
                <input type="checkbox" checked={apps.includes(a)} style={{ marginRight: 5 }} onChange={() => setApps(apps.includes(a) ? apps.filter((x) => x !== a) : [...apps, a])} />
                {APP_LABEL[a] || a}
              </label>
            ))}
          </div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label="Duration">
              <select className="input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {data.durations.map((m) => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </Field>
            <Field label="Reason * (recorded in the audit log)">
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer reported missing invoices (ticket 123)" />
            </Field>
          </div>
          <button className="btn-primary" disabled={!!busy || !apps.length || reason.trim().length < 3}
            onClick={async () => { await act("request", { organizationId: id, apps, minutes, reason: reason.trim() }, "request"); setApps([]); setReason(""); }}>
            {isOwner ? "Start access (auto-approved)" : "Request access"}
          </button>
        </div>
      )}

      {past.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="label" style={{ marginBottom: 4 }}>Recent</div>
          {past.map((g) => (
            <div key={g.id} className="muted" style={{ fontSize: 12, padding: "3px 0" }}>
              {g.requestedByEmail} · {g.apps.map((a) => APP_LABEL[a] || a).join(", ")} · {g.state}{g.useCount ? ` · opened ${g.useCount}×` : ""}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        <OrgTickets orgId={id} orgName={d.row.name} onOpenOrg={() => {}} />
      </div>
    </div>
  );
}

function AuditLifecycle({ d, o, cust, legacy, isOwner, can, reload, onBack }) {
  const [askReason, reasonModal] = useReason();
  const [entries, setEntries] = useState(null);
  const [err, setErr] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const { DeleteUserPanel } = legacy;
  async function loadAudit() {
    try { setEntries((await api("/api/admin/org-directory?id=" + o.id + "&section=audit", "GET")).entries); } catch (e) { setErr(e.message); setEntries([]); }
  }
  useEffect(() => { loadAudit(); }, [o.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const acct = d.status.account;
  async function act(action, extra, title, detail) {
    let reason;
    if (title) { reason = await askReason(title, detail); if (!reason) return; }
    setErr("");
    try { await orgCall(o.id, action, { ...extra, reason }); await reload(); await loadAudit(); } catch (e) { setErr(e.message); }
  }
  const [lcModal, setLcModal] = useState(null); // "archive" | "delete"
  const [pv, setPv] = useState(null);
  const [code, setCode] = useState("no_longer_required");
  const [text, setText] = useState("");
  const [typed, setTyped] = useState("");
  const [early, setEarly] = useState(false);
  const [busy, setBusy] = useState(false);
  async function openLifecycle(kind) {
    setErr(""); setPv(null); setTyped(""); setText(""); setEarly(false);
    setCode(kind === "delete" && d.row.isTest ? "testing_recreate" : "no_longer_required");
    setLcModal(kind);
    if (kind === "delete") { try { setPv(await orgCall(o.id, "previewDeletion", {})); } catch (e) { setErr(e.message); } }
  }
  async function submitLifecycle() {
    setBusy(true); setErr("");
    try {
      if (lcModal === "archive") {
        await orgCall(o.id, "archive", { reasonCode: code, reason: text });
        setLcModal(null); await reload(); await loadAudit();
      } else {
        const r = await orgCall(o.id, "deletePermanently", { confirmName: typed, reasonCode: code, reason: text, earlyPurge: early });
        if (r.ok === false) { setErr("Cleanup is NOT complete: " + (r.failed || []).join("; ") + ". The organization is blocked and nothing was reported as deleted. Retry to resume."); await reload(); await loadAudit(); }
        else { setLcModal(null); onBack(); }
      }
    } catch (e) { setErr(e.message + (e.blockers ? " — " + e.blockers.join("; ") : "")); if (e.code === "reauth_required") setErr(e.message + " (use Sign out, sign back in, then retry)"); }
    setBusy(false);
  }
  const REASONS = [["testing_recreate", "Testing / recreate"], ["no_longer_required", "No longer required"], ["duplicate", "Duplicate"], ["other", "Other"]];
  const lifecycleModal = lcModal && (
    <div className="modal-overlay" style={{ zIndex: 1200 }} onClick={() => !busy && setLcModal(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, width: "100%" }}>
        <h3 style={{ marginTop: 0 }}>{lcModal === "archive" ? "Archive " : "Permanently delete "}{o.name}</h3>
        {lcModal === "archive" && <p className="muted" style={{ fontSize: 13 }}>It is suspended and hidden. You can restore it for 30 days; after that it is removed automatically unless billing, legal hold or retention rules block it.</p>}
        {lcModal === "delete" && !pv && !err && <p className="muted">Checking impact…</p>}
        {lcModal === "delete" && pv && (
          <div style={{ fontSize: 13, marginBottom: 10 }}>
            <div><strong>{pv.environmentLabel}</strong> organization · status {pv.status}</div>
            <div>People removed with their logins: <strong>{pv.users.removed}</strong> · kept (belong to another organization or are staff): <strong>{pv.users.keptElsewhere}</strong></div>
            <div className="muted">Records: {Object.entries(pv.records).map(([k, v]) => `${v} ${k}`).join(", ")}{pv.hasBusinessData ? ", plus all app data for this business" : ""}</div>
            {pv.blockers.length > 0 && <p className="error">Blocked: {pv.blockers.join("; ")}</p>}
            {!pv.canDeleteNow && pv.blockers.length === 0 && pv.reasonIfNot && <p className="error">{pv.reasonIfNot}</p>}
            {pv.previousAttempt && <p className="error">An earlier attempt did not finish ({pv.previousAttempt.failed.join("; ") || "interrupted"}). Retrying resumes it.</p>}
            <p style={{ color: "var(--red)" }}>This cannot be undone.</p>
          </div>
        )}
        <label className="label">Reason *</label>
        <select className="input" value={code} onChange={(e) => setCode(e.target.value)}>{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {code === "other" && <input className="input" style={{ marginTop: 8 }} placeholder="Describe the reason" value={text} onChange={(e) => setText(e.target.value)} />}
        {lcModal === "delete" && (
          <>
            <label className="label" style={{ marginTop: 10 }}>Type the organization name to confirm</label>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={o.name} />
            {isOwner && !d.row.isTest && <label style={{ display: "block", fontSize: 12, marginTop: 8 }}><input type="checkbox" checked={early} onChange={(e) => setEarly(e.target.checked)} /> Owner only: skip the 30-day recovery window</label>}
          </>
        )}
        {err && <p className="error" role="alert">{err}</p>}
        <div className="row" style={{ justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
          <button type="button" className="btn-outline-dark" disabled={busy} onClick={() => setLcModal(null)}>Cancel</button>
          <button type="button" className="btn-primary" style={lcModal === "delete" ? { background: "var(--red)", borderColor: "var(--red)" } : undefined}
            disabled={busy || (code === "other" && text.trim().length < 3) || (lcModal === "delete" && (!pv || pv.blockers.length > 0 || typed.trim() !== o.name))}
            onClick={submitLifecycle}>{busy ? "Working…" : lcModal === "archive" ? "Archive" : "Delete organization"}</button>
        </div>
      </div>
    </div>
  );
  return (
    <div>
      {reasonModal}
      {lifecycleModal}
      {err && !lcModal && <p className="error">{err}</p>}
      <div style={{ padding: 14, border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 12, marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 4, color: "var(--red)" }}>Lifecycle</div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Suspend blocks every app right away and can be undone. Archive hides it from the directory (data kept). Delete organization removes it for good (archive it first, unless it is a test organization).</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {!d.row.internal && (
            ["suspended", "archived"].includes(acct)
              ? can("organizations.suspend") && <button className="btn-small" onClick={() => { if (confirm(`Reactivate ${o.name}?`)) act("reactivate", {}); }}>Reactivate</button>
              : can("organizations.suspend") && <button className="btn-small" style={{ borderColor: "#fca5a5", color: "var(--red)" }} onClick={() => act("suspend", {}, `Suspend ${o.name}`, "Its users are signed out and blocked until reactivated.")}>Suspend</button>
          )}
          {!d.row.internal && acct !== "archived" && d.row.kind !== "placeholder" && can("organizations.archive") &&
            <button className="btn-small" onClick={() => openLifecycle("archive")}>Archive</button>}
          {isOwner && cust && <button className="btn-small" style={{ background: "var(--red)", borderColor: "var(--red)", color: "#fff" }} onClick={() => setShowDelete(true)}>Close customer account…</button>}
          {(d.row.isTest ? can("organizations.delete_test") : isOwner) && (d.row.isTest || ["archived", "pending", "pending_admin", "deleting"].includes(d.row.status)) &&
            <button className="btn-small" style={{ borderColor: "#fca5a5", color: "var(--red)" }} onClick={() => openLifecycle("delete")}>{d.row.status === "deleting" ? "Retry delete" : "Delete organization"}</button>}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>Closing or recovering a customer account (60-day recovery) stays under Delete &amp; Recover.</p>
      </div>

      <div className="label" style={{ marginBottom: 6 }}>Audit trail for this organization</div>
      {entries === null && <p className="muted">Loading…</p>}
      {entries && entries.length === 0 && <p className="muted" style={{ fontSize: 12 }}>No audit entries yet.</p>}
      {entries && entries.map((e) => (
        <div key={e.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
          <strong>{AUDIT_LABEL[e.action] || e.action}</strong> <span className="muted">· {e.actorEmail || e.actorUid || "system"} · {e.createdAt ? new Date(e.createdAt).toLocaleString() : ""}</span>
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
