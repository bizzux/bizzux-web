// Where sign-in may send someone afterwards: ONLY the Admin Center hand-off page with a whitelisted target. Anything else is ignored, so the
// "next" parameter can never become an open redirect.
const OK = /^\/open-admin\?to=\/(users|teams|apps|roles|organizations|security)$/;
export function safeNext(raw) {
  let v = "";
  try { v = decodeURIComponent(String(raw || "")); } catch { return null; }
  return OK.test(v) ? v : null;
}
