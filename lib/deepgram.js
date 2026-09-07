// SERVER ONLY. Hands the browser a short-lived, minimally-scoped Deepgram
// key so it can open a live-transcription WebSocket directly to Deepgram
// (see app/(saas)/notes/new/page.js) without ever seeing the long-lived
// DEEPGRAM_API_KEY. Vercel's serverless functions can't hold a persistent
// WebSocket connection, so relaying audio through our own server isn't an
// option — the browser has to connect straight to Deepgram.
//
// Why a real short-lived API key rather than Deepgram's newer JWT-based
// /v1/auth/grant tokens: those ~485-character JWTs fail the WebSocket
// handshake in every real browser tested (closing immediately with code
// 1006) while working fine from Node. A real ~40-character key with the
// classic `["token", key]` subprotocol connects reliably in both. Verified
// directly against Deepgram, in a clean browser, isolated from this app.
const KEY_TTL_SECONDS = 600; // 10 minutes
const RENEW_MARGIN_MS = 90 * 1000; // re-mint when under 90s of life left

let cachedProjectId = null;
// Deepgram caps key creation per day, and a meeting only needs the key for
// the initial handshake — so one key is shared by every session started
// within its lifetime rather than minting one per meeting.
let cachedKey = null; // { access_token, expiresAt }

async function getProjectId(apiKey) {
  if (cachedProjectId) return cachedProjectId;
  const res = await fetch("https://api.deepgram.com/v1/projects", {
    headers: { Authorization: `Token ${apiKey}` },
  });
  const data = await res.json().catch(() => null);
  const projectId = data?.projects?.[0]?.project_id;
  if (!res.ok || !projectId) {
    throw new Error(data?.err_msg || "Couldn't resolve the Deepgram project");
  }
  cachedProjectId = projectId;
  return projectId;
}

export async function mintDeepgramToken({ fresh = false } = {}) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY is not set");

  if (!fresh && cachedKey && cachedKey.expiresAt - Date.now() > RENEW_MARGIN_MS) {
    return {
      access_token: cachedKey.access_token,
      expires_in: Math.floor((cachedKey.expiresAt - Date.now()) / 1000),
    };
  }

  const projectId = await getProjectId(apiKey);
  const res = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/keys`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      comment: "bizzux-notes-live-session",
      // Narrowest scope that can open /v1/listen — a leaked session key can
      // spend transcription quota and nothing else (no key management, no
      // usage/billing reads).
      scopes: ["usage:write"],
      time_to_live_in_seconds: KEY_TTL_SECONDS,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.key) {
    throw new Error(data?.err_msg || "Couldn't create a Deepgram session key");
  }

  cachedKey = { access_token: data.key, expiresAt: Date.now() + KEY_TTL_SECONDS * 1000 };
  return { access_token: data.key, expires_in: KEY_TTL_SECONDS };
}
