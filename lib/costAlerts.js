// SERVER ONLY. Emails the Platform Owner when the Cost & Usage anomaly
// detector raises HIGH-severity alerts, so a runaway customer/module is
// noticed even when nobody has the dashboard open. Each alert is emailed at
// most once per day (state in platformFinance/costAlertState).
import { Resend } from "resend";
import { adminDb } from "./firebaseAdmin";
import { dateKey } from "./costAnalytics";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export async function notifyHighAlerts(alerts) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = (process.env.PLATFORM_OWNER_EMAIL || "info.bizzux@gmail.com").toLowerCase();
  const high = alerts.filter((a) => a.severity === "high");
  if (!apiKey || !high.length) return { sent: 0 };

  const ref = adminDb().doc("platformFinance/costAlertState");
  const today = dateKey();
  const state = (await ref.get()).data() || {};
  const notified = state.notified && state.notified.day === today ? state.notified.keys || [] : [];
  const keyOf = (a) => [a.level, a.orgId || "", a.module || "", a.title].join("|");
  const fresh = high.filter((a) => !notified.includes(keyOf(a)));
  if (!fresh.length) return { sent: 0 };

  const rows = fresh.slice(0, 15).map((a) => `<li style="margin-bottom:8px"><strong>${esc(a.title)}</strong><br><span style="color:#64748b">${esc(a.detail)}</span></li>`).join("");
  const from = process.env.RESEND_FROM_EMAIL || "Bizzux <verify@verify.bizzux.com>";
  await new Resend(apiKey).emails.send({
    from,
    to,
    subject: `Bizzux alert: unusual cloud usage (${fresh.length})`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px"><h2 style="margin:0 0 8px">Unusual cloud usage detected</h2><p style="color:#475569">These customers/modules are reading and writing far more than their recent normal, which can drive up your Google Cloud bill.</p><ul style="padding-left:18px">${rows}</ul><p><a href="https://www.bizzux.com/admin">Open Platform Admin → Cost &amp; Usage</a></p></div>`,
  });
  await ref.set({ notified: { day: today, keys: [...notified, ...fresh.map(keyOf)] } }, { merge: true });
  return { sent: fresh.length };
}
