"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";

// Chart + data-fetching logic for the Analytics sub-tab of /admin. Extracted
// from what used to be the standalone /analytics page (now folded into
// AdminTabs.tsx as its third sub-tab) so the charts stay in one place
// instead of duplicated. Takes the already-signed-in `user` from AdminTabs
// (which has already confirmed Super Admin before rendering this) and does
// its own fetch of /api/admin/analytics.

const STATUS_META = {
  active: { label: "Active", color: "#16a34a" },
  trial: { label: "Trial", color: "#1F51FF" },
  past_due: { label: "Past due", color: "#f59e0b" },
  cancelled: { label: "Cancelled", color: "#dc2626" },
};
const STATUS_ORDER = ["active", "trial", "past_due", "cancelled"];

function formatINR(n) {
  return "₹" + Math.round(n || 0).toLocaleString("en-IN");
}

// angleDeg is clockwise from 12 o'clock (0deg = top), matching how a donut
// chart is normally read.
function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

// Builds one stroked arc from startAngle to endAngle. Clamped just short of
// a full 360deg turn — an SVG arc command can't draw a true full circle
// (its start and end points would coincide and the arc degenerates to
// nothing), so a lone segment that's 100% of the total is drawn 0.05deg
// short instead; at this chart's size that's a fraction of a pixel and
// still reads as a complete ring.
function arcPath(cx, cy, r, startAngle, endAngle) {
  const clampedEnd = Math.min(endAngle, startAngle + 359.95);
  const p0 = polarToCartesian(cx, cy, r, startAngle);
  const p1 = polarToCartesian(cx, cy, r, clampedEnd);
  const largeArcFlag = clampedEnd - startAngle > 180 ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${p1.x} ${p1.y}`;
}

// Dependency-free donut chart (explicit SVG arc paths) so the status
// breakdown reads at a glance instead of as a bare number list. Hovering a
// segment dims the rest and shows a tooltip with its exact count and share
// of the total, pinned to the middle of that segment's arc.
function StatusDonut({ byStatus, size = 132, thickness = 20 }) {
  const [hoveredKey, setHoveredKey] = useState(null);
  const segments = STATUS_ORDER.map((key) => ({ key, value: byStatus[key] || 0, ...STATUS_META[key] }));
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  // Each segment's end angle is nudged a hair past its true boundary so it
  // overlaps the next segment's start instead of butting exactly against
  // it. Extending only forward, never pulling a start back, leaves exactly
  // one seam-prone edge per boundary, which this always covers regardless
  // of how uneven the segments are.
  const overlapDeg = 0.6;
  let cumulative = 0;

  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const pct = s.value / total;
      const startAngle = cumulative * 360;
      const midAngle = (cumulative + pct / 2) * 360;
      const endAngle = (cumulative + pct) * 360 + overlapDeg;
      cumulative += pct;
      return { ...s, pct, startAngle, midAngle, endAngle };
    });

  const hovered = arcs.find((a) => a.key === hoveredKey) || null;
  const tooltipPos = hovered ? polarToCartesian(cx, cy, r, hovered.midAngle) : null;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} onMouseLeave={() => setHoveredKey(null)}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
        {arcs.map((s) => (
          <path
            key={s.key}
            d={arcPath(cx, cy, r, s.startAngle, s.endAngle)}
            fill="none"
            stroke={s.color}
            strokeWidth={thickness}
            opacity={hoveredKey && hoveredKey !== s.key ? 0.28 : 1}
            style={{ cursor: "pointer", transition: "opacity 0.15s ease" }}
            onMouseEnter={() => setHoveredKey(s.key)}
          />
        ))}
        <text x="50%" y="46%" textAnchor="middle" fontSize="22" fontWeight="800" fill="#0f172a">{total}</text>
        <text x="50%" y="63%" textAnchor="middle" fontSize="10.5" fill="#64748b">signups</text>
      </svg>
      {hovered && tooltipPos && (
        <div
          style={{
            position: "absolute",
            left: tooltipPos.x,
            top: tooltipPos.y,
            transform: "translate(-50%, -130%)",
            background: "#0f172a",
            color: "#fff",
            fontSize: 11.5,
            fontWeight: 600,
            padding: "6px 10px",
            borderRadius: 8,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            boxShadow: "0 6px 18px rgba(15,23,42,0.25)",
            zIndex: 5,
          }}
        >
          {hovered.label} · {hovered.value} ({Math.round(hovered.pct * 100)}%)
        </div>
      )}
    </div>
  );
}

// Horizontal progress-style bar per plan, scaled against the highest MRR
// figure in the set — brand-gradient fill for a bit of polish instead of a
// plain data table.
function RevenueBars({ items }) {
  const max = Math.max(1, ...items.map((i) => i.monthlyRevenue));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {items.map((i) => (
        <div key={i.planId}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {i.name} <span style={{ fontWeight: 500, color: "var(--muted)" }}>· {i.activeCount} customer{i.activeCount === 1 ? "" : "s"}</span>
            </span>
            <span style={{ fontSize: 13, fontWeight: 800 }}>{formatINR(i.monthlyRevenue)}</span>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: "#f1f5f9", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: Math.max(4, (i.monthlyRevenue / max) * 100) + "%",
                background: "var(--brand-gradient)",
                borderRadius: 999,
                transition: "width 0.6s ease",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// Rolling 12-week new-signups trend (one bar per week, oldest to newest).
// Single series, so it stays one brand hue throughout rather than a
// categorical palette — matching RevenueBars' fill. Only the peak week's
// count is called out directly on the chart; every other bar's exact value
// is reachable via its title tooltip on hover instead of labeling all 12.
function SignupTrend({ data }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const peakIdx = data.reduce((best, d, i) => (d.count > data[best].count ? i : best), 0);
  const chartHeight = 120;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: chartHeight, marginBottom: 8 }}>
        {data.map((d, i) => (
          <div
            key={i}
            title={`${d.label}: ${d.count} signup${d.count === 1 ? "" : "s"}`}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}
          >
            <span
              style={{
                fontSize: 10.5, fontWeight: 700, color: "var(--text)", marginBottom: 4,
                visibility: i === peakIdx && d.count > 0 ? "visible" : "hidden",
              }}
            >
              {d.count}
            </span>
            <div
              style={{
                width: "100%",
                maxWidth: 26,
                height: Math.max(3, (d.count / max) * (chartHeight - 26)) + "px",
                background: "var(--brand-gradient)",
                borderRadius: "4px 4px 0 0",
                transition: "height 0.6s ease",
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 9, color: "var(--muted)" }}>
            {i % 2 === 0 ? d.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsPanel({ user }) {
  const [data, setData] = useState(null); // null = loading
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const t = await user.getIdToken();
        const r = await fetch("/api/admin/analytics", { headers: { Authorization: "Bearer " + t } });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load analytics.");
        setData(d);
      } catch (e) {
        setErr(e.message || "Could not load analytics.");
      }
    })();
  }, [user]);

  return (
    <div>
      {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}
      {data === null && !err && <p className="muted">Loading…</p>}

      {data && (
        <>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 18 }}>
            <div className="card">
              <div className="label">Total signups</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{data.totalCustomers}</div>
            </div>
            <div className="card">
              <div className="label">MRR (estimated)</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{formatINR(data.mrr)}</div>
            </div>
            <div className="card">
              <div className="label">Trial-to-paid conversion</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>
                {data.conversionRate === null ? "N/A" : Math.round(data.conversionRate * 100) + "%"}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
            <div className="card">
              <h3 style={{ marginBottom: 14, fontSize: 14.5 }}>By status</h3>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 40, flexWrap: "wrap" }}>
                <StatusDonut byStatus={data.byStatus} size={152} thickness={22} />
                <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minWidth: 150, marginLeft: 8 }}>
                  {STATUS_ORDER.map((s) => (
                    <div key={s} className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 999, background: STATUS_META[s].color, display: "inline-block" }} />
                        {STATUS_META[s].label}
                      </span>
                      <strong style={{ fontSize: 13 }}>{data.byStatus[s] || 0}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginBottom: 14, fontSize: 14.5 }}>Revenue by plan</h3>
              {data.byPlan.length === 0 && <p className="muted">No active subscriptions yet.</p>}
              {data.byPlan.length > 0 && <RevenueBars items={data.byPlan} />}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 2, fontSize: 14.5 }}>New signups</h3>
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 16 }}>
              {data.signupsByWeek.reduce((sum, w) => sum + w.count, 0)} signups over the last 12 weeks
            </p>
            <SignupTrend data={data.signupsByWeek} />
          </div>
        </>
      )}
    </div>
  );
}
