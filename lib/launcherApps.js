// Flat list of apps for the 9-dot App Launcher (Nav's AppLauncher). Mirrors
// the "Try now" entries in app/(saas)/apps/page.js's CATEGORIES — kept as
// its own flat list here (rather than importing that page's CATEGORIES)
// because the launcher needs to render everywhere Nav does, including
// server-rendered marketing pages, and wants a simpler shape than the
// category/description fields that page uses for its cards.
export const LAUNCHER_APPS = [
  { key: "juicechatjunction", name: "Bizzux Business", icon: "🏪", url: "https://business.bizzux.com", sso: true },
  { key: "pos", name: "Bizzux POS", icon: "🧾", url: "https://pos.bizzux.com", sso: true, ssoEndpoint: "/api/pos-sso" },
  { key: "notes", name: "Bizzux Notes", icon: "📝", url: "https://bizzux-notes.vercel.app", sso: true, ssoEndpoint: "/api/app-sso?app=notes" },
  { key: "files", name: "Bizzux Files", icon: "🗂️", url: "https://bizzux-files.vercel.app", sso: true, ssoEndpoint: "/api/app-sso?app=files" },
  { key: "projects", name: "Bizzux Projects", icon: "🗒️", url: "https://bizzux-projects.vercel.app", sso: true, ssoEndpoint: "/api/app-sso?app=projects" },
  { key: "chat", name: "Bizzux Chat", icon: "💬", url: "https://bizzux-chat.vercel.app", sso: true, ssoEndpoint: "/api/app-sso?app=chat" },
  { key: "paisatrack", name: "PaisaTrack", icon: "💸", url: "https://paisatrack.bizzux.com" },
  { key: "screenrecorder", name: "Screen Recorder", icon: "🎥", url: "/screen-recorder", direct: true },
  { key: "admin", name: "Admin Center", icon: "🛠️", url: "/team", internal: true, adminOnly: true },
  { key: "allapps", name: "More apps", icon: "🧭", url: "/apps", internal: true },
];
