"use client";

import { useRef } from "react";
import { Caveat } from "next/font/google";

const hand = Caveat({ subsets: ["latin"], weight: ["600", "700"] });

type Tile = { label: string; color: string; paths: string[] };

// 24x24 stroke icons (lucide-style paths), one per app tile.
const TILES: Tile[] = [
  { label: "Attendance", color: "#10b981", paths: ["M8 2v4M16 2v4M3 10h18", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "m9 16 2 2 4-4"] },
  { label: "Email", color: "#2563eb", paths: ["M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "m22 7-10 6L2 7"] },
  { label: "Finance", color: "#7c3aed", paths: ["M5 21v-8M12 21V3M19 21v-12"] },
  { label: "Notes", color: "#14b8a6", paths: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6M8 13h8M8 17h6"] },
  { label: "Website", color: "#0ea5e9", paths: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M2 12h20", "M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"] },
  { label: "AI Apps", color: "#8b5cf6", paths: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", "M19 3v4M17 5h4"] },
  { label: "Chat", color: "#6366f1", paths: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", "M8 10h.01M12 10h.01M16 10h.01"] },
  { label: "CRM", color: "#f97316", paths: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"] },
  { label: "Project", color: "#ec4899", paths: ["M3 3h18v18H3z", "M8 7v7M12 7v10M16 7v5"] },
  { label: "Point of Sale", color: "#ef4444", paths: ["M3 9l1-5h16l1 5", "M4 9v11h16V9", "M9 20v-6h6v6", "M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"] },
  { label: "Payroll", color: "#0891b2", paths: ["M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z", "M16 3 12 7 8 3", "M17 14h.01"] },
];

const STATS = [
  { t: "11+ Integrated Apps", d: "Everything your business needs", c: "#2563eb", p: "M13 2 4 14h7l-1 8 9-12h-7z" },
  { t: "Works on Web & Mobile", d: "Access anywhere, anytime", c: "#0ea5e9", p: "M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4.6 12 3.5 3.5 0 0 0 6 19z" },
  { t: "Trusted by Growing Businesses", d: "From startups to established teams", c: "#14b8a6", p: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" },
  { t: "Secure & Reliable", d: "Your data is always protected", c: "#0891b2", p: "M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5z M9 12l2 2 4-4" },
];

function Icon({ paths, color, size = 26 }: { paths: string[]; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

export default function HeroShowcase() {
  const stage = useRef<HTMLDivElement>(null);

  // Gentle mouse parallax: the pointer position sets two CSS vars, the girl and
  // the glow shift by a few px. Disabled for reduced-motion via CSS.
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = stage.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", String(((e.clientX - r.left) / r.width - 0.5) * 2));
    el.style.setProperty("--my", String(((e.clientY - r.top) / r.height - 0.5) * 2));
  };
  const onLeave = () => {
    stage.current?.style.setProperty("--mx", "0");
    stage.current?.style.setProperty("--my", "0");
  };

  return (
    <section className="hx relative overflow-hidden bg-gradient-to-b from-white via-sky-50/70 to-white">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="hx-blob hx-b1" />
      <div className="hx-blob hx-b2" />

      <div className="relative mx-auto max-w-7xl px-6 pt-8 md:pt-10 pb-6">
        <div className="grid lg:grid-cols-[1fr_1.1fr] gap-8 lg:gap-2 items-center">
          {/* ---------- left: pitch ---------- */}
          <div>
            <div className="hx-up flex items-center gap-3 text-xs md:text-sm font-bold tracking-wide uppercase text-brand-blueDark" style={{ animationDelay: "0ms" }}>
              AI-Powered Business Management Suite
              <span className="hidden sm:block h-px w-16 bg-slate-300" />
            </div>
            <h1 className="hx-up mt-4 text-5xl md:text-6xl xl:text-7xl font-extrabold tracking-tight leading-[1.02] text-brand-navy" style={{ animationDelay: "90ms", color: "#0b2545" }}>
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
                <div className="text-3xl font-extrabold text-brand-navy" style={{ color: "#0b2545" }}>₹599<span className="text-base font-semibold"> / month</span></div>
                <div className="mt-1 font-semibold text-slate-800">All Apps Included</div>
                <div className="mt-2 border-t border-teal-200 pt-2 text-xs text-slate-500">One Platform. Unlimited Possibilities.</div>
              </div>
              <div className="hx-card rounded-2xl border border-slate-200 bg-white p-4 pt-5">
                <div className="text-3xl font-extrabold text-brand-navy" style={{ color: "#0b2545" }}>₹299<span className="text-base font-semibold"> / month</span></div>
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

          {/* ---------- right: rotating app orbit around the photo ---------- */}
          <div className="hx-up" style={{ animationDelay: "200ms" }}>
            <div ref={stage} onPointerMove={onMove} onPointerLeave={onLeave} className="hx-stage relative mx-auto aspect-square w-full max-w-[620px]">
              <div className="hx-glow" />
              <svg className="hx-dash" viewBox="0 0 100 100" aria-hidden>
                <circle cx="50" cy="50" r="40" fill="none" stroke="#7dd3fc" strokeWidth="0.35" strokeDasharray="1.5 2.2" />
                <circle cx="50" cy="50" r="31" fill="none" stroke="#99f6e4" strokeWidth="0.3" strokeDasharray="0.8 2" />
              </svg>

              <div className="hx-ring">
                {TILES.map((t, i) => {
                  const a = (360 / TILES.length) * i - 90;
                  return (
                    <div key={t.label} className="hx-slot" style={{ ["--a" as string]: `${a}deg` }}>
                      <div className="hx-counter">
                        <div className="hx-tile" style={{ animationDelay: `${i * -0.45}s` }}>
                          <span className="hx-ico" style={{ background: `${t.color}1a` }}>
                            <Icon paths={t.paths} color={t.color} />
                          </span>
                          <span className="hx-lbl">{t.label}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/hero-girl.webp"
                alt="A smiling Bizzux customer presenting the Bizzux apps"
                width={630}
                height={602}
                className="hx-girl"
              />

              <div className="hx-bubble">All Your Business Apps<br />in One Place</div>
              <div className={`hx-note hx-n1 ${hand.className}`}>One Login<br />for Everything</div>
              <div className={`hx-note hx-n2 ${hand.className}`}>Powered by AI<br />Work Smarter</div>
              <span className="hx-spark hx-s1" /><span className="hx-spark hx-s2" /><span className="hx-spark hx-s3" />
            </div>
          </div>
        </div>

        {/* ---------- trust strip ---------- */}
        <div className="hx-up mt-4 rounded-2xl bg-white/90 backdrop-blur border border-slate-100 shadow-md grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 lg:divide-x divide-slate-100" style={{ animationDelay: "480ms" }}>
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
.hx-glow{position:absolute;inset:14%;border-radius:9999px;background:radial-gradient(circle,rgba(125,211,252,.55),rgba(153,246,228,.25) 55%,transparent 72%);animation:hx-pulse 5s ease-in-out infinite;transform:translate(calc(var(--mx)*-10px),calc(var(--my)*-10px))}
@keyframes hx-pulse{50%{transform:scale(1.07) translate(calc(var(--mx)*-10px),calc(var(--my)*-10px));opacity:.8}}
.hx-dash{position:absolute;inset:0;width:100%;height:100%;animation:hx-spin 120s linear infinite reverse}
.hx-ring{position:absolute;inset:0;animation:hx-spin 70s linear infinite}
.hx-slot{position:absolute;left:50%;top:50%;width:0;height:0;transform:rotate(var(--a)) translateX(41cqw) rotate(calc(var(--a)*-1))}
.hx-counter{position:absolute;left:0;top:0;animation:hx-spin 70s linear infinite reverse}
@keyframes hx-spin{to{transform:rotate(360deg)}}
.hx-tile{position:relative;transform:translate(-50%,-50%);width:17cqw;min-width:70px;max-width:104px;aspect-ratio:1;border-radius:20px;background:#fff;box-shadow:0 10px 26px -10px rgba(15,60,110,.35);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;animation:hx-float 4.5s ease-in-out infinite;transition:box-shadow .25s,scale .25s}
.hx-tile:hover{scale:1.14;box-shadow:0 18px 36px -10px rgba(20,184,166,.5)}
@keyframes hx-float{50%{margin-top:-9px}}
.hx-ico{display:grid;place-items:center;width:44%;aspect-ratio:1;border-radius:12px}
.hx-ico svg{width:70%;height:70%}
.hx-lbl{font-size:clamp(9px,2.1cqw,12px);font-weight:700;color:#0f172a;line-height:1.1;text-align:center}
.hx-stage:hover .hx-ring,.hx-stage:hover .hx-counter,.hx-stage:hover .hx-dash{animation-play-state:paused}
.hx-girl{position:absolute;left:50%;bottom:2%;width:74%;height:auto;transform:translate(calc(-50% + var(--mx)*7px),calc(var(--my)*5px));transition:transform .25s ease-out;filter:drop-shadow(0 22px 24px rgba(15,60,110,.22));animation:hx-breathe 6s ease-in-out infinite;pointer-events:none}
@keyframes hx-breathe{50%{margin-bottom:6px}}
.hx-bubble{position:absolute;left:50%;top:-1%;transform:translateX(-50%);background:#dcfce7;color:#15803d;font-weight:700;text-align:center;border-radius:16px;padding:8px 16px;font-size:clamp(12px,3cqw,17px);line-height:1.25;box-shadow:0 8px 20px -10px rgba(21,128,61,.5);animation:hx-bob 3.8s ease-in-out infinite;z-index:5}
.hx-bubble:after{content:'';position:absolute;left:50%;bottom:-7px;margin-left:-8px;border:8px solid transparent;border-top-color:#dcfce7;border-bottom:0}
@keyframes hx-bob{50%{transform:translateX(-50%) translateY(-7px)}}
.hx-note{position:absolute;color:#1e1b4b;font-weight:700;line-height:1.05;font-size:clamp(17px,4.6cqw,30px);z-index:5;animation:hx-sway 5s ease-in-out infinite}
.hx-n1{top:9%;right:-1%;transform:rotate(-8deg);text-align:right}
.hx-n2{bottom:10%;right:-2%;transform:rotate(-12deg);text-align:left;animation-delay:-2s}
@keyframes hx-sway{50%{translate:0 -6px}}
.hx-spark{position:absolute;width:10px;height:10px;border-radius:2px;background:#fbbf24;transform:rotate(45deg);animation:hx-twinkle 2.6s ease-in-out infinite;z-index:5}
.hx-s1{top:22%;left:6%}.hx-s2{top:60%;right:8%;background:#2dd4bf;animation-delay:-1s}.hx-s3{bottom:12%;left:22%;background:#60a5fa;animation-delay:-1.8s}
@keyframes hx-twinkle{0%,100%{opacity:.2;scale:.6}50%{opacity:1;scale:1.3}}
@media (prefers-reduced-motion:reduce){
  .hx *,.hx *:before,.hx *:after{animation:none!important;transition:none!important}
  .hx-up{opacity:1;transform:none}.hx-draw{stroke-dashoffset:0}
}
`;
