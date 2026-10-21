// Email to the people who can decide a join request. Uses the existing Resend setup (RESEND_API_KEY / RESEND_FROM_EMAIL) and nothing else; it is
// best-effort and NEVER fails or delays the request (in-app notification remains the source of truth). No requester message text is included,
// only their name, so a request cannot be used to send arbitrary content to an administrator.
import { Resend } from "resend";
import { adminAuth } from "./firebaseAdmin";

let mailer = null; // tests inject one
export const setJoinMailer = (fn) => { mailer = fn; };

const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function notifyApprovers({ uids, requesterName, orgName, origin }) {
  try {
    const send = mailer || (process.env.RESEND_API_KEY ? async (m) => { await new Resend(process.env.RESEND_API_KEY).emails.send({ from: process.env.RESEND_FROM_EMAIL || "Bizzux <verify@verify.bizzux.com>", ...m }); } : null);
    if (!send || !uids?.length) return { sent: 0 };
    const emails = [];
    for (const uid of uids.slice(0, 10)) { try { const u = await adminAuth().getUser(uid); if (u.email && u.emailVerified && !u.disabled) emails.push(u.email); } catch { /* skip */ } }
    const url = (origin || process.env.NEXT_PUBLIC_WWW_ORIGIN || "https://www.bizzux.com") + "/team";
    for (const to of emails) {
      await send({ to, subject: `${requesterName || "Someone"} asked to join ${orgName || "your company"} on Bizzux`,
        html: `<p>${esc(requesterName || "A person")} asked to join <b>${esc(orgName || "your company")}</b>.</p><p><a href="${esc(url)}">Review the request</a> (Users, then Join requests). It stays pending until an administrator approves it.</p>` });
    }
    return { sent: emails.length };
  } catch { return { sent: 0 }; }
}
