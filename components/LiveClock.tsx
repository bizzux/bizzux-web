"use client";

import { useEffect, useState } from "react";

function greetingFor(hour: number) {
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

// A live, ticking date/day/time strip plus a time-of-day greeting — the
// point is that anyone signed into Bizzux always has today's date, the
// day of the week, and the exact current time in clear view on-screen,
// without reaching for their phone or a wall clock. Renders nothing until
// mounted (needs the *viewer's* clock, which isn't knowable at SSR time —
// rendering a server-side guess would flash/mismatch on hydration) and
// then re-renders every second off a real setInterval, not a static
// snapshot taken once at page load.
export default function LiveClock({ name }: { name?: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;

  const dateStr = now.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <span className="font-semibold text-slate-700">
        {greetingFor(now.getHours())}
        {name ? `, ${name}` : ""} 👋
      </span>
      <span className="text-slate-300">·</span>
      <span className="text-slate-500">{dateStr}</span>
      <span className="text-slate-300">·</span>
      <span className="font-mono font-semibold tabular-nums text-brand-blueDark">{timeStr}</span>
    </div>
  );
}
