// Usage: node scripts/install-login-diagnostics.mjs <app-dir> <app-slug>
// Copies the shared tracker into <app-dir>/lib (or src/lib) and patches the standard
// /sso and sign-in pages. Prints files that need a manual hook (see
// bizzux-saas-engineering/references/login-diagnostics.md). Idempotent.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [dir, slug] = process.argv.slice(2);
if (!dir || !/^[a-z0-9-]{2,24}$/.test(slug || "")) { console.error("usage: <app-dir> <slug>"); process.exit(1); }
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "lib", "authJourneyClient.js");
const base = fs.existsSync(path.join(dir, "src", "app")) ? path.join(dir, "src") : dir;
fs.mkdirSync(path.join(base, "lib"), { recursive: true });
fs.copyFileSync(src, path.join(base, "lib", "authJourney.js"));
console.log("copied tracker ->", path.join(base, "lib", "authJourney.js"));

const IMP = `import { auth } from "@/lib/firebase";\nimport { createJourneyTracker } from "@/lib/authJourney";\n\n// Login Journey Diagnostics — categories and timings only, never credentials.\nconst journey = createJourneyTracker({ app: "${slug}", buildVersion: process.env.NEXT_PUBLIC_BUILD_NUMBER || "unknown", getToken: () => auth.currentUser?.getIdToken() });`;
const ok = (m) => `journey.track("AUTH_SUCCEEDED", { method: "${m}" });\njourney.track("SESSION_INITIALIZED", { method: "${m}" });\njourney.track("APP_ACCESS_GRANTED", { method: "${m}" });`;

function patch(file, edits) {
  if (!fs.existsSync(file)) return false;
  let s = fs.readFileSync(file, "utf8"); const crlf = s.includes("\r\n"); s = s.replace(/\r\n/g, "\n");
  if (s.includes("createJourneyTracker")) { console.log("already patched", file); return true; }
  for (const [a, b] of edits) { if (!s.includes(a)) { console.log("MANUAL HOOK NEEDED:", file, "(anchor not found)"); return false; } s = s.replace(a, b); }
  fs.writeFileSync(file, crlf ? s.replace(/\n/g, "\r\n") : s); console.log("patched", file); return true;
}
const sso = (nav) => [
  ['import { auth } from "@/lib/firebase";', IMP],
  ["    if (!token) {\n      setError(", `    journey.track("LOGIN_STARTED", { method: "sso-handoff" });\n    if (!token) {\n      journey.track("AUTH_FAILED", { method: "sso-handoff", errorCategory: "token_invalid" });\n      setError(`],
  [`        await signInWithCustomToken(auth, d.customToken);\n        ${nav}\n      } catch (e) {\n`, `        await signInWithCustomToken(auth, d.customToken);\n        ${ok("sso-handoff").replace(/\n/g, "\n        ")}\n        ${nav}\n      } catch (e) {\n        journey.fail("AUTH_FAILED", e, { method: "sso-handoff" });\n`],
];
const ssoFile = [path.join(base, "app/sso/page.js")].find(fs.existsSync);
if (ssoFile) patch(ssoFile, sso(fs.readFileSync(ssoFile, "utf8").includes("window.location.replace") ? 'window.location.replace("/");' : 'router.push("/");'));
const signIn = ["app/sign-in/page.js", "app/login/page.js"].map((f) => path.join(base, f)).find(fs.existsSync);
if (signIn) patch(signIn, [
  ['import { auth } from "@/lib/firebase";', IMP],
  ["    try {\n      await signInWithEmailAndPassword(auth, email, password);", `    journey.track("LOGIN_STARTED", { method: "password", subject: email });\n    try {\n      await signInWithEmailAndPassword(auth, email, password);\n      ${ok("password").replace(/\n/g, "\n      ")}`],
  ["    } catch (e2) {\n", `    } catch (e2) {\n      journey.fail("AUTH_FAILED", e2, { method: "password", subject: email });\n`],
]);
else console.log("MANUAL HOOK NEEDED: no app/sign-in or app/login page found");
