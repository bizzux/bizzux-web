"use client";
// User details drawer: one panel per person with Overview, Account, Organizations, Apps & licences, Roles and Activity, opened from the list.
import { useEffect, useState } from "react";
import Drawer from "./Drawer";
import { APPS } from "@/lib/appCatalog";
import { toLoginId } from "@/lib/loginId";

const TABS = ["Overview", "Account", "Organizations", "Apps & licences", "Roles", "Activity"];
const LOGIN = { google: "Google", email: "Email and password", username: "Bizzux username", "attendance-username": "Attendance username", unknown: "Unknown" };
const ORG_SOURCE = { owner: "Company owner", explicit: "Set by an administrator", "legacy-profile": "Derived from the business profile" };
const ACTION = {
  "user.create_username": "Account created", "user.create_username_retry": "Account creation retried", "user.reset_password": "Password reset", "user.reissue_temp_password": "Password re-issued",
  "user.set_apps": "App access changed", "org.set_role": "Organization role changed", "team.remove": "Removed from the company", "team.restore": "Restored to the company", "user.link_company": "Joined the company",
  "user.bind_employee": "Linked to an Attendance record", "user.reset_username_password": "Password reset", "user.regenerate_recovery_codes": "New recovery codes issued", "user.link_request": "Invited to join the company", "contact.create": "Contact added", "user.suspend": "Suspended", "user.activate": "Re-activated", "user.set_expiry": "Account expiry changed", "user.unlock_username": "Sign-in unlocked",
};
const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contractor", "Intern"];
const PROFILE_FIELDS = [["jobTitle", "Job title"], ["department", "Department"], ["employmentType", "Employment type"], ["employeeId", "Employee ID"], ["branch", "Branch"], ["office", "Office"], ["officePhone", "Office phone"], ["mobilePhone", "Mobile number"], ["streetAddress", "Street address", true], ["city", "City"], ["state", "State or province"], ["zip", "Postal code"], ["country", "Country or region"]];
const appName = (id) => APPS.find((a) => a.id === id)?.name || id;
const when = (ms) => (ms ? new Date(ms).toLocaleString() : "");
const day = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

export default function UserDetailsDrawer({ open, uid, api, onClose, onResetPassword, onManageAccess, onRoleChange, onUnlock, onRecoveryCodes, onDisable, onDelete, canAssignAdmin, row }) {
  const [tab, setTab] = useState(0);
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open || !uid) return undefined;
    let live = true; setTab(0); setD(null); setErr(""); setEdit(null);
    api("/api/iam/users/" + encodeURIComponent(uid), "GET").then((x) => live && setD(x)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [open, uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const canEdit = !row?.dirOnly;
  const startEdit = () => {
    const p = d.profileInfo || {}; const ci = p.contactInfo || {};
    setErr(""); setEdit({ jobTitle: p.jobTitle || "", department: p.department || "", employmentType: ci.employmentType || "", employeeId: p.employeeId || "", branch: p.branch || "", office: ci.office || "", officePhone: ci.officePhone || "", mobilePhone: ci.mobilePhone || "", streetAddress: ci.streetAddress || "", city: ci.city || "", state: ci.state || "", zip: ci.zip || "", country: ci.country || "" });
  };
  const saveProfile = async (e) => {
    e.preventDefault(); setSaving(true); setErr("");
    try {
      const { branch, employeeId, ...contactInfo } = edit;
      await api("/api/iam/users/" + encodeURIComponent(uid), "PATCH", { branch, employeeId, contactInfo });
      setD(await api("/api/iam/users/" + encodeURIComponent(uid), "GET")); setEdit(null);
    } catch (x) { setErr(x.message); } finally { setSaving(false); }
  };
  const title = d?.name || row?.firstName || row?.username || "User details";
  return (
    <Drawer open={open} title={title} onClose={onClose} size="wide" label={"Details for " + title}>
      {err && <p className="error" role="alert">{err}</p>}
      {!d && !err && <p className="muted" role="status">Loading…</p>}
      {d && (
        <>
          <div className="adm-actions" role="toolbar" aria-label="Actions for this user">
            {d.account.canResetPassword && <button type="button" className="adm-cmdbtn" onClick={() => onResetPassword(row)}>Reset password</button>}
            <button type="button" className="adm-cmdbtn" onClick={() => onManageAccess(row)}>Manage roles &amp; app access</button>
            {d.account.locked && <button type="button" className="adm-cmdbtn" onClick={() => onUnlock(row)}>Unlock sign-in</button>}
            {!row?.dirOnly && onDisable && <button type="button" className="adm-cmdbtn" onClick={() => onDisable(row)}>{row?.status === "disabled" ? "Unblock sign-in" : "Block sign-in"}</button>}
            {!row?.dirOnly && onDelete && <button type="button" className="adm-cmdbtn" style={{ color: "#b3261e" }} onClick={() => onDelete(row)}>Delete user</button>}
            {d.loginKind === "username" && d.account.homeCompany && <button type="button" className="adm-cmdbtn" onClick={() => onRecoveryCodes(row)}>New recovery codes</button>}
          </div>
          <div role="tablist" aria-label="User details" className="adm-tabs">
            {TABS.map((t, i) => (<button key={t} role="tab" type="button" aria-selected={tab === i} className={tab === i ? "on" : ""} onClick={() => setTab(i)}>{t}</button>))}
          </div>
          <div role="tabpanel" className="adm-tabpanel">
            {tab === 0 && edit && (
              <form onSubmit={saveProfile} className="adm-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {PROFILE_FIELDS.map(([k, label, wide]) => (
                  <label key={k} className="adm-field" style={wide ? { gridColumn: "1 / -1" } : undefined}>{label}
                    {k === "employmentType"
                      ? <select className="input" value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}><option value="">Not set</option>{EMPLOYMENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                      : <input className="input" value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />}
                  </label>
                ))}
                <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                  <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
                  <button type="button" className="adm-cmdbtn" onClick={() => { setEdit(null); setErr(""); }} disabled={saving}>Cancel</button>
                </div>
              </form>
            )}
            {tab === 0 && !edit && (
              <dl className="adm-rv" style={{ gridTemplateColumns: "170px 1fr" }}>
                <dt>Display name</dt><dd>{d.name || "—"}</dd>
                <dt>Bizzux ID</dt><dd>{d.username ? toLoginId(d.username) : "—"}</dd>
                <dt>Contact email</dt><dd>{d.email || "—"}</dd>
                <dt>Sign-in method</dt><dd>{LOGIN[d.loginKind]}</dd>
                <dt>Status</dt><dd>{d.disabled ? "Disabled" : d.account.pendingActivation ? "Waiting for first sign-in" : "Active"}</dd>
                <dt>Created</dt><dd>{day(d.created)}</dd>
                <dt>Last sign-in</dt><dd>{day(d.lastSignIn)}</dd>
                <dt>Job title</dt><dd>{d.profileInfo.jobTitle || "—"}</dd>
                <dt>Department</dt><dd>{d.profileInfo.department || "—"}</dd>
                <dt>Branch</dt><dd>{d.profileInfo.branch || "—"}</dd>
                <dt>Employee ID</dt><dd>{d.profileInfo.employeeId || "—"}</dd>
                <dt>Employment type</dt><dd>{d.profileInfo.employmentType || "—"}</dd>
                {["officePhone", "mobilePhone", "office"].map((k, i) => d.profileInfo.contactInfo?.[k] ? <span key={k} style={{ display: "contents" }}><dt>{["Office phone", "Mobile number", "Office"][i]}</dt><dd>{d.profileInfo.contactInfo[k]}</dd></span> : null)}
                {[d.profileInfo.contactInfo?.streetAddress, d.profileInfo.contactInfo?.city, d.profileInfo.contactInfo?.state, d.profileInfo.contactInfo?.zip, d.profileInfo.contactInfo?.country].filter(Boolean).length > 0 && <><dt>Address</dt><dd>{[d.profileInfo.contactInfo.streetAddress, d.profileInfo.contactInfo.city, d.profileInfo.contactInfo.state, d.profileInfo.contactInfo.zip, d.profileInfo.contactInfo.country].filter(Boolean).join(", ")}</dd></>}
                {canEdit && <><dt></dt><dd><button type="button" className="adm-cmdbtn" onClick={startEdit}>Edit profile</button></dd></>}
              </dl>
            )}
            {tab === 1 && (
              <dl className="adm-rv" style={{ gridTemplateColumns: "190px 1fr" }}>
                <dt>Sign-in method</dt><dd>{LOGIN[d.loginKind]}</dd>
                <dt>Managed by</dt><dd>{d.loginKind === "username" ? (d.account.homeCompany ? "This company" : "Another company (its administrators manage the password)") : "The person's own " + (d.loginKind === "google" ? "Google" : "email") + " account"}</dd>
                <dt>Account expires</dt><dd>{d.account.accountExpiresAt || "No expiry"}</dd>
                <dt>Sign-in locked</dt><dd>{d.account.locked ? "Yes, after too many wrong passwords" : "No"}</dd>
                <dt>Recovery codes</dt><dd>{d.loginKind === "username" ? (d.account.hasRecoveryCodes ? "Issued" : "Not issued yet") : "Not applicable"}</dd>
                <dt>MFA</dt><dd className="muted">Not shown here (managed under Security)</dd>
              </dl>
            )}
            {tab === 2 && (
              <dl className="adm-rv" style={{ gridTemplateColumns: "190px 1fr" }}>
                <dt>This company</dt><dd>{d.organization.status === "active" ? "Active member" : d.organization.status}</dd>
                <dt>Organization role</dt><dd>{d.organization.role}</dd>
                <dt>Business profile</dt><dd>{d.organization.profile || "—"}</dd>
                <dt>Other companies</dt><dd>{d.organization.otherOrganizations ? `Also belongs to ${d.organization.otherOrganizations} other ${d.organization.otherOrganizations === 1 ? "company" : "companies"} (not shown to you)` : "None"}</dd>
              </dl>
            )}
            {tab === 3 && (
              <table className="table"><thead><tr><th>Application</th><th>Access</th><th>App role</th><th>Source</th></tr></thead>
                <tbody>{d.apps.map((a) => (
                  <tr key={a.appId}><td>{appName(a.appId)}</td><td>{a.access ? "Yes" : "No"}{!a.access && a.reason ? <span className="muted"> ({a.reason.replace(/_/g, " ")})</span> : null}</td><td>{a.access ? (a.appRole === "ADMIN" ? "Admin" : "Member") : "—"}</td><td>{a.access ? (a.source === "owner" ? "Company owner" : "Assigned") : "—"}</td></tr>
                ))}</tbody></table>
            )}
            {tab === 4 && (
              <div>
                <p className="muted" style={{ marginTop: 0 }}>The organization role controls what they can do in the company (users, roles, app assignment). It grants no application permission.</p>
                <p><b>Current:</b> {d.organization.role} <span className="muted">({ORG_SOURCE[d.organization.roleSource] || d.organization.roleSource})</span></p>
                {d.organization.role !== "OWNER" && (
                  <label className="adm-field">Change organization role
                    <select className="input" style={{ maxWidth: 220 }} value={d.organization.role} onChange={(e) => onRoleChange(row, e.target.value).then?.(() => api("/api/iam/users/" + encodeURIComponent(uid), "GET").then(setD))}
                      disabled={!canAssignAdmin && d.organization.role === "ADMIN"}>
                      <option value="ADMIN" disabled={!canAssignAdmin}>Admin</option><option value="MEMBER">Member</option><option value="VIEWER">Viewer</option>
                    </select>
                    {!canAssignAdmin && <span className="adm-hint">Only the Owner can make or remove an Admin.</span>}
                  </label>
                )}
              </div>
            )}
            {tab === 5 && (d.activity.length === 0 ? <p className="muted">No recorded activity yet.</p> : (
              <ul className="adm-activity">{d.activity.map((x, i) => (<li key={i}><b>{ACTION[x.action] || x.action}</b><span className="muted"> · {x.by} · {when(x.at)}</span></li>))}</ul>
            ))}
          </div>
        </>
      )}
    </Drawer>
  );
}
