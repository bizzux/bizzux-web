// Where sign-in may send someone afterwards: ONLY the Admin Center hand-off page with a whitelisted target. Anything else is ignored, so the
// "next" parameter can never become an open redirect.
// and a platform-team invitation link (so signing in brings the invited person straight back to Accept instead of the dashboard).
const OK = /^(\/open-admin\?to=\/(users|teams|apps|roles|organizations|security)|\/accept-platform-invite\?token=[A-Za-z0-9_-]{20,100})$/;
export function safeNext(raw) {
  let v = "";
  try { v = decodeURIComponent(String(raw || "")); } catch { return null; }
  return OK.test(v) ? v : null;
}

// Client only: the safe "next" on the current page's URL, and a path with it carried along, so sign-in -> change password ->
// set up / verify two-step verification still ends where the person started (for example the invitation's Accept page).
export function currentNext() {
  return typeof window === "undefined" ? null : safeNext(new URLSearchParams(window.location.search).get("next"));
}
export function withNext(path, next = currentNext()) {
  return next ? path + (path.includes("?") ? "&" : "?") + "next=" + encodeURIComponent(next) : path;
}
