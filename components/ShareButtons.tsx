"use client";

import { useState } from "react";

// Facebook, LinkedIn and X all have a real "share intent" URL that opens a
// popup pre-filled with the link — no API key, no app review needed.
// Instagram deliberately has no such thing: they don't offer a web
// share-intent for arbitrary URLs (sharing there only happens through their
// own app's share sheet or Stories camera). Rather than fake an Instagram
// button that does nothing useful, this gives a "copy link" action instead,
// which is what Instagram sharing actually requires (paste into a Story or
// bio link) once building the demo above got the reader that far.
export default function ShareButtons({ url, title, compact = false }: { url: string; title: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  const btnSize = compact ? "w-7 h-7" : "w-9 h-9";
  const iconScale = compact ? 0.8 : 1;

  function openShare(shareUrl: string) {
    window.open(shareUrl, "_blank", "noopener,noreferrer,width=600,height=600");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable — nothing more we can do silently
    }
  }

  const btnClass = `${btnSize} rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:border-brand-blue hover:text-brand-blue transition-colors`;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {!compact && <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide mr-1">Share</span>}

      <button
        type="button"
        onClick={() => openShare(`https://wa.me/?text=${encodedTitle}%20${encodedUrl}`)}
        aria-label="Share on WhatsApp"
        className={btnClass}
      >
        <svg width={16 * iconScale} height={16 * iconScale} viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.6-.8-1.9-.9-.2-.1-.4-.1-.6.1-.2.3-.7.9-.9 1-.2.2-.3.2-.6.1-.3-.1-1.2-.4-2.3-1.4-.8-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.2-.4.1-.2 0-.4 0-.5s-.6-1.5-.8-2c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-1 1-1 2.3 0 1.4 1 2.7 1.1 2.9.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.6-.7 1.9-1.3.2-.6.2-1.1.2-1.3-.1-.1-.3-.2-.6-.3ZM12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Z"/></svg>
      </button>

      <button
        type="button"
        onClick={() => openShare(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`)}
        aria-label="Share on Facebook"
        className={btnClass}
      >
        <svg width={16 * iconScale} height={16 * iconScale} viewBox="0 0 24 24" fill="currentColor"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z"/></svg>
      </button>

      <button
        type="button"
        onClick={() => openShare(`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`)}
        aria-label="Share on LinkedIn"
        className={btnClass}
      >
        <svg width={16 * iconScale} height={16 * iconScale} viewBox="0 0 24 24" fill="currentColor"><path d="M20.4 20.4h-3.6v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9v5.7H9.2V9h3.4v1.6h.1c.5-.9 1.7-1.9 3.4-1.9 3.7 0 4.3 2.4 4.3 5.5v6.2ZM5.3 7.4A2.1 2.1 0 1 1 5.3 3.2a2.1 2.1 0 0 1 0 4.2ZM7.1 20.4H3.6V9h3.5v11.4Z"/></svg>
      </button>

      <button
        type="button"
        onClick={() => openShare(`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`)}
        aria-label="Share on X"
        className={btnClass}
      >
        <svg width={14 * iconScale} height={14 * iconScale} viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-7.6 8.7L23.3 22h-7l-5.5-7.2L4.5 22H1.3l8.1-9.3L1 2h7.2l5 6.6L18.9 2Zm-1.2 18h1.7L7.4 4H5.6l12.1 16Z"/></svg>
      </button>

      <button
        type="button"
        onClick={copyLink}
        aria-label="Copy link for Instagram"
        title="Instagram doesn't support direct link sharing — copy the link to paste into a Story or your bio"
        className={btnClass}
      >
        <svg width={16 * iconScale} height={16 * iconScale} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 2 .3 2.4.5.6.2 1.1.6 1.5 1a4 4 0 0 1 1 1.5c.2.5.4 1.2.5 2.4.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.3 2-.5 2.4-.2.6-.6 1.1-1 1.5a4 4 0 0 1-1.5 1c-.5.2-1.2.4-2.4.5-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-2-.3-2.4-.5a4 4 0 0 1-1.5-1 4 4 0 0 1-1-1.5c-.2-.5-.4-1.2-.5-2.4C2 15.6 2 15.2 2 12s0-3.6.1-4.9c.1-1.2.3-2 .5-2.4.2-.6.6-1.1 1-1.5a4 4 0 0 1 1.5-1c.5-.2 1.2-.4 2.4-.5C8.4 2.2 8.8 2.2 12 2.2Zm0 1.8c-3.1 0-3.5 0-4.7.1-1 0-1.6.2-1.9.4-.5.2-.8.4-1.2.7-.3.4-.5.7-.7 1.2-.1.3-.3.9-.4 1.9-.1 1.2-.1 1.6-.1 4.7s0 3.5.1 4.7c0 1 .2 1.6.4 1.9.2.5.4.8.7 1.2.4.3.7.5 1.2.7.3.1.9.3 1.9.4 1.2.1 1.6.1 4.7.1s3.5 0 4.7-.1c1 0 1.6-.2 1.9-.4.5-.2.8-.4 1.2-.7.3-.4.5-.7.7-1.2.1-.3.3-.9.4-1.9.1-1.2.1-1.6.1-4.7s0-3.5-.1-4.7c0-1-.2-1.6-.4-1.9a3 3 0 0 0-.7-1.2 3 3 0 0 0-1.2-.7c-.3-.1-.9-.3-1.9-.4-1.2-.1-1.6-.1-4.7-.1Zm0 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm0 1.8a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Zm5.7-2a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 0 1 2.6 0Z"/></svg>
      </button>

      {copied && <span className="text-xs text-green-600 font-medium">Link copied!</span>}
    </div>
  );
}
