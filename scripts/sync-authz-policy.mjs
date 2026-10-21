// Copies lib/authz/policy.js byte-for-byte into every split app as lib/authzPolicy.js (the apps are separate deployments; one source file, no forks).
// Usage: node scripts/sync-authz-policy.mjs [--check]   (--check only reports drift and exits 1 if any copy differs)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
const apps = ["attendance", "chat", "crm", "files", "finance", "mail", "notes", "projects"];
const src = readFileSync(new URL("../lib/authz/policy.js", import.meta.url));
const h = (b) => createHash("sha256").update(b).digest("hex").slice(0, 10);
let drift = 0;
for (const a of apps) {
  const dest = new URL(`../../bizzux-${a}/lib/authzPolicy.js`, import.meta.url);
  if (!existsSync(new URL(`../../bizzux-${a}/lib`, import.meta.url))) { console.log(a, "missing"); continue; }
  const cur = existsSync(dest) ? readFileSync(dest) : null;
  const same = cur && h(cur) === h(src);
  if (!same) drift++;
  if (!same && !process.argv.includes("--check")) writeFileSync(dest, src);
  console.log(a.padEnd(11), same ? "in sync" : process.argv.includes("--check") ? "DRIFT" : "updated", h(src));
}
if (process.argv.includes("--check") && drift) process.exit(1);
