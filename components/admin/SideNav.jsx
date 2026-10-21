"use client";
// Microsoft-365-style left navigation: expandable groups, accent on the active child, icon rail when collapsed, full keyboard support.
import Link from "next/link";
import { useRef } from "react";
import { NAV, visibleChildren, hrefOf } from "./adminNavConfig";

const ICONS = {
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0",
  building: "M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 9h2m4 0h2M8 13h2m4 0h2",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  people: "M9 11a3 3 0 100-6 3 3 0 000 6zm7 1a2.5 2.5 0 100-5M3 20a6 6 0 0112 0M16 14a5 5 0 015 5",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 018 0v3",
};
export const Icon = ({ name, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name] || ICONS.grid} /></svg>
);
const Chevron = ({ open }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}><path d="M6 9l6 6 6-6" /></svg>
);

export default function SideNav({ active, open, onToggleGroup, collapsed, onExpandRail, onNavigate, onAdminHost }) {
  const ref = useRef(null);
  function onKeyDown(e) {
    const items = [...ref.current.querySelectorAll("[data-nav-item]")].filter((n) => n.offsetParent !== null);
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    const el = items[i];
    if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(items.length - 1, i + 1)].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[Math.max(0, i - 1)].focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === "ArrowRight" && el.dataset.group && el.getAttribute("aria-expanded") === "false") { e.preventDefault(); onToggleGroup(el.dataset.group); }
    else if (e.key === "ArrowLeft" && el.dataset.group && el.getAttribute("aria-expanded") === "true") { e.preventDefault(); onToggleGroup(el.dataset.group); }
  }
  return (
    <nav ref={ref} className="adm-side" aria-label="Admin Center navigation" onKeyDown={onKeyDown}>
      <ul className="adm-tree" role="tree">
        {NAV.map((g) => {
          const kids = visibleChildren(g);
          if (!g.children) {
            const on = active?.item.key === g.key;
            return (
              <li key={g.key} role="none">
                <Link data-nav-item href={hrefOf(g, onAdminHost)} role="treeitem" aria-current={on ? "page" : undefined} className={"adm-item" + (on ? " on" : "")} title={collapsed ? g.label : undefined} onClick={onNavigate}>
                  <Icon name={g.icon} /><span className="adm-lbl">{g.label}</span>
                </Link>
              </li>
            );
          }
          const isOpen = !collapsed && !!open[g.key];
          const hasActive = active?.group?.key === g.key;
          return (
            <li key={g.key} role="none">
              <button type="button" data-nav-item data-group={g.key} role="treeitem" aria-expanded={isOpen} className={"adm-item adm-group" + (hasActive ? " has-on" : "")} title={collapsed ? g.label : undefined}
                onClick={() => (collapsed ? onExpandRail(g.key) : onToggleGroup(g.key))}>
                <Icon name={g.icon} /><span className="adm-lbl">{g.label}</span><span className="adm-chev"><Chevron open={isOpen} /></span>
              </button>
              {isOpen && (
                <ul role="group" className="adm-kids">
                  {kids.map((c) => {
                    const on = active?.item.key === c.key;
                    return (
                      <li key={c.key} role="none">
                        <Link data-nav-item href={hrefOf(c, onAdminHost)} role="treeitem" aria-current={on ? "page" : undefined} className={"adm-item adm-child" + (on ? " on" : "")} onClick={onNavigate}>
                          <span className="adm-lbl">{c.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
