// Where sign-in may send someone afterwards: ONLY the Admin Center hand-off page with a whitelisted target. Anything else is ignored, so the
// "next" parameter can never become an open redirect.
// and a platform-team invitation link (so signing in brings the invited person straight back to Accept instead of the dashboard).
const OK = /^(\/open-admin\?to=\/(users|teams|apps|roles|organizations|security)|\/accept-platform-invite\?token=[A-Za-z0-9_-]{20,100})$/;
export function safeNext(raw) {
  let v = "";
  try { v = decodeURIComponent(String(raw || "")); } catch { return null; }
  return OK.test(v) ? v : null;
}
