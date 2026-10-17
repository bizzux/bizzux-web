"use client";

// Organization Overview, split into clearly labelled sections so that who OWNS
// the business, who REQUESTED the account, who ADMINISTERS it, how it was
// ONBOARDED and what it PAYS are never mixed together:
//   A header (in Details.jsx)   B metrics   C ownership & administration
//   D profile                   E provisioning   F commercial summary
// Every change here goes through a server action that checks its own
// permission and writes an audit entry; hiding a button is only a convenience.
import { useState } from "react";
import {
  OWNER_STATUS_LABEL, AUTH_STATUS, AUTH_STATUS_LABEL, ADMIN_STATUS_LABEL, REQUESTER_LABEL,
  ONBOARDING_METHOD_LABEL, ONBOARDING_STATUS_LABEL,
} from "@/lib/orgContacts";
import { orgCall, DetailsTab, Field, useReason } from "./shared";

export const ACCOUNT = { active: "Enabled", suspended: "Suspended", expired: "Expired", archived: "Archived", pending_admin: "Pending (no administrator)", closed: "Closed" };
export const PAYMENT = { paid: "Paid", complimentary: "Free / complimentary", unpaid: "Not paid", not_recorded: "Payment not recorded", past_due: "Past due", cancelled: "Cancelled", none: "None" };
export const PLAN = { TRIAL: "Trial", PAID: "Paid", FREE: "Complimentary", TEST: "Test", INTERNAL: "Internal" };

export const Fact = ({ label, children }) => (
  <div style={{ minWidth: 150 }}>
    <div className="label">{label}</div>
    <div style={{ fontWeight: 600, fontSize: 13.5, overflowWrap: "anywhere" }}>{children || "—"}</div>
  </div>
);

const Card = ({ title, hint, children, style }) => (
  <section style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", marginBottom: 14, ...style }}>
    <h4 style={{ margin: "0 0 2px", fontSize: 14 }}>{title}</h4>
    {hint && <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>{hint}</p>}
    <div className="row" style={{ gap: 22, flexWrap: "wrap", alignItems: "flex-start", marginTop: hint ? 0 : 8 }}>{children}</div>
  </section>
);

const NotProvided = () => <span className="muted">Not Provided</span>;
const when = (iso) => (iso ? new Date(iso).toLocaleString() : null);
const day = (iso) => (iso ? new Date(iso).toLocaleDateString() : null);

export default function Overview({ d, cust, legacy, managed, o, reload }) {
  const { row, status, ownership: ow, metrics: m, profile = {} } = d;
  const can = (p) => d.permissions.includes(p);
  const [askReason, reasonModal] = useReason();
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState(null); // "owner" | "transfer" | "reassign"
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const pa = ow.primaryAdmin;
  const owner = ow.businessOwner;

  async function run(action, extra, title, detail) {
    const reason = await askReason(title, detail);
    if (!reason) return false;
    setErr(""); setMsg("");
    try { await orgCall(o.id, action, { ...extra, reason }); setMsg("Saved."); setPanel(null); await reload(); return true; }
    catch (e) { setErr(e.message); return false; }
  }

  return (
    <div>
      {reasonModal}
      {err && <p className="error">{err}</p>}
      {msg && <p className="muted" style={{ fontSize: 12 }}>{msg}</p>}

      {/* B. Summary metrics */}
      <Card title="Summary">
        <Fact label="Provisioned seats">{m.provisionedSeats}</Fact>
        <Fact label="Licensed seats">{m.licensedSeats}</Fact>
        <Fact label="Accepted users">{m.acceptedUsers}</Fact>
        <Fact label={`Active users (last ${m.activeWindowDays} days)`}>{m.activeUsers}</Fact>
        <Fact label="Enabled applications">{row.appCount}</Fact>
        <Fact label="Last successful login">{when(m.lastSuccessfulLogin) || <span className="muted">Never</span>}</Fact>
      </Card>

      {/* C. Business ownership & administration */}
      <Card title="Business ownership & administration" hint="Four different things: who owns the business, who asked for the account, who administers it, and who created the record.">
        <div style={{ flex: "1 1 260px" }}>
          <div className="label">Business Owner</div>
          {owner ? (
            <>
              <div style={{ fontWeight: 600 }}>{owner.name}{owner.jobTitle ? " · " + owner.jobTitle : ""}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{[owner.email, owner.phone].filter(Boolean).join(" · ") || "No contact details"}</div>
            </>
          ) : <NotProvided />}
          <div style={{ fontSize: 12.5, marginTop: 2 }}>Verification: <strong>{OWNER_STATUS_LABEL[ow.businessOwnerStatus]}</strong></div>
          {ow.legacyOwnerAdministrator && <div className="muted" style={{ fontSize: 12 }}>Earlier record said “{ow.legacyOwnerAdministrator}” (owner / administrator). Not treated as the business owner.</div>}
          <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 4 }}>
            {can("organizations.manage") && <button type="button" className="link-btn" onClick={() => setPanel(panel === "owner" ? null : "owner")}>{owner ? "Edit contact" : "Add owner details"}</button>}
            {can("organizations.verify") && owner && owner.status !== "verified" &&
              <button type="button" className="link-btn" onClick={() => run("verifyBusinessOwner", {}, "Verify Business Owner", `Confirm ${owner.name} as the verified owner of ${row.name}.`)}>Mark verified</button>}
            {can("organizations.transfer_ownership") && <button type="button" className="link-btn" onClick={() => setPanel(panel === "transfer" ? null : "transfer")}>Transfer ownership…</button>}
          </div>
        </div>

        <div style={{ flex: "1 1 260px" }}>
          <div className="label">Requested by</div>
          {ow.requester ? (
            <>
              <div style={{ fontWeight: 600 }}>{ow.requester.name}{ow.requester.jobTitle ? " · " + ow.requester.jobTitle : ""}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{[ow.requester.email, ow.requester.phone].filter(Boolean).join(" · ")}</div>
              <div style={{ fontSize: 12.5 }}>{REQUESTER_LABEL[ow.requester.type] || ow.requester.type}{ow.requesterIsPrimaryAdmin ? " · also the Primary Organization Admin" : ""}</div>
            </>
          ) : <span className="muted">Not recorded (account created before requester details were captured)</span>}
        </div>

        <div style={{ flex: "1 1 260px" }}>
          <div className="label">Primary Organization Admin</div>
          {pa ? (
            <>
              <div style={{ fontWeight: 600 }}>{pa.name || "(no name)"}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>Login: {pa.loginIdentifier || "—"}</div>
              <div style={{ fontSize: 12.5 }}>Account: <strong>{ADMIN_STATUS_LABEL[pa.status] || pa.status}</strong> · Last login: {when(pa.lastLoginAt) || "Never"}</div>
            </>
          ) : <span className="muted">None assigned{ow.needsAdminReview ? " — needs review" : ""}</span>}
          {ow.needsAdminReview && pa === null && <div style={{ fontSize: 12, color: "var(--red)" }}>No administrator identity could be matched for this organization.</div>}
          {can("organizations.manage") && d.members.length > 0 &&
            <button type="button" className="link-btn" onClick={() => setPanel(panel === "reassign" ? null : "reassign")}>{pa ? "Reassign…" : "Assign…"}</button>}
          <div className="label" style={{ marginTop: 8 }}>Additional Organization Admins</div>
          {ow.additionalAdmins.length === 0 ? <span className="muted" style={{ fontSize: 12.5 }}>None</span> : ow.additionalAdmins.map((a) => (
            <div key={a.userId} style={{ fontSize: 12.5 }}>{a.name || a.loginIdentifier} · {ADMIN_STATUS_LABEL[a.status] || a.status}</div>
          ))}
        </div>

        <div style={{ flex: "1 1 220px" }}>
          <div className="label">Authorization</div>
          <div style={{ fontWeight: 600 }}>{AUTH_STATUS_LABEL[ow.authorizationStatus]}</div>
          {ow.restrictedAccess && <div className="muted" style={{ fontSize: 12 }}>Restricted until verified: trial only, limited seats, no new administrators.</div>}
          {can("organizations.verify") && <AuthControl current={ow.authorizationStatus} onSet={(status) => run("setAuthorization", { status }, "Change authorization status", `Set to “${AUTH_STATUS_LABEL[status]}”.`)} />}
        </div>
      </Card>

      {panel === "owner" && <OwnerForm title={owner ? "Edit Business Owner contact" : "Add Business Owner"} initial={owner}
        onSave={(v) => run("updateBusinessOwner", { owner: v }, "Update Business Owner", "The change is recorded with your reason.")} onCancel={() => setPanel(null)} />}
      {panel === "transfer" && <OwnerForm title="Transfer ownership" initial={null} danger
        note="Only after authorization is verified. The new owner is recorded as verified."
        onSave={(v) => run("transferOwnership", { newOwner: v }, "Transfer ownership", `New owner: ${v.name}.`)} onCancel={() => setPanel(null)} />}
      {panel === "reassign" && <Reassign members={d.members} current={pa?.userId}
        onSave={(uid) => run("reassignPrimaryAdmin", { newAdminUid: uid }, "Reassign Primary Organization Admin", "The new admin must already be a member of this organization.")} onCancel={() => setPanel(null)} />}

      {/* D. Organization profile */}
      <Card title="Organization profile">
        <Fact label="Organization name">{row.name}</Fact>
        <Fact label="Industry">{row.industry}</Fact>
        <Fact label="Country">{row.country}</Fact>
        <Fact label="State / Province / Region">{profile.state || row.state}</Fact>
        <Fact label="City">{profile.city || row.city}</Fact>
        <Fact label="Time zone">{row.timezone}</Fact>
        <Fact label="Currency">{row.currency}</Fact>
        <Fact label="Business contact email">{row.contactEmail}</Fact>
        <Fact label="Business contact phone">{row.contactPhone || cust?.phone}</Fact>
        <Fact label="Business type">{profile.businessType || d.onboarding?.businessType}</Fact>
        <Fact label="Employee count">{profile.employeeCount ?? d.onboarding?.employeeCount}</Fact>
        {d.onboarding?.useCase && <Fact label="Using it for">{d.onboarding.useCase}</Fact>}
        {d.onboarding?.jobTitle && <Fact label="Sign-up contact's job title">{d.onboarding.jobTitle}</Fact>}
        {cust?.signupCountry && <Fact label="Signup country">{cust.signupCountry}</Fact>}
      </Card>

      {/* E. Provisioning information */}
      <Card title="Provisioning information">
        <Fact label="Onboarding method">{ONBOARDING_METHOD_LABEL[ow.onboardingMethod]}</Fact>
        <Fact label="Created by">
          {ow.createdBy ? `${ow.createdBy.actorEmail || ow.createdBy.actorUserId} (${ow.createdBy.actorType === "platform_admin" ? "Bizzux staff" : "customer"})` : <span className="muted">Not recorded</span>}
        </Fact>
        <Fact label="Created">{when(ow.createdAt || d.createdAt)}</Fact>
        <Fact label="Last updated by">{ow.updatedBy ? <code>{ow.updatedBy}</code> : <span className="muted">Not recorded</span>}</Fact>
        <Fact label="Last updated">{when(ow.updatedAt)}</Fact>
        <Fact label="Authorization verification">{AUTH_STATUS_LABEL[ow.authorizationStatus]}</Fact>
        <Fact label="First login / activation">{ONBOARDING_STATUS_LABEL[ow.onboardingStatus]}</Fact>
      </Card>

      {/* F. Commercial summary (details live in the Subscription tab) */}
      <Card title="Commercial summary" hint="Plan, billing and subscription changes are managed in the Subscription tab.">
        <Fact label="Plan">{PLAN[status.plan.type] || status.plan.type}{status.plan.name ? ` · ${status.plan.name}` : ""}</Fact>
        <Fact label="Payment">{PAYMENT[status.payment]}</Fact>
        <Fact label="Trial">{status.trial.state === "not_started" ? "Not started (phone not verified)" : status.trial.endsAt ? "Ends " + day(status.trial.endsAt) : "N/A"}</Fact>
        <Fact label="Licensed seats">{row.licensedSeats}</Fact>
      </Card>

      {managed
        ? (editing ? <DetailsTab o={{ ...o, employeeCount: profile.employeeCount, businessType: profile.businessType }} reload={reload} /> : <button type="button" className="btn-small" onClick={() => setEditing(true)}>Edit organization details</button>)
        : <p className="muted" style={{ fontSize: 12 }}>Self-service organizations keep their own profile; you can see it here and manage status, subscription and sign-in help from the other tabs.</p>}
    </div>
  );
}

function AuthControl({ current, onSet }) {
  const [v, setV] = useState(current);
  return (
    <div className="row" style={{ gap: 6, marginTop: 4 }}>
      <select className="input" style={{ width: 200 }} value={v} onChange={(e) => setV(e.target.value)} aria-label="Authorization status">
        {AUTH_STATUS.map((s) => <option key={s} value={s}>{AUTH_STATUS_LABEL[s]}</option>)}
      </select>
      <button type="button" className="btn-small" disabled={v === current} onClick={() => onSet(v)}>Update</button>
    </div>
  );
}

function OwnerForm({ title, initial, onSave, onCancel, note, danger }) {
  const [f, setF] = useState({ name: initial?.name || "", email: initial?.email || "", phone: initial?.phone || "", jobTitle: initial?.jobTitle || "" });
  const set = (k, v) => setF({ ...f, [k]: v });
  return (
    <div style={{ border: "1px solid " + (danger ? "#fecaca" : "var(--line)"), borderRadius: 10, padding: 12, marginBottom: 14 }}>
      <strong>{title}</strong>
      {note && <p className="muted" style={{ fontSize: 12, margin: "2px 0 8px" }}>{note}</p>}
      <div className="row">
        <Field label="Full name *"><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Job title"><input className="input" value={f.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} /></Field>
      </div>
      <div className="row">
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <button type="button" className="btn-primary" disabled={!f.name.trim()} onClick={() => onSave(f)}>Save…</button>
        <button type="button" className="link-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Reassign({ members, current, onSave, onCancel }) {
  const options = members.filter((x) => x.status === "active" && x.uid !== current);
  const [uid, setUid] = useState("");
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginBottom: 14 }}>
      <strong>Reassign Primary Organization Admin</strong>
      <p className="muted" style={{ fontSize: 12, margin: "2px 0 8px" }}>Choose an existing member of this organization. No account is created and nobody changes organization.</p>
      <select className="input" value={uid} onChange={(e) => setUid(e.target.value)} aria-label="New Primary Organization Admin">
        <option value="">Select a member</option>
        {options.map((x) => <option key={x.uid} value={x.uid}>{x.name || x.login || x.uid} ({x.role})</option>)}
      </select>
      <div className="row" style={{ gap: 10, marginTop: 8 }}>
        <button type="button" className="btn-primary" disabled={!uid} onClick={() => onSave(uid)}>Reassign…</button>
        <button type="button" className="link-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
