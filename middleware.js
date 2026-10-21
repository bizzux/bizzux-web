import { NextResponse } from "next/server";
import { decide } from "./lib/adminHost";

// Cross-origin allow-list for the API. The split apps (notes.bizzux.com,
// crm.bizzux.com, ...) call bizzux-web's /api/* with a Bearer token; no other
// origin should be able to read those responses. Routes no longer set
// Access-Control-Allow-Origin themselves (see lib/cors.js) — it is added
// here, only for an allowed Origin, and preflights are answered here.
const ALLOWED = /^https:\/\/([a-z0-9-]+\.)*bizzux\.com$/;
const DEV_ALLOWED = /^http:\/\/localhost:\d+$/;

function allowedOrigin(origin) {
  if (!origin) return null;
  if (ALLOWED.test(origin)) return origin;
  if (process.env.NODE_ENV !== "production" && DEV_ALLOWED.test(origin)) return origin;
  return null;
}

// Pages: Admin Center host routing (lib/adminHost.js). Does nothing on www/preview hosts unless ADMIN_REDIRECT_LEGACY=1 moves /team to the admin host.
function pageRouting(req) {
  const cfg = {
    adminOrigin: process.env.ADMIN_CENTER_ORIGIN || undefined,
    wwwOrigin: process.env.WWW_ORIGIN || undefined,
    redirectLegacy: process.env.ADMIN_REDIRECT_LEGACY === "1",
  };
  Object.keys(cfg).forEach((k) => cfg[k] === undefined && delete cfg[k]);
  const { pathname, search } = req.nextUrl;
  const d = decide({ host: req.headers.get("host"), pathname, search }, cfg);
  if (d.type === "rewrite") return NextResponse.rewrite(new URL(d.path, req.url));
  if (d.type === "redirect") return NextResponse.redirect(new URL(d.url, req.url), d.status);
  if (d.type === "notfound") return new NextResponse("Not found", { status: 404 });
  return NextResponse.next();
}

export function middleware(req) {
  if (!req.nextUrl.pathname.startsWith("/api/")) return pageRouting(req);
  const origin = allowedOrigin(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    const res = new NextResponse(null, { status: 204 });
    if (origin) {
      res.headers.set("Access-Control-Allow-Origin", origin);
      res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.headers.set("Access-Control-Max-Age", "600");
    }
    res.headers.set("Vary", "Origin");
    return res;
  }

  const res = NextResponse.next();
  if (origin) res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.append("Vary", "Origin");
  return res;
}

export const config = { matcher: ["/api/:path*", "/((?!api|_next/static|_next/image).*)"] };
