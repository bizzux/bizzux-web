type IconProps = { className?: string };

export function IconClock({ className = "w-5 h-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.5v4.7l3.2 1.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconX({ className = "w-4 h-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconDownload({ className = "w-4 h-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 4v11.5M8 12l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 18.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconShare({ className = "w-4 h-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="18" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="6" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="18.5" r="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.2 10.7l7.6-4.4M8.2 13.3l7.6 4.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function IconCrown({ className = "w-4 h-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4 17h16l-1.4-7.3-3.9 3.1-2.7-5.1-2.7 5.1-3.9-3.1L4 17z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M4 19.5h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconPOS({ className = "w-6 h-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 9h18" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 20h10M12 16v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="7.5" cy="12.5" r="1" fill="currentColor" />
    </svg>
  );
}

export function IconMenu({ className = "w-6 h-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconBox({ className = "w-6 h-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M3 8l9-5 9 5-9 5-9-5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3 8v9l9 5 9-5V8" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 13v9" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function IconWallet({ className = "w-6 h-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16.5" cy="14.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function IconUsers({ className = "w-6 h-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="17.5" cy="9" r="2.3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15.5 20c.2-2.6 1.7-4.6 3.8-5.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconChart({ className = "w-6 h-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 20V10M11 20V4M18 20v-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M3 20h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconArrowRight({ className = "w-4 h-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconCheck({ className = "w-4 h-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconJuice({ className = "w-7 h-7" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M7 3h10l-1 4H8L7 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 7l1 13a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l1-13" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 12h6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function IconBakery({ className = "w-7 h-7" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 12c0-4 3.5-8 8-8s8 4 8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M3 12h18l-1.5 8a2 2 0 0 1-2 1.6H6.5a2 2 0 0 1-2-1.6L3 12Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function IconRestaurant({ className = "w-7 h-7" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 2v8M4 2v5a2 2 0 0 0 4 0V2M6 10v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 2c-2 0-3 2-3 5s1 4 3 4v11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconStore({ className = "w-7 h-7" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M3 9l1.5-5h15L21 9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M4 9v11h16V9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 20v-6h6v6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function IconCloud({ className = "w-6 h-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6.5 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 16.6 8.05 4.5 4.5 0 0 1 16 18H6.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSpark({ className = "w-6 h-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function IconShield({ className = "w-6 h-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconLayers({ className = "w-6 h-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 3l9 5-9 5-9-5 9-5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3 13l9 5 9-5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function IconWhatsApp({ className = "w-5 h-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.39 1.26 4.81L2 22l5.4-1.42a9.86 9.86 0 0 0 4.64 1.18h.01c5.46 0 9.9-4.45 9.9-9.91C21.96 6.45 17.5 2 12.04 2Zm0 18.06h-.01a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-3.11.82.83-3.03-.2-.31a8.13 8.13 0 0 1-1.26-4.31c0-4.51 3.68-8.19 8.24-8.19 2.2 0 4.27.86 5.82 2.42a8.14 8.14 0 0 1 2.41 5.82c0 4.52-3.68 8.1-8.24 8.1Zm4.5-6.13c-.25-.12-1.46-.72-1.68-.8-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.96-.15.16-.29.18-.53.06-.25-.12-1.04-.38-1.99-1.22-.73-.66-1.23-1.46-1.37-1.71-.15-.24-.02-.37.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.24-.41.08-.16.04-.31-.02-.43-.06-.12-.56-1.36-.77-1.86-.2-.49-.41-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.23.24-.85.83-.85 2.03s.87 2.36.99 2.53c.12.16 1.7 2.6 4.13 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.46-.6 1.66-1.17.21-.58.21-1.08.15-1.18-.06-.1-.23-.16-.48-.28Z"/>
    </svg>
  );
}

export function IconMail({ className = "w-6 h-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 7l9 6 9-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconTeam({ className = "w-6 h-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 4h16v12H8l-4 4V4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 9h8M8 12h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconEye({ className = "w-4 h-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function IconEyeOff({ className = "w-4 h-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M3.5 3.5l17 17M10.6 5.2A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a15.8 15.8 0 0 1-3.6 4.5M6.7 6.7C4 8.4 2 12 2 12s3.6 7 10 7c1.4 0 2.6-.3 3.7-.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9.9 10a3 3 0 0 0 4.1 4.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Simple person-in-circle silhouette, used bare (no circle outline of its
// own) so callers can drop it inside their own circular badge div and
// control that badge's fill/border independently — see the Partners page's
// "refer a friend" hero illustration.
export function IconUserCircle({ className = "w-6 h-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="8.5" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 19c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// A small wrapped gift box — the "you earn a reward" beat in the Partners
// page's referral illustration.
export function IconGift({ className = "w-6 h-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="4" y="10" width="16" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 10h16v3H4v-3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 10v10" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 10c-1.2-3.5-6-4-6-1 0 1.3 1.5 1.5 6 1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 10c1.2-3.5 6-4 6-1 0 1.3-1.5 1.5-6 1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

// Two opposing arrows — "you refer them, they sign up" — sits between the
// two person badges in the Partners page's hero illustration.
export function IconSwap({ className = "w-5 h-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M3 8h15M14 4l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 16H6M10 12l-4 4 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconTrash({ className = "w-5 h-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconDatabase({ className = "w-6 h-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 5.5V18c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
