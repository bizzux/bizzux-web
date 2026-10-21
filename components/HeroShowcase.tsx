"use client";

import { useEffect, useRef } from "react";
import { Caveat } from "next/font/google";

const hand = Caveat({ subsets: ["latin"], weight: ["600", "700"] });

/* ------------------------------------------------------------------ *
 * Animated app icons. Each is a 24x24 glyph whose own parts move
 * (check draws itself, chat dots type, bars grow, globe spins ...).
 * Classes `a-*` are animated in CSS below.
 * ------------------------------------------------------------------ */
const G = { fill: "none", stroke: "#fff", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const GLYPH: Record<string, JSX.Element> = {
  Attendance: (
    <g {...G}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
      <path className="a-check" d="m8.5 15 2.5 2.5 4.5-5" />
    </g>
  ),
  Payroll: (
    <g {...G}>
      <ellipse className="a-coin" cx="12" cy="12" rx="8.5" ry="8.5" />
      <path className="a-coin" d="M9.5 8h5M9.5 11h5M10 8c3.5 0 3.5 5 0 5l4 3.5" />
    </g>
  ),
  "Point of Sale": (
    <g {...G}>
      <path d="M4 4h16v16l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4z" />
      <path className="a-line l1" d="M8 9h8" />
      <path className="a-line l2" d="M8 12.5h8" />
      <path className="a-line l3" d="M8 16h4" />
    </g>
  ),
  Project: (
    <g {...G}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path className="a-k k1" d="M8 8v6" />
      <path className="a-k k2" d="M12 8v9" />
      <path className="a-k k3" d="M16 8v4" />
    </g>
  ),
  CRM: (
    <g {...G}>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.8 20v-1.5A4.5 4.5 0 0 1 7.3 14h3.4a4.5 4.5 0 0 1 4.5 4.5V20" />
      <circle className="a-pulse" cx="17.5" cy="9" r="3" />
      <path d="M21.5 19.5v-1a3.5 3.5 0 0 0-2.4-3.3" />
    </g>
  ),
  Chat: (
    <g {...G}>
      <path d="M20.5 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-4.5 4V6A2.5 2.5 0 0 1 6 3.5h12A2.5 2.5 0 0 1 20.5 6z" />
      <circle className="a-dot d1" cx="8.5" cy="10.2" r="0.6" fill="#fff" />
      <circle className="a-dot d2" cx="12" cy="10.2" r="0.6" fill="#fff" />
      <circle className="a-dot d3" cx="15.5" cy="10.2" r="0.6" fill="#fff" />
    </g>
  ),
  Email: (
    <g {...G}>
      <rect x="2.8" y="5" width="18.4" height="14" rx="3" />
      <path className="a-flap" d="m3.5 7.5 8.5 6 8.5-6" />
      <circle className="a-ping" cx="20" cy="5" r="2" fill="#fde047" stroke="none" />
    </g>
  ),
  Finance: (
    <g {...G}>
      <path className="a-bar b1" d="M6 20v-5" />
      <path className="a-bar b2" d="M12 20V9" />
      <path className="a-bar b3" d="M18 20V12" />
      <path className="a-trend" d="m4.5 9 4.5-3 4 2.5 6-5" />
    </g>
  ),
  Notes: (
    <g {...G}>
      <path d="M14.5 3H7a2.5 2.5 0 0 0-2.5 2.5v13A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5V8z" />
      <path d="M14.5 3v5h5" />
      <path className="a-line l1" d="M8 12.5h8" />
      <path className="a-line l2" d="M8 16h6" />
    </g>
  ),
  Website: (
    <g {...G}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <ellipse className="a-globe" cx="12" cy="12" rx="4" ry="9" />
    </g>
  ),
  "AI Apps": (
    <g {...G}>
      <path className="a-spark" d="M11 3.5 13 9.5l6 2-6 2-2 6-2-6-6-2 6-2z" fill="#fff" />
      <path className="a-spark2" d="M19 3v3.5M17.2 4.8h3.6" />
    </g>
  ),
};

const TILES = [
  { label: "Attendance", c1: "#34d399", c2: "#059669" },
  { label: "Payroll", c1: "#22d3ee", c2: "#0e7490" },
  { label: "Point of Sale", c1: "#fb7185", c2: "#e11d48" },
  { label: "Project", c1: "#f472b6", c2: "#c026d3" },
  { label: "CRM", c1: "#fdba74", c2: "#ea580c" },
  { label: "Chat", c1: "#a5b4fc", c2: "#4f46e5" },
  { label: "Email", c1: "#60a5fa", c2: "#1d4ed8" },
  { label: "Finance", c1: "#c4b5fd", c2: "#7c3aed" },
  { label: "Notes", c1: "#5eead4", c2: "#0d9488" },
  { label: "Website", c1: "#7dd3fc", c2: "#0284c7" },
  { label: "AI Apps", c1: "#e879f9", c2: "#7c3aed" },
];

const N = TILES.length;
const CX = 50, CY = 56, RX = 48, RY = 32; // orbit ellipse, % of the stage

// Position of tile i at orbit phase t (radians). d: 0 = far side, 1 = near side.
function place(i: number, t: number) {
  const th = t + (i * 2 * Math.PI) / N;
  const s = Math.sin(th);
  const d = (s + 1) / 2;
  return {
    x: +(CX + RX * Math.cos(th)).toFixed(3),
    y: +(CY + RY * s).toFixed(3),
    d: +d.toFixed(3),
    scale: +(0.72 + 0.26 * d).toFixed(3),
    front: s > 0.25,
  };
}

const STATS = [
  { t: "11+ Integrated Apps", d: "Everything your business needs", c: "#2563eb", p: "M13 2 4 14h7l-1 8 9-12h-7z" },
  { t: "Works on Web & Mobile", d: "Access anywhere, anytime", c: "#0ea5e9", p: "M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4.6 12 3.5 3.5 0 0 0 6 19z" },
  { t: "Trusted by Growing Businesses", d: "From startups to established teams", c: "#14b8a6", p: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" },
  { t: "Secure & Reliable", d: "Your data is always protected", c: "#0891b2", p: "M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5z M9 12l2 2 4-4" },
];

export default function HeroShowcase() {
  const stage = useRef<HTMLDivElement>(null);
  const tiles = useRef<(HTMLDivElement | null)[]>([]);
  const links = useRef<(SVGLineElement | null)[]>([]);
  const hovering = useRef(false);

  // 3D-ish orbit: tiles travel an ellipse; far-side tiles shrink, dim and sit
  // behind her, near-side tiles grow and pass in front. Eases to a stop on hover.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, t = 0, speed = reduce ? 0 : 1, last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = reduce || hovering.current ? 0 : 1;
      speed += (target - speed) * Math.min(1, dt * 4);
      t += dt * 0.16 * speed; // radians / second (~39 s per lap)
      for (let i = 0; i < N; i++) {
        const el = tiles.current[i];
        const ln = links.current[i];
        if (!el) continue;
        const p = place(i, t);
        el.style.left = `${p.x}%`;
        el.style.top = `${p.y}%`;
        el.style.transform = `translate(-50%,-50%) scale(${p.scale})`;
        el.style.opacity = String(0.55 + 0.45 * p.d);
        el.style.filter = `blur(${((1 - p.d) * 1.4).toFixed(2)}px)`;
        el.style.zIndex = p.front ? "6" : "1";
        if (ln) {
          ln.setAttribute("x2", String(p.x));
          ln.setAttribute("y2", String(p.y));
          ln.style.opacity = String(0.15 + 0.5 * p.d);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = stage.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", String(((e.clientX - r.left) / r.width - 0.5) * 2));
    el.style.setProperty("--my", String(((e.clientY - r.top) / r.height - 0.5) * 2));
  };
  const onLeave = () => {
    hovering.current = false;
    stage.current?.style.setProperty("--mx", "0");
    stage.current?.style.setProperty("--my", "0");
  };

  return (
    <section className="hx relative overflow-hidden bg-gradient-to-b from-white via-sky-50/70 to-white">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="hx-blob hx-b1" />
      <div className="hx-blob hx-b2" />

      <div className="relative mx-auto max-w-7xl px-6 pt-8 md:pt-10 pb-6">
        <div className="grid lg:grid-cols-[0.85fr_1.35fr] gap-8 lg:gap-0 items-center">
          {/* ---------- left: pitch ---------- */}
          <div>
            <div className="hx-up flex items-center gap-3 text-xs md:text-sm font-bold tracking-wide uppercase text-brand-blueDark" style={{ animationDelay: "0ms" }}>
              AI-Powered Business Management Suite
              <span className="hidden sm:block h-px w-16 bg-slate-300" />
            </div>
            <h1 className="hx-up mt-4 text-5xl md:text-6xl xl:text-6xl font-extrabold tracking-tight leading-[1.02]" style={{ animationDelay: "90ms", color: "#0b2545" }}>
              Run Your Business.
              <br />
              All Apps{" "}
              <span className="relative inline-block bg-gradient-to-r from-brand-tealDark to-brand-cyanDark bg-clip-text text-transparent">
                Together.
                <svg className="absolute left-0 -bottom-3 w-full" viewBox="0 0 260 14" fill="none" preserveAspectRatio="none" aria-hidden>
                  <path className="hx-draw" d="M3 9c60-9 140-10 254-3" stroke="#14b8a6" strokeWidth="4" strokeLinecap="round" />
                </svg>
              </span>
            </h1>
            <p className="hx-up mt-7 text-slate-600 max-w-md text-base md:text-lg leading-relaxed" style={{ animationDelay: "180ms" }}>
              Manage attendance, payroll, POS, projects, CRM, chat, email, finance, notes, website and more from one connected platform.
            </p>

            <div className="hx-up mt-7 grid grid-cols-2 gap-3 max-w-md" style={{ animationDelay: "270ms" }}>
              <div className="hx-card relative rounded-2xl border border-teal-300/70 bg-teal-50/60 p-4 pt-5">
                <span className="absolute -top-3 left-4 rounded-full bg-amber-400 px-3 py-0.5 text-xs font-bold text-white shadow">♛ Best Value</span>
                <div className="text-3xl font-extrabold" style={{ color: "#0b2545" }}>₹599<span className="text-base font-semibold"> / month</span></div>
                <div className="mt-1 font-semibold text-slate-800">All Apps Included</div>
                <div className="mt-2 border-t border-teal-200 pt-2 text-xs text-slate-500">One Platform. Unlimited Possibilities.</div>
              </div>
              <div className="hx-card rounded-2xl border border-slate-200 bg-white p-4 pt-5">
                <div className="text-3xl font-extrabold" style={{ color: "#0b2545" }}>₹299<span className="text-base font-semibold"> / month</span></div>
                <div className="mt-1 text-slate-500">Single App Plan</div>
                <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500">Choose the app you need</div>
              </div>
            </div>

            <div className="hx-up mt-6 flex flex-wrap gap-3" style={{ animationDelay: "360ms" }}>
              <a href="/sign-in?mode=signup" className="hx-cta inline-flex items-center gap-2 justify-center rounded-full h-14 px-9 text-base font-semibold bg-gradient-to-r from-brand-tealDark to-brand-blueDark shadow-lg shadow-teal-500/25" style={{ color: "#ffffff" }}>
                Start Free Trial <span aria-hidden>→</span>
              </a>
              <a href="/contact" className="hx-card inline-flex items-center justify-center rounded-full h-14 px-9 text-base font-semibold bg-white text-ink border border-slate-200 shadow-sm hover:border-brand-blue">
                Book a Demo
              </a>
            </div>
          </div>

          {/* ---------- right: 3D app orbit around the photo ---------- */}
          <div className="hx-up" style={{ animationDelay: "200ms" }}>
            <div
              ref={stage}
              onPointerMove={onMove}
              onPointerEnter={() => { hovering.current = true; }}
              onPointerLeave={onLeave}
              className="hx-stage relative mx-auto aspect-[1/0.95] w-full max-w-[820px]"
            >
              <div className="hx-glow" />
              <div className="hx-grid" />

              {/* orbit track, travelling data packets and energy links to her */}
              <svg className="hx-orbit" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                <defs>
                  <linearGradient id="hxg" x1="0" x2="1">
                    <stop offset="0" stopColor="#22d3ee" />
                    <stop offset="1" stopColor="#8b5cf6" />
                  </linearGradient>
                </defs>
                <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill="none" stroke="#bae6fd" strokeWidth="0.25" strokeDasharray="0.8 1.6" />
                <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill="none" stroke="url(#hxg)" strokeWidth="0.7" strokeLinecap="round" pathLength={100} className="hx-comet" />
                <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill="none" stroke="#2dd4bf" strokeWidth="0.55" strokeLinecap="round" pathLength={100} className="hx-comet c2" />
                {TILES.map((t, i) => (
                  <line key={t.label} ref={(el) => { links.current[i] = el; }} x1={CX} y1={CY - 4} x2={place(i, 0).x} y2={place(i, 0).y} stroke={t.c2} strokeWidth="0.22" strokeDasharray="1 1.4" className="hx-link" />
                ))}
              </svg>

              {TILES.map((t, i) => {
                const p = place(i, 0);
                return (
                  <div
                    key={t.label}
                    ref={(el) => { tiles.current[i] = el; }}
                    className="hx-pos"
                    style={{ left: `${p.x}%`, top: `${p.y}%`, transform: `translate(-50%,-50%) scale(${p.scale})`, zIndex: p.front ? 6 : 1, ["--c1" as string]: t.c1, ["--c2" as string]: t.c2 }}
                  >
                    <div className="hx-tile" style={{ animationDelay: `${i * -0.55}s` }}>
                      <i className="hx-edge" />
                      <i className="hx-scan" style={{ animationDelay: `${i * -0.7}s` }} />
                      <span className="hx-ico">
                        <svg viewBox="0 0 24 24" aria-hidden>{GLYPH[t.label]}</svg>
                      </span>
                      <span className="hx-lbl">{t.label}</span>
                      <b className="hx-live" />
                    </div>
                  </div>
                );
              })}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/hero-girl.webp"
                alt="A smiling Bizzux customer presenting the Bizzux apps"
                width={660}
                height={602}
                className="hx-girl"
              />

              <div className={`hx-note hx-n1 ${hand.className}`}>One Login<br />for Everything</div>
              <div className={`hx-note hx-n2 ${hand.className}`}>Powered by AI<br />Work Smarter</div>
              <span className="hx-spark hx-s1" /><span className="hx-spark hx-s2" /><span className="hx-spark hx-s3" />
            </div>
          </div>
        </div>

        {/* ---------- trust strip ---------- */}
        <div className="hx-up relative z-10 mt-4 rounded-2xl bg-white/90 backdrop-blur border border-slate-100 shadow-md grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 lg:divide-x divide-slate-100" style={{ animationDelay: "480ms" }}>
          {STATS.map((x) => (
            <div key={x.t} className="hx-stat flex items-center gap-4 px-6 py-4">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={x.c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden><path d={x.p} /></svg>
              <div>
                <div className="font-semibold text-ink text-sm md:text-base">{x.t}</div>
                <div className="text-xs md:text-sm text-slate-500">{x.d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const CSS = `
.hx-up{opacity:0;transform:translateY(18px);animation:hx-up .7s cubic-bezier(.2,.7,.2,1) forwards}
@keyframes hx-up{to{opacity:1;transform:none}}
.hx-blob{position:absolute;border-radius:9999px;filter:blur(70px);opacity:.5;pointer-events:none}
.hx-b1{width:420px;height:420px;background:#bae6fd;top:-120px;right:8%;animation:hx-drift 16s ease-in-out infinite alternate}
.hx-b2{width:360px;height:360px;background:#99f6e4;bottom:-100px;left:-60px;animation:hx-drift 20s ease-in-out infinite alternate-reverse}
@keyframes hx-drift{to{transform:translate(40px,30px) scale(1.12)}}
.hx-draw{stroke-dasharray:300;stroke-dashoffset:300;animation:hx-draw 1.1s .7s ease-out forwards}
@keyframes hx-draw{to{stroke-dashoffset:0}}
.hx-card{transition:transform .25s,box-shadow .25s}
.hx-card:hover{transform:translateY(-4px);box-shadow:0 14px 30px -12px rgba(8,145,178,.35)}
.hx-cta{transition:transform .25s,box-shadow .25s}
.hx-cta:hover{transform:translateY(-2px) scale(1.03);box-shadow:0 16px 34px -10px rgba(20,184,166,.55)}
.hx-stat svg{transition:transform .3s}.hx-stat:hover svg{transform:scale(1.15) rotate(-6deg)}

.hx-stage{--mx:0;--my:0;container-type:size}
.hx-glow{position:absolute;inset:12%;border-radius:9999px;background:radial-gradient(circle,rgba(125,211,252,.6),rgba(167,139,250,.18) 50%,transparent 72%);animation:hx-pulse 5s ease-in-out infinite;transform:translate(calc(var(--mx)*-10px),calc(var(--my)*-10px))}
@keyframes hx-pulse{50%{transform:scale(1.08) translate(calc(var(--mx)*-10px),calc(var(--my)*-10px));opacity:.8}}
.hx-grid{position:absolute;left:4%;right:4%;top:52%;height:46%;background-image:linear-gradient(rgba(56,189,248,.22) 1px,transparent 1px),linear-gradient(90deg,rgba(56,189,248,.22) 1px,transparent 1px);background-size:32px 32px;transform:perspective(380px) rotateX(64deg);transform-origin:top;-webkit-mask-image:radial-gradient(ellipse at 50% 0,#000 20%,transparent 70%);mask-image:radial-gradient(ellipse at 50% 0,#000 20%,transparent 70%);animation:hx-grid 3s linear infinite}
@keyframes hx-grid{to{background-position:0 32px}}
.hx-orbit{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;overflow:visible}
.hx-comet{stroke-dasharray:7 93;animation:hx-run 4.2s linear infinite;filter:drop-shadow(0 0 1.2px #22d3ee)}
.hx-comet.c2{stroke-dasharray:3 97;animation-duration:6.5s;animation-direction:reverse}
@keyframes hx-run{to{stroke-dashoffset:-100}}
.hx-link{animation:hx-flow 1.4s linear infinite}
@keyframes hx-flow{to{stroke-dashoffset:-4.8}}

.hx-pos{position:absolute;will-change:transform,left,top}
.hx-tile{position:relative;width:19cqw;min-width:76px;max-width:112px;aspect-ratio:1;border-radius:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;
  background:linear-gradient(145deg,rgba(255,255,255,.92),rgba(255,255,255,.6));backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  box-shadow:0 14px 30px -10px color-mix(in srgb,var(--c2) 55%,transparent),inset 0 1px 0 #fff;animation:hx-float 4.6s ease-in-out infinite;overflow:hidden;transition:box-shadow .3s}
.hx-tile:hover{box-shadow:0 18px 40px -8px var(--c2),inset 0 1px 0 #fff}
@keyframes hx-float{50%{translate:0 -9px}}
.hx-edge{position:absolute;inset:0;border-radius:inherit;padding:1.6px;background:conic-gradient(from 0deg,var(--c1),transparent 28%,var(--c2) 52%,transparent 78%,var(--c1));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:hx-turn 5s linear infinite;pointer-events:none}
@keyframes hx-turn{to{transform:rotate(360deg)}}
.hx-scan{position:absolute;top:0;bottom:0;width:40%;left:-60%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.85),transparent);transform:skewX(-18deg);animation:hx-sweep 4.8s ease-in-out infinite;pointer-events:none}
@keyframes hx-sweep{0%,60%{left:-60%}100%{left:130%}}
.hx-ico{position:relative;display:grid;place-items:center;width:46%;aspect-ratio:1;border-radius:15px;background:linear-gradient(145deg,var(--c1),var(--c2));box-shadow:0 8px 18px -6px var(--c2),inset 0 1px 1px rgba(255,255,255,.55)}
.hx-ico:after{content:'';position:absolute;inset:-4px;border-radius:19px;border:1.5px solid var(--c1);opacity:0;animation:hx-ring 3s ease-out infinite}
@keyframes hx-ring{0%{transform:scale(.85);opacity:.8}100%{transform:scale(1.3);opacity:0}}
.hx-ico svg{width:68%;height:68%;overflow:visible}
.hx-lbl{font-size:clamp(9px,2.1cqw,12px);font-weight:800;color:#0f172a;line-height:1.1;text-align:center;letter-spacing:.01em}
.hx-live{position:absolute;top:9px;right:10px;width:7px;height:7px;border-radius:9999px;background:#22c55e;box-shadow:0 0 0 0 rgba(34,197,94,.6);animation:hx-live 1.8s infinite}
@keyframes hx-live{70%{box-shadow:0 0 0 7px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}

.hx-ico svg *{transform-box:fill-box;transform-origin:center}
.a-check{stroke-dasharray:14;animation:a-check 2.6s ease-in-out infinite}
@keyframes a-check{0%{stroke-dashoffset:14}35%,80%{stroke-dashoffset:0}100%{stroke-dashoffset:14}}
.a-coin{animation:a-coin 2.8s ease-in-out infinite}
@keyframes a-coin{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.15)}}
.a-line{stroke-dasharray:9;animation:a-type 2.8s ease-in-out infinite}
.a-line.l2{animation-delay:.25s}.a-line.l3{animation-delay:.5s}
@keyframes a-type{0%{stroke-dashoffset:9}30%,75%{stroke-dashoffset:0}100%{stroke-dashoffset:9}}
.a-k{animation:a-k 2.4s ease-in-out infinite}
.a-k.k2{animation-delay:.3s}.a-k.k3{animation-delay:.6s}
@keyframes a-k{50%{transform:translateY(3.5px) scaleY(.6)}}
.a-pulse{animation:a-pulse 2s ease-in-out infinite}
@keyframes a-pulse{50%{transform:scale(1.25);stroke-opacity:.5}}
.a-dot{animation:a-dot 1.2s ease-in-out infinite}
.a-dot.d2{animation-delay:.2s}.a-dot.d3{animation-delay:.4s}
@keyframes a-dot{40%{transform:translateY(-2.6px) scale(1.7)}}
.a-flap{animation:a-flap 3s ease-in-out infinite;transform-origin:50% 0!important}
@keyframes a-flap{0%,60%,100%{transform:scaleY(1)}30%{transform:scaleY(-.7)}}
.a-ping{animation:a-ping 3s ease-in-out infinite}
@keyframes a-ping{0%,40%{transform:scale(0)}55%{transform:scale(1.5)}70%,100%{transform:scale(1)}}
.a-bar{transform-origin:bottom!important;animation:a-bar 2.6s ease-in-out infinite}
.a-bar.b2{animation-delay:.2s}.a-bar.b3{animation-delay:.4s}
@keyframes a-bar{0%{transform:scaleY(.2)}40%,80%{transform:scaleY(1)}100%{transform:scaleY(.2)}}
.a-trend{stroke-dasharray:22;animation:a-trend 2.6s ease-in-out infinite}
@keyframes a-trend{0%{stroke-dashoffset:22}45%,80%{stroke-dashoffset:0}100%{stroke-dashoffset:22}}
.a-globe{animation:a-globe 3.2s ease-in-out infinite}
@keyframes a-globe{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.12)}}
.a-spark{animation:a-spark 2.4s ease-in-out infinite}
@keyframes a-spark{50%{transform:scale(1.25) rotate(20deg)}}
.a-spark2{animation:a-twk 1.6s ease-in-out infinite}
@keyframes a-twk{50%{transform:scale(.4);opacity:.3}}

.hx-girl{position:absolute;left:60%;bottom:-15%;width:112%;max-width:none;height:auto;z-index:3;transform:translate(calc(-50% + var(--mx)*7px),calc(var(--my)*5px));transition:transform .25s ease-out;filter:drop-shadow(0 22px 24px rgba(15,60,110,.22));animation:hx-breathe 6s ease-in-out infinite;pointer-events:none}
@keyframes hx-breathe{50%{margin-bottom:6px}}
.hx-bubble{position:absolute;left:50%;top:-1%;transform:translateX(-50%);background:#dcfce7;color:#15803d;font-weight:700;text-align:center;border-radius:16px;padding:8px 16px;font-size:clamp(12px,3cqw,17px);line-height:1.25;box-shadow:0 8px 20px -10px rgba(21,128,61,.5);animation:hx-bob 3.8s ease-in-out infinite;z-index:8}
.hx-bubble:after{content:'';position:absolute;left:50%;bottom:-7px;margin-left:-8px;border:8px solid transparent;border-top-color:#dcfce7;border-bottom:0}
@keyframes hx-bob{50%{transform:translateX(-50%) translateY(-7px)}}
.hx-note{position:absolute;color:#1e1b4b;font-weight:700;line-height:1.05;font-size:clamp(17px,4.6cqw,30px);z-index:8;animation:hx-sway 5s ease-in-out infinite}
.hx-n1{top:4%;right:0%;transform:rotate(-8deg);text-align:right}
.hx-n2{bottom:12%;right:-2%;transform:rotate(-12deg);text-align:left;animation-delay:-2s}
@keyframes hx-sway{50%{translate:0 -6px}}
.hx-spark{position:absolute;width:10px;height:10px;border-radius:2px;background:#fbbf24;transform:rotate(45deg);animation:hx-twinkle 2.6s ease-in-out infinite;z-index:8}
.hx-s1{top:22%;left:6%}.hx-s2{top:60%;right:8%;background:#2dd4bf;animation-delay:-1s}.hx-s3{bottom:12%;left:22%;background:#60a5fa;animation-delay:-1.8s}
@keyframes hx-twinkle{0%,100%{opacity:.2;scale:.6}50%{opacity:1;scale:1.3}}
@media (prefers-reduced-motion:reduce){
  .hx *,.hx *:before,.hx *:after{animation:none!important;transition:none!important}
  .hx-up{opacity:1;transform:none}.hx-draw{stroke-dashoffset:0}
  .a-check,.a-trend,.a-line{stroke-dashoffset:0}
}
`;
