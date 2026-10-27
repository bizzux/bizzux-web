"use client";
// A success or error message shown at the TOP of the panel the person is working in. It sticks to the top while the panel scrolls and, when a new
// message arrives, the panel is scrolled back up to it, so a result is never hidden below the fold.
import { useEffect, useRef } from "react";

export default function Notice({ kind = "error", children, onDismiss }) {
  const ref = useRef(null);
  useEffect(() => {
    const scroller = ref.current?.closest(".adm-drawer-body");
    if (scroller) scroller.scrollTo?.({ top: 0, behavior: "smooth" });
    else ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [children]);
  return (
    <div ref={ref} className={"adm-notice " + kind} role={kind === "error" ? "alert" : "status"}>
      <span className="adm-notice-ic" aria-hidden="true">{kind === "error" ? "!" : "✓"}</span>
      <div className="adm-notice-text">{children}</div>
      {onDismiss && <button type="button" className="adm-notice-x" aria-label="Dismiss message" onClick={onDismiss}>×</button>}
    </div>
  );
}
