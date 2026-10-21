"use client";
// Reset password drawer (Microsoft-style): who, how they sign in, generate or set a temporary password, require a change, confirm, hand over once.
import { useEffect, useState } from "react";
import Drawer from "./Drawer";
import { passwordStrength } from "@/lib/adminPassword";

const LOGIN = { google: "Google", email: "Email and password", username: "Bizzux username", "attendance-username": "Attendance username" };

export default function ResetPasswordDrawer({ open, user, api, onClose, onDone, onSendEmail }) {
  const [custom, setCustom] = useState(false);
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [must, setMust] = useState(true);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (open) { setCustom(false); setPw(""); setShow(false); setMust(true); setSure(false); setBusy(false); setErr(""); setRes(null); setCopied(false); } }, [open, user?.uid]);
  if (!user) return null;
  const strength = passwordStrength(pw);
  const username = user.loginKind === "username";
  const legacyAtt = user.loginKind === "attendance-username";
  const canSubmit = username && sure && (!custom || strength.ok) && !busy;
  async function submit() {
    setBusy(true); setErr("");
    try { const r = await api("/api/iam/identities", "POST", { kind: "resetPassword", uid: user.uid, password: custom ? pw : "", mustChange: must }); setRes(r); onDone?.(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  const copy = async () => { try { await navigator.clipboard.writeText(`Username: ${res.username}\nTemporary password: ${res.password}`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } };
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || user.email;
  return (
    <Drawer open={open} title="Reset password" onClose={onClose} size="narrow"
      footer={res ? <button type="button" className="btn-primary-sm" onClick={onClose}>Done</button> : (
        <>
          {username && <button type="button" className="btn-primary-sm" onClick={submit} disabled={!canSubmit}>{busy ? "Resetting…" : "Reset password"}</button>}
          <button type="button" className="btn-outline-dark" onClick={onClose}>Cancel</button>
        </>
      )}>
      <dl className="adm-rv" style={{ gridTemplateColumns: "110px 1fr" }}>
        <dt>Person</dt><dd>{name}</dd>
        <dt>Sign-in</dt><dd>{user.email || (user.username ? "@" + user.username : "")}<div className="muted" style={{ fontSize: 12 }}>{LOGIN[user.loginKind] || ""}</div></dd>
      </dl>
      {res ? (
        <div className="adm-cred" role="group" aria-label="New sign-in details, shown once">
          <b>Save this now. It is shown only once.</b>
          <div>Username: <code>{res.username}</code></div>
          <div>Temporary password: <code>{res.password}</code> <button type="button" className="adm-link" onClick={copy}>{copied ? "Copied" : "Copy"}</button></div>
          <p className="muted" style={{ marginBottom: 0 }}>{res.mustChange ? "They must choose their own password when they sign in. " : ""}They have been signed out everywhere. Give these details to them in a secure way.</p>
        </div>
      ) : !username ? (
        <div className="adm-warn" role="status">
          {legacyAtt ? "This is an Attendance-only username login. Reissue its one-time code from the person's profile in Attendance." : user.loginKind === "google"
            ? "This person signs in with Google, so their password is managed by Google. It can't be reset here."
            : "This person signs in with their own email and password. They can reset it themselves, or you can send them a reset email."}
          {user.loginKind === "email" && onSendEmail && <div style={{ marginTop: 8 }}><button type="button" className="btn-outline-dark" onClick={() => { onSendEmail(user); onClose(); }}>Send password-reset email</button></div>}
        </div>
      ) : (
        <>
          <label className="adm-check"><input type="checkbox" checked={!custom} onChange={(e) => { setCustom(!e.target.checked); setPw(""); }} /> Automatically create a password</label>
          {custom && (
            <div className="adm-field">
              <label className="adm-lab" htmlFor="rp-pw">Temporary password <span className="adm-req" aria-hidden="true">*</span></label>
              <div className="adm-pw"><input id="rp-pw" className="input" data-autofocus type={show ? "text" : "password"} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /><button type="button" className="adm-link" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button></div>
              <div className={"adm-meter l" + strength.level} role="status"><span /><span /><span /><em>{strength.label}</em></div>
              <div className="adm-hint">Your company's password policy is checked when you reset.</div>
            </div>
          )}
          <label className="adm-check"><input type="checkbox" checked={must} onChange={(e) => setMust(e.target.checked)} /> Require this user to change their password when they next sign in</label>
          <label className="adm-check"><input type="checkbox" data-autofocus={!custom ? "" : undefined} checked={sure} onChange={(e) => setSure(e.target.checked)} /> I understand {name} will be signed out everywhere and their current password stops working.</label>
          {err && <p className="error" role="alert">{err}</p>}
        </>
      )}
    </Drawer>
  );
}
