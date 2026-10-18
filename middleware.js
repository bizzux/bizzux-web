import { NextResponse } from "next/server";

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

export function middleware(req) {
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

export const config = { matcher: "/api/:path*" };
