"use client";
// User details drawer: one panel per person with Overview, Account, Organizations, Apps & licences, Roles and Activity, opened from the list.
import { useEffect, useRef, useState } from "react";
import Drawer from "./Drawer";
import { APPS } from "@/lib/appCatalog";
import { toLoginId } from "@/lib/loginId";
import { PROFILES } from "@/lib/roles";
import Notice from "./Notice";
import { useConfirm } from "./ConfirmDialog";
import { ADMIN_PROFILES, ROLE_LABEL, adminChangeDialog } from "./roleChange";
import { appAdminChanged, appChanges, discard, effective, hasChanges, isPastExpiry, savedApp, stageApp, stageValue } from "@/lib/adminStaging";

const TABS = ["Overview", "Account", "Organizations", "Apps & licences", "Roles", "Activity"];
const LOGIN = { google: "Google", email: "Email and password", username: "Bizzux username", "attendance-username": "Attendance username", unknown: "Unknown" };
const ORG_SOURCE = { owner: "Company owner", explicit: "Set by an administrator", "legacy-profile": "Derived from the business profile" };
const ACTION = {
  "user.create_username": "Account created", "user.create_username_retry": "Account creation retried", "user.reset_password": "Password reset", "user.reissue_temp_password": "Password re-issued",
  "user.set_apps": "App access changed", "user.set_app_access": "App access changed", "org.set_role": "Organization role changed", "team.remove": "Removed from the company", "team.restore": "Restored to the company", "user.link_company": "Joined the company",
  "user.bind_employee": "Linked to an Attendance record", "user.reset_username_password": "Password reset", "user.regenerate_recovery_codes": "New recovery codes issued", "user.link_request": "Invited to join the company", "contact.create": "Contact added", "user.suspend": "Suspended", "user.activate": "Re-activated", "user.set_expiry": "Account expiry changed", "user.update_profile": "Profile updated", "user.set_profile": "Business profile changed", "user.unlock_username": "Sign-in unlocked",
};
const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contractor", "Intern"];
const PROFILE_FIELDS = [["jobTitle", "Job title"], ["department", "Department"], ["employmentType", "Employment type"], ["employeeId", "Employee ID"], ["branch", "Branch"], ["office", "Office"], ["officePhone", "Office phone"], ["mobilePhone", "Mobile number"], ["streetAddress", "Street address", true], ["city", "City"], ["state", "State or province"], ["zip", "Postal code"], ["country", "Country or region"]];
const FIELD_LABEL = {
  firstName: "first name", lastName: "last name", displayName: "display name", accountExpiresAt: "account expiry", jobTitle: "job title", department: "department",
  employmentType: "employment type", employeeId: "employee ID", branch: "branch", office: "office", officePhone: "office phone", mobilePhone: "mobile number",
  streetAddress: "street address", city: "city", state: "state or province", zip: "postal code", country: "country or region", faxNumber: "fax number",
};
const NO_RECORD = "This person has no team record in this company, so this can't be edited here.";
const NOT_HOME = "Name and sign-in are managed by this person's own account or their home company, so they can't be changed here.";
const Pencil = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>);
// A heading for one section with its own "Edit" link. Every section shows one: when this person or section can't be edited by the viewer the link is
// greyed out and `why` (its tooltip) says so, instead of the link silently being missing.
const GroupHead = ({ title, onEdit, label, why }) => (
  <div className="adm-grouphead"><h3>{title}</h3>
    <button type="button" className="adm-editlink" aria-label={label} disabled={!onEdit} title={onEdit ? undefined : why} onClick={onEdit || undefined}><Pencil />Edit</button>
  </div>
);
// The organization role and business profile pickers with Save / Cancel. ONE component for both places that edit them (the Roles tab and the Edit link
// on the Organizations tab); the staged values and the save logic live in the drawer, so the two can never disagree. Picking only stages a value.
function RoleEditor({ d, canEdit, canAssignAdmin, curRole, curProfile, nextRole, nextProfile, dirty, saving, closable, onRole, onProfile, onSave, onCancel }) {
  if (d.organization.role === "OWNER") return null;
  return (
    <div>
      <label className="adm-field">Change organization role
        <select className="input" style={{ maxWidth: 220 }} value={nextRole} onChange={(e) => onRole(e.target.value)} disabled={saving || (!canAssignAdmin && curRole === "ADMIN")}>
          <option value="ADMIN" disabled={!canAssignAdmin}>Admin</option><option value="MEMBER">Member</option><option value="VIEWER">Viewer</option>
        </select>
        {!canAssignAdmin && <span className="adm-hint">Only the Owner can make or remove an Admin.</span>}
      </label>
      {canEdit && (
        <label className="adm-field" style={{ marginTop: 12 }}>Business profile
          <select className="input" style={{ maxWidth: 260 }} value={nextProfile} onChange={(e) => onProfile(e.target.value)} disabled={saving || (!canAssignAdmin && ADMIN_PROFILES.includes(curProfile))}>
            {!PROFILES.some((p) => p.value === curProfile) && <option value={curProfile} disabled>{curProfile || "Not set"}</option>}
            {PROFILES.filter((p) => p.value !== "Global Admin" || p.value === curProfile).map((p) => (
              <option key={p.value} value={p.value} disabled={p.value !== curProfile && ADMIN_PROFILES.includes(p.value) && !canAssignAdmin}>{p.label}</option>
            ))}
          </select>
          <span className="adm-hint">Describes the job in the business apps. Separate from the organization role. App access is changed under Manage roles &amp; app access.</span>
        </label>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
        <button type="button" className="btn-primary-sm" disabled={!dirty || saving} onClick={onSave}>{saving ? "Saving…" : "Save changes"}</button>
        <button type="button" className="adm-btn-outline" disabled={saving || (!closable && !dirty)} onClick={onCancel}>Cancel</button>
        {dirty && !saving && <span className="adm-hint" style={{ margin: 0 }}>Not saved yet</span>}
      </div>
    </div>
  );
}
const appName = (id) => APPS.find((a) => a.id === id)?.name || id;
const when = (ms) => (ms ? new Date(ms).toLocaleString() : "");
const day = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

export default function UserDetailsDrawer({ open, uid, api, onClose, onResetPassword, onManageAccess, onRoleChange, onUnlock, onRecoveryCodes, onDisable, onDelete, onChanged, canAssignAdmin, row }) {
  const [tab, setTab] = useState(0);
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [stage, setStage] = useState({}); // Roles tab: the changes picked but not saved yet ({ orgRole?, profile? })
  const [savingRoles, setSavingRoles] = useState(false);
  const [orgEditing, setOrgEditing] = useState(false); // the Organizations tab's role editor is open (the Roles tab always shows it)
  const [exp, setExp] = useState(null); // Account tab: the expiry date being edited in place ("" = no expiry), null = not editing
  const [savingExp, setSavingExp] = useState(false);
  const [appStage, setAppStage] = useState(null); // Apps & licences tab: { [appId]: { granted, admin } } while editing, null = not editing
  const [savingApps, setSavingApps] = useState(false);
  const [askConfirm, confirmDialog] = useConfirm();
  useEffect(() => {
    if (!open || !uid) return undefined;
    let live = true; setTab(0); setD(null); setErr(""); setMsg(""); setEdit(null); setStage({}); setOrgEditing(false); setExp(null); setAppStage(null);
    api("/api/iam/users/" + encodeURIComponent(uid), "GET").then((x) => live && setD(x)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [open, uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const canEdit = !row?.dirOnly;
  const canEditIdentity = !!d?.account?.canEditIdentity; // name and expiry belong to a Bizzux username login homed in this company
  const panel = useRef(null);
  const section = useRef(null); // which group's "Edit" opened the form, so it can scroll there
  // Opens the one edit form from any "Edit" control: "identity" (name), "job" (job and profile) or "expiry"; none = from the top.
  const startEdit = (where) => {
    const p = d.profileInfo || {}; const ci = p.contactInfo || {};
    setErr(""); setMsg(""); setTab(0); section.current = typeof where === "string" ? where : null;
    setEdit({ ...(canEditIdentity ? { firstName: d.nameInfo?.firstName || "", lastName: d.nameInfo?.lastName || "", displayName: d.name || "", accountExpiresAt: d.account.accountExpiresAt || "" } : {}), jobTitle: p.jobTitle || "", department: p.department || "", employmentType: ci.employmentType || "", employeeId: p.employeeId || "", branch: p.branch || "", office: ci.office || "", officePhone: ci.officePhone || "", mobilePhone: ci.mobilePhone || "", streetAddress: ci.streetAddress || "", city: ci.city || "", state: ci.state || "", zip: ci.zip || "", country: ci.country || "" });
  };
  // After the form appears: scroll to the group that was clicked and put the cursor in its first field (the top of the form otherwise).
  useEffect(() => {
    if (!edit) return;
    const target = section.current ? panel.current?.querySelector(`[data-edit-section="${section.current}"]`) : null;
    const first = target?.matches("input,select") ? target : target?.querySelector("input,select") || panel.current?.querySelector("form input,form select");
    (target || first)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    first?.focus({ preventScroll: true });
    section.current = null;
  }, [!!edit]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveProfile = async (e) => {
    e.preventDefault(); setErr(""); setMsg("");
    if (canEditIdentity && !edit.displayName.trim()) { setErr("Display name is required."); return; }
    setSaving(true);
    try {
      const { branch, employeeId, firstName, lastName, displayName, accountExpiresAt, ...contactInfo } = edit;
      const r = await api("/api/iam/users/" + encodeURIComponent(uid), "PATCH", { branch, employeeId, contactInfo, ...(canEditIdentity ? { firstName, lastName, displayName, accountExpiresAt } : {}) });
      setD(await api("/api/iam/users/" + encodeURIComponent(uid), "GET")); setEdit(null);
      setMsg(r?.changed?.length ? "Saved. Updated: " + r.changed.map((k) => FIELD_LABEL[k] || k).join(", ") + "." : "No changes to save.");
      onChanged?.();
    } catch (x) { setErr(x.message); } finally { setSaving(false); }
  };
  const title = d?.name || row?.firstName || row?.username || "User details";
  const refresh = async () => setD(await api("/api/iam/users/" + encodeURIComponent(uid), "GET"));
  // Runs one of the page's actions (block, unlock, delete...): a returned string is shown as the success message at the top of this panel, a thrown
  // error as the error message, and the details are re-read afterwards so the panel never shows stale values.
  const run = async (fn) => {
    setErr(""); setMsg("");
    try {
      const done = await fn();
      if (typeof done === "string" && done) { setMsg(done); await refresh().catch(() => {}); }
    } catch (x) { setErr(x?.message || "Something went wrong."); }
  };

  // Roles tab: picking a value only STAGES it; nothing is saved until "Save changes".
  const curRole = d?.organization?.role || "";
  const curProfile = d?.organization?.profile || "";
  const nextRole = effective(stage, "orgRole", curRole);
  const nextProfile = effective(stage, "profile", curProfile);
  const rolesDirty = !!d && hasChanges(stage, { orgRole: curRole, profile: curProfile });
  const profileLabel = (v) => PROFILES.find((p) => p.value === v)?.label || v || "Not set";
  const saveRoles = async () => {
    const roleChanged = nextRole !== curRole;
    const profChanged = nextProfile !== curProfile;
    const person = title;
    // Anything that makes someone an Admin, or takes Admin away, is confirmed first, naming the person and the old and new values.
    const adminAsk = adminChangeDialog({ person, curRole, nextRole, curProfile, nextProfile, profileLabel });
    if (adminAsk && !(await askConfirm(adminAsk))) return;
    setSavingRoles(true); setErr(""); setMsg("");
    const saved = [];
    try {
      if (roleChanged) { await onRoleChange(row, nextRole); saved.push("organization role " + (ROLE_LABEL[curRole] || curRole) + " → " + (ROLE_LABEL[nextRole] || nextRole)); }
      if (profChanged) { await api("/api/iam/identities", "POST", { kind: "profile", uid, profile: nextProfile }); saved.push("business profile " + profileLabel(curProfile) + " → " + profileLabel(nextProfile)); }
      setStage({}); setOrgEditing(false);
      await refresh();
      setMsg("Saved for " + person + ": " + saved.join(" and ") + ". The Organizations tab shows the new values.");
      onChanged?.();
    } catch (x) {
      // Keep what was picked but not saved; show what did save so nothing is misleading.
      if (saved.length) { setStage((s) => stageValue(s, "orgRole", undefined, curRole)); await refresh().catch(() => {}); onChanged?.(); }
      setErr((x?.message || "Could not save the change.") + (saved.length ? " Already saved: " + saved.join(" and ") + "." : " Nothing was changed."));
    } finally { setSavingRoles(false); }
  };
  const cancelRoles = () => { setStage(discard()); setOrgEditing(false); };
  const roleEditor = (closable) => (
    <RoleEditor d={d} canEdit={canEdit} canAssignAdmin={canAssignAdmin} curRole={curRole} curProfile={curProfile} nextRole={nextRole} nextProfile={nextProfile}
      dirty={rolesDirty} saving={savingRoles} closable={closable} onSave={saveRoles} onCancel={cancelRoles}
      onRole={(v) => setStage((s) => stageValue(s, "orgRole", v, curRole))} onProfile={(v) => setStage((s) => stageValue(s, "profile", v, curProfile))} />
  );

  // Account tab: the expiry date is edited in place and, like the Roles tab, nothing is saved until "Save changes".
  const curExpiry = d?.account?.accountExpiresAt || "";
  const expDirty = exp !== null && exp !== curExpiry;
  const startExpiry = () => { setErr(""); setMsg(""); setTab(1); setExp(curExpiry); };
  const saveExpiry = async () => {
    const person = title;
    // A date that has already passed locks the person out straight away, so say so before saving.
    if (isPastExpiry(exp) && !(await askConfirm({
      title: "Expiry date has already passed", tone: "danger", confirmLabel: "Set expiry",
      body: <p><b>{person}</b> will no longer be able to sign in, because {exp} is in the past. Choose a later date, or Clear to remove the expiry.</p>,
    }))) return;
    setSavingExp(true); setErr(""); setMsg("");
    try {
      await api("/api/iam/users/" + encodeURIComponent(uid), "PATCH", { accountExpiresAt: exp });
      setExp(null);
      await refresh();
      setMsg(exp ? "Account expiry for " + person + " is now " + exp + (curExpiry ? " (was " + curExpiry + ")." : ".") : "Account expiry removed for " + person + (curExpiry ? " (was " + curExpiry + ")." : "."));
      onChanged?.();
    } catch (x) { setErr((x?.message || "Could not save the expiry.") + " Nothing was changed."); } finally { setSavingExp(false); }
  };
  // Apps & licences tab: access and the app role are edited per app in place; nothing is saved until "Save changes". Only the apps that changed are sent.
  const appsEditable = canEdit && d?.organization?.role !== "OWNER";
  const appsWhy = !canEdit ? NO_RECORD : "The company Owner always has every app, so it can't be changed here.";
  const appState = (x) => (!x.granted ? "No access" : x.admin ? "Admin" : "Member");
  const startApps = () => { setErr(""); setMsg(""); setTab(3); setAppStage({}); };
  const appChangeList = d && appStage ? appChanges(d.apps, appStage) : [];
  const saveApps = async () => {
    const changes = appChangeList;
    if (!changes.length) return;
    const person = title;
    // Making someone an app Admin, or taking that away, is confirmed first, naming the person, each app and the old and new role.
    if (appAdminChanged(changes) && !(await askConfirm({
      title: "Confirm app Admin change", tone: "warning", confirmLabel: "Confirm change",
      body: (<><p>You are about to change app access for <b>{person}</b>:</p>
        <ul>{changes.map((c) => <li key={c.appId}>{appName(c.appId)}: <b>{appState(c.from)}</b> → <b>{appState(c.to)}</b></li>)}</ul>
        <p>An app Admin can manage that app's settings and data.</p></>),
    }))) return;
    setSavingApps(true); setErr(""); setMsg("");
    try {
      await api("/api/iam/identities", "POST", { kind: "appAccess", uid, apps: changes.map((c) => ({ appId: c.appId, granted: c.to.granted, admin: c.to.admin })) });
      setAppStage(null);
      await refresh();
      setMsg("Saved for " + person + ": " + changes.map((c) => appName(c.appId) + " " + appState(c.from) + " → " + appState(c.to)).join("; ") + ".");
      onChanged?.();
    } catch (x) { setErr((x?.message || "Could not save app access.") + " Nothing was changed."); } finally { setSavingApps(false); }
  };
  return (
    <>
    <Drawer open={open} title={title} onClose={onClose} size="wide" label={"Details for " + title}>
      {err && <Notice kind="error" onDismiss={() => setErr("")}>{err}</Notice>}
      {msg && <Notice kind="ok" onDismiss={() => setMsg("")}>{msg}</Notice>}
      {!d && !err && <p className="muted" role="status">Loading…</p>}
      {d && (
        <>
          <div className="adm-actions" role="toolbar" aria-label="Actions for this user">
            {canEdit && <button type="button" className="adm-editbtn" aria-label={"Edit details for " + title} disabled={!!edit} onClick={() => startEdit()}><Pencil />Edit</button>}
            {d.account.canResetPassword && <button type="button" className="adm-cmdbtn" onClick={() => onResetPassword(row)}>Reset password</button>}
            <button type="button" className="adm-cmdbtn" onClick={() => run(() => onManageAccess(row))}>Manage roles &amp; app access</button>
            {d.account.locked && <button type="button" className="adm-cmdbtn" onClick={() => run(() => onUnlock(row))}>Unlock sign-in</button>}
            {!row?.dirOnly && onDisable && <button type="button" className="adm-cmdbtn" onClick={() => run(() => onDisable(row))}>{row?.status === "disabled" ? "Unblock sign-in" : "Block sign-in"}</button>}
            {!row?.dirOnly && onDelete && <button type="button" className="adm-cmdbtn" style={{ color: "#b3261e" }} onClick={() => run(() => onDelete(row))}>Delete user</button>}
            {d.loginKind === "username" && d.account.homeCompany && <button type="button" className="adm-cmdbtn" onClick={() => run(() => onRecoveryCodes(row))}>New recovery codes</button>}
          </div>
          <div role="tablist" aria-label="User details" className="adm-tabs">
            {TABS.map((t, i) => (<button key={t} role="tab" type="button" aria-selected={tab === i} className={tab === i ? "on" : ""} onClick={() => setTab(i)}>{t}</button>))}
          </div>
          <div role="tabpanel" className="adm-tabpanel" ref={panel}>
            {tab === 0 && edit && (
              <form onSubmit={saveProfile} className="adm-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {canEditIdentity ? (
                  <>
                    <label className="adm-field">First name<input className="input" data-edit-section="identity" maxLength={60} value={edit.firstName} onChange={(e) => setEdit({ ...edit, firstName: e.target.value })} /></label>
                    <label className="adm-field">Last name<input className="input" maxLength={60} value={edit.lastName} onChange={(e) => setEdit({ ...edit, lastName: e.target.value })} /></label>
                    <label className="adm-field" style={{ gridColumn: "1 / -1" }}>Display name (required)
                      <input className="input" maxLength={80} required value={edit.displayName} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} />
                      <span className="adm-hint">Shown across Bizzux. It does not change by itself when you edit the first or last name.</span>
                    </label>
                    <label className="adm-field" style={{ gridColumn: "1 / -1" }}>Account expires on
                      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input className="input" type="date" data-edit-section="expiry" style={{ maxWidth: 220 }} value={edit.accountExpiresAt} onChange={(e) => setEdit({ ...edit, accountExpiresAt: e.target.value })} />
                        {edit.accountExpiresAt && <button type="button" className="adm-link" onClick={() => setEdit({ ...edit, accountExpiresAt: "" })}>Clear</button>}
                      </span>
                      <span className="adm-hint">Optional, for temporary staff. They can sign in until the end of that day.</span>
                    </label>
                  </>
                ) : (
                  <p className="adm-hint" style={{ gridColumn: "1 / -1", margin: 0 }}>Name and account expiry are managed by this person&apos;s own sign-in account (or by their home company), so they can&apos;t be changed here. Sign-in ID and email are never changed here.</p>
                )}
                {PROFILE_FIELDS.map(([k, label, wide]) => (
                  <label key={k} className="adm-field" style={wide ? { gridColumn: "1 / -1" } : undefined}>{label}
                    {k === "employmentType"
                      ? <select className="input" value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}><option value="">Not set</option>{EMPLOYMENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                      : <input className="input" data-edit-section={k === "jobTitle" ? "job" : undefined} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />}
                  </label>
                ))}
                <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                  <button type="submit" className="btn-primary-sm" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
                  <button type="button" className="adm-cmdbtn" onClick={() => { setEdit(null); setErr(""); }} disabled={saving}>Cancel</button>
                </div>
              </form>
            )}
            {tab === 0 && !edit && (
              <>
              <GroupHead title="Name and sign-in" onEdit={canEdit && canEditIdentity ? () => startEdit("identity") : null} label="Edit name" why={canEdit ? NOT_HOME : NO_RECORD} />
              <dl className="adm-rv" style={{ gridTemplateColumns: "170px 1fr" }}>
                <dt>Display name</dt><dd>{d.name || "—"}</dd>
                <dt>Bizzux ID</dt><dd>{d.username ? toLoginId(d.username) : "—"}</dd>
                <dt>Contact email</dt><dd>{d.email || "—"}</dd>
                <dt>Sign-in method</dt><dd>{LOGIN[d.loginKind]}</dd>
                <dt>Status</dt><dd>{d.disabled ? "Disabled" : d.account.pendingActivation ? "Waiting for first sign-in" : "Active"}</dd>
                <dt>Created</dt><dd>{day(d.created)}</dd>
                <dt>Last sign-in</dt><dd>{day(d.lastSignIn)}</dd>
              </dl>
              {canEditIdentity && (
                <>
                  <GroupHead title="Account expiry" onEdit={canEdit ? () => startEdit("expiry") : null} label="Edit account expiry" why={NO_RECORD} />
                  <dl className="adm-rv" style={{ gridTemplateColumns: "170px 1fr" }}><dt>Account expires on</dt><dd>{d.account.accountExpiresAt || "No expiry"}</dd></dl>
                </>
              )}
              <GroupHead title="Job and profile" onEdit={canEdit ? () => startEdit("job") : null} label="Edit job and profile" why={NO_RECORD} />
              <dl className="adm-rv" style={{ gridTemplateColumns: "170px 1fr" }}>
                <dt>Job title</dt><dd>{d.profileInfo.jobTitle || "—"}</dd>
                <dt>Department</dt><dd>{d.profileInfo.department || "—"}</dd>
                <dt>Branch</dt><dd>{d.profileInfo.branch || "—"}</dd>
                <dt>Employee ID</dt><dd>{d.profileInfo.employeeId || "—"}</dd>
                <dt>Employment type</dt><dd>{d.profileInfo.employmentType || "—"}</dd>
                {["officePhone", "mobilePhone", "office"].map((k, i) => d.profileInfo.contactInfo?.[k] ? <span key={k} style={{ display: "contents" }}><dt>{["Office phone", "Mobile number", "Office"][i]}</dt><dd>{d.profileInfo.contactInfo[k]}</dd></span> : null)}
                {[d.profileInfo.contactInfo?.streetAddress, d.profileInfo.contactInfo?.city, d.profileInfo.contactInfo?.state, d.profileInfo.contactInfo?.zip, d.profileInfo.contactInfo?.country].filter(Boolean).length > 0 && <><dt>Address</dt><dd>{[d.profileInfo.contactInfo.streetAddress, d.profileInfo.contactInfo.city, d.profileInfo.contactInfo.state, d.profileInfo.contactInfo.zip, d.profileInfo.contactInfo.country].filter(Boolean).join(", ")}</dd></>}
              </dl>
              {canEdit && <p style={{ margin: "14px 0 0" }}><button type="button" className="adm-btn-outline" onClick={() => startEdit()}><Pencil />Edit profile</button></p>}
              </>
            )}
            {tab === 1 && (
              <>
                <GroupHead title="Sign-in and security" onEdit={null} label="Edit sign-in and security" why="Sign-in method and security are not edited here. Use Reset password, Unlock sign-in or New recovery codes in the actions above." />
                <dl className="adm-rv" style={{ gridTemplateColumns: "190px 1fr" }}>
                  <dt>Sign-in method</dt><dd>{LOGIN[d.loginKind]}</dd>
                  <dt>Managed by</dt><dd>{d.loginKind === "username" ? (d.account.homeCompany ? "This company" : "Another company (its administrators manage the password)") : "The person's own " + (d.loginKind === "google" ? "Google" : "email") + " account"}</dd>
                  <dt>Sign-in locked</dt><dd>{d.account.locked ? "Yes, after too many wrong passwords" : "No"}</dd>
                  <dt>Recovery codes</dt><dd>{d.loginKind === "username" ? (d.account.hasRecoveryCodes ? "Issued" : "Not issued yet") : "Not applicable"}</dd>
                  <dt>MFA</dt><dd className="muted">Not shown here (managed under Security)</dd>
                </dl>
                <GroupHead title="Account expiry" onEdit={canEdit && canEditIdentity && exp === null ? startExpiry : null} label="Edit account expiry"
                  why={exp !== null ? "You are already editing the expiry." : canEdit ? "Account expiry is managed by this person's own account or their home company, so it can't be changed here." : NO_RECORD} />
                {exp === null ? (
                  <dl className="adm-rv" style={{ gridTemplateColumns: "190px 1fr" }}><dt>Account expires</dt><dd>{d.account.accountExpiresAt || "No expiry"}</dd></dl>
                ) : (
                  <div>
                    <label className="adm-field">Account expires on
                      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input className="input" type="date" autoFocus style={{ maxWidth: 220 }} value={exp} disabled={savingExp} onChange={(e) => setExp(e.target.value)} />
                        {exp && <button type="button" className="adm-link" disabled={savingExp} onClick={() => setExp("")}>Clear</button>}
                      </span>
                      <span className="adm-hint">{exp ? "They can sign in until the end of that day." : "No expiry: the account stays valid until it is blocked or removed."}</span>
                    </label>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
                      <button type="button" className="btn-primary-sm" disabled={!expDirty || savingExp} onClick={saveExpiry}>{savingExp ? "Saving…" : "Save changes"}</button>
                      <button type="button" className="adm-btn-outline" disabled={savingExp} onClick={() => setExp(null)}>Cancel</button>
                      {expDirty && !savingExp && <span className="adm-hint" style={{ margin: 0 }}>Not saved yet</span>}
                    </div>
                  </div>
                )}
              </>
            )}
            {tab === 2 && (
              <>
                <GroupHead title="Membership" onEdit={null} label="Edit membership" why="Membership is changed with Block sign-in or Delete user in the actions above." />
                <dl className="adm-rv" style={{ gridTemplateColumns: "190px 1fr" }}>
                  <dt>This company</dt><dd>{d.organization.status === "active" ? "Active member" : d.organization.status}</dd>
                  <dt>Other companies</dt><dd>{d.organization.otherOrganizations ? `Also belongs to ${d.organization.otherOrganizations} other ${d.organization.otherOrganizations === 1 ? "company" : "companies"} (not shown to you)` : "None"}</dd>
                </dl>
                <GroupHead title="Role and profile" onEdit={d.organization.role !== "OWNER" && !orgEditing && !rolesDirty ? () => { setErr(""); setMsg(""); setOrgEditing(true); } : null} label="Edit organization role and business profile"
                  why={d.organization.role === "OWNER" ? "The company Owner's role can't be changed here." : "You are already editing the role and profile."} />
                {orgEditing || rolesDirty ? roleEditor(true) : (
                  <dl className="adm-rv" style={{ gridTemplateColumns: "190px 1fr" }}>
                    <dt>Organization role</dt><dd>{d.organization.role}</dd>
                    <dt>Business profile</dt><dd>{d.organization.profile || "—"}</dd>
                  </dl>
                )}
              </>
            )}
            {tab === 3 && (
              <div>
                <GroupHead title="Application access" label={"Edit application access for " + title} onEdit={appsEditable && !appStage ? startApps : undefined} why={appsEditable ? "" : appsWhy} />
                <table className="table"><thead><tr><th>Application</th><th>Access</th><th>App role</th><th>Source</th></tr></thead>
                  <tbody>{d.apps.map((a) => {
                    const base = savedApp(a);
                    const cur = appStage ? (appStage[a.appId] || base) : base;
                    const notHeld = ["app_not_enabled", "app_not_licensed"].includes(a.reason);
                    const fixed = a.source === "owner" || savingApps;
                    return (
                      <tr key={a.appId}>
                        <td>{appName(a.appId)}</td>
                        {appStage ? (
                          <>
                            <td><label><input type="checkbox" checked={cur.granted} disabled={fixed || (notHeld && !cur.granted)} aria-label={"Access to " + appName(a.appId)}
                              onChange={(e) => setAppStage((st) => stageApp(st, d.apps, a.appId, { granted: e.target.checked }))} /> {cur.granted ? "Yes" : "No"}</label>
                              {notHeld && !cur.granted && <span className="muted"> (not enabled for this company)</span>}</td>
                            <td><select className="input" style={{ maxWidth: 130 }} value={cur.admin ? "ADMIN" : "MEMBER"} disabled={fixed || !cur.granted || !canAssignAdmin}
                              aria-label={"Role in " + appName(a.appId)} onChange={(e) => setAppStage((st) => stageApp(st, d.apps, a.appId, { admin: e.target.value === "ADMIN" }))}>
                              <option value="MEMBER">Member</option><option value="ADMIN">Admin</option></select></td>
                            <td>{a.source === "owner" ? "Company owner" : cur.granted ? "Assigned" : "—"}</td>
                          </>
                        ) : (
                          <>
                            <td>{a.access ? "Yes" : "No"}{!a.access && a.reason ? <span className="muted"> ({a.reason.replace(/_/g, " ")})</span> : null}</td>
                            <td>{a.access ? (a.appRole === "ADMIN" ? "Admin" : "Member") : "—"}</td>
                            <td>{a.access ? (a.source === "owner" ? "Company owner" : "Assigned") : "—"}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}</tbody></table>
                {appStage && !canAssignAdmin && <span className="adm-hint">Only the Owner can make or remove an app Admin.</span>}
                {appStage && <span className="adm-hint">An app can only be granted if your company has it enabled. Licences and plans are managed in the company's billing, not here.</span>}
                {appStage && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
                    <button type="button" className="btn-primary-sm" disabled={!appChangeList.length || savingApps} onClick={saveApps}>{savingApps ? "Saving…" : "Save changes"}</button>
                    <button type="button" className="adm-btn-outline" disabled={savingApps} onClick={() => setAppStage(null)}>Cancel</button>
                    {appChangeList.length > 0 && !savingApps && <span className="adm-hint" style={{ margin: 0 }}>Not saved yet</span>}
                  </div>
                )}
              </div>
            )}
            {tab === 4 && (
              <div>
                <p className="muted" style={{ marginTop: 0 }}>The organization role controls what they can do in the company (users, roles, app assignment). It grants no application permission.</p>
                <p><b>Current:</b> {d.organization.role} <span className="muted">({ORG_SOURCE[d.organization.roleSource] || d.organization.roleSource})</span></p>
                {roleEditor(false)}
              </div>
            )}
            {tab === 5 && (d.activity.length === 0 ? <p className="muted">No recorded activity yet.</p> : (
              <ul className="adm-activity">{d.activity.map((x, i) => (<li key={i}><b>{ACTION[x.action] || x.action}</b><span className="muted"> · {x.by} · {when(x.at)}</span></li>))}</ul>
            ))}
          </div>
        </>
      )}
    </Drawer>
    {confirmDialog}
    </>
  );
}
