// SERVER ONLY. Email notifications for the support workflow, sent through
// Resend (same sender and API key as the other transactional emails).
//
//   customer raises a case / replies  -> support staff   (assignee, else everyone who can work tickets)
//   staff replies publicly / resolves -> the customer    (the person who raised the case)
//
// Rules: best-effort (a mail failure never fails the case or the reply), no
// attachments or internal notes are ever included, staff mails for follow-up
// customer replies are throttled per ticket, and SUPPORT_EMAILS_DISABLED=1 turns
// everything off. SUPPORT_NOTIFY_EMAILS (comma separated) overrides who staff mails go to.
import { adminDb } from "./firebaseAdmin";
import { hasPermission } from "./platformRoles";

const ADMIN_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.bizzux.com";
const APP_URLS = {
  attendance: "https://attendance.bizzux.com", notes: "https://notes.bizzux.com", files: "https://files.bizzux.com",
  projects: "https://projects.bizzux.com", chat: "https://chat.bizzux.com", crm: "https://crm.bizzux.com", mail: "https://mail.bizzux.com",
  capture: "https://capture.bizzux.com", finance: "https://finance.bizzux.com",
};
export const STAFF_FOLLOWUP_THROTTLE_MS = 10 * 60 * 1000;
const BRAND = "linear-gradient(100deg, #28bfac 0%, #2159d4 100%)";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n) + "…" : String(s));

function shell({ heading, bodyHtml, button }) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f8fb;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;">
<tr><td style="background:${BRAND};padding:24px 32px;"><span style="font-size:22px;font-weight:800;color:#ffffff;">bizzux</span></td></tr>
<tr><td style="padding:28px 32px;"><h1 style="margin:0 0 14px;font-size:19px;color:#0f172a;">${esc(heading)}</h1>${bodyHtml}
${button ? `<p style="margin:22px 0 0;"><a href="${esc(button.href)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:999px;font-weight:700;font-size:14px;">${esc(button.label)}</a></p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
}
const quote = (text) => `<div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:14px;color:#0f172a;white-space:pre-wrap;">${esc(clip(text, 1500))}</div>`;

// Default transport: Resend. Tests replace it with setMailer().
let mailer = async ({ to, subject, html }) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { skipped: "RESEND_API_KEY not set" };
  const { Resend } = await import("resend");
  const from = process.env.RESEND_FROM_EMAIL || "Bizzux <verify@verify.bizzux.com>";
  const { error } = await new Resend(apiKey).emails.send({ from, to, subject, html });
  if (error) throw new Error(error.message || "send failed");
  return { sent: true };
};
export function setMailer(fn) { const prev = mailer; mailer = fn; return prev; }

async function send(msg) {
  if (process.env.SUPPORT_EMAILS_DISABLED === "1") return { skipped: "disabled" };
  try { return await mailer(msg); } catch (e) { console.error("support email failed:", msg.subject, e?.message || e); return { error: String(e?.message || e) }; }
}

// Who hears about new work: the assignee, otherwise everyone active who can work tickets.
export async function staffRecipients(ticket) {
  const override = (process.env.SUPPORT_NOTIFY_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);
  if (override.length) return override;
  if (ticket.assigneeEmail) return [ticket.assigneeEmail];
  const snap = await adminDb().collection("platformAdmins").get();
  return snap.docs.map((d) => d.data()).filter((d) => d.email && d.status !== "disabled" && hasPermission(d.role, d.permissions, "support.tickets")).map((d) => d.email);
}

const adminLink = (t) => `${ADMIN_URL}/admin#org=${encodeURIComponent(t.organizationId)}&tab=support`;

export async function notifyStaffNewCase(ticketId, t) {
  const to = await staffRecipients(t);
  if (!to.length) return { skipped: "no recipients" };
  return send({
    to, subject: `[${t.code}] New case from ${t.organizationName || "a customer"}: ${clip(t.subject, 80)}`,
    html: shell({
      heading: `New support case ${t.code}`,
      bodyHtml: `<p style="margin:0 0 8px;font-size:14px;color:#334155;"><strong>${esc(t.organizationName)}</strong> · ${esc(t.requesterName || t.requesterEmail || "")} · via the ${esc(t.appKey || "app")} app</p>
<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#0f172a;">${esc(t.subject)}</p>${quote(t.description)}
${t.attachments?.length ? `<p style="margin:10px 0 0;font-size:13px;color:#64748b;">${t.attachments.length} screenshot${t.attachments.length === 1 ? "" : "s"} attached (open the case to view them).</p>` : ""}`,
      button: { label: "Open the case", href: adminLink(t) },
    }),
  });
}

// Throttled: a customer who sends several replies in a row triggers one mail per window.
export async function notifyStaffCustomerReply(ticketId, t, text) {
  const last = t.lastStaffEmailAtMs || 0;
  if (Date.now() - last < STAFF_FOLLOWUP_THROTTLE_MS) return { skipped: "throttled" };
  const to = await staffRecipients(t);
  if (!to.length) return { skipped: "no recipients" };
  const r = await send({
    to, subject: `[${t.code}] Customer replied: ${clip(t.subject, 80)}`,
    html: shell({
      heading: `${t.requesterName || t.requesterEmail || "The customer"} replied on ${t.code}`,
      bodyHtml: `<p style="margin:0 0 8px;font-size:14px;color:#334155;"><strong>${esc(t.organizationName)}</strong> · ${esc(t.subject)}</p>${quote(text)}`,
      button: { label: "Reply in the workspace", href: adminLink(t) },
    }),
  });
  if (r.sent) await adminDb().doc("supportTickets/" + ticketId).update({ lastStaffEmailAtMs: Date.now() }).catch(() => {});
  return r;
}

function appLink(t) {
  const base = APP_URLS[t.appKey];
  return base ? { label: "Open " + t.appKey.charAt(0).toUpperCase() + t.appKey.slice(1) + " and view your case", href: base } : null;
}

export async function notifyCustomerReply(t, text) {
  if (t.source !== "app" || !t.requesterEmail) return { skipped: "not an app case" };
  return send({
    to: t.requesterEmail, subject: `[${t.code}] Bizzux support replied: ${clip(t.subject, 80)}`,
    html: shell({
      heading: "Bizzux support replied to your case",
      bodyHtml: `<p style="margin:0 0 10px;font-size:14px;color:#334155;">${esc(t.code)} · ${esc(t.subject)}</p>${quote(text)}
<p style="margin:14px 0 0;font-size:13px;color:#64748b;">To answer, open the app, tap <strong>Help</strong>, then <strong>My cases</strong>. Replies to this email aren't monitored.</p>`,
      button: appLink(t),
    }),
  });
}

export async function notifyCustomerResolved(t) {
  if (t.source !== "app" || !t.requesterEmail) return { skipped: "not an app case" };
  return send({
    to: t.requesterEmail, subject: `[${t.code}] Marked resolved: ${clip(t.subject, 80)}`,
    html: shell({
      heading: "Your case was marked resolved",
      bodyHtml: `<p style="margin:0 0 10px;font-size:14px;color:#334155;">${esc(t.code)} · ${esc(t.subject)}</p>
<p style="margin:0;font-size:14px;color:#0f172a;">If it still isn't right, open <strong>Help → My cases</strong> in the app and reply; that reopens the case.</p>`,
      button: appLink(t),
    }),
  });
}
