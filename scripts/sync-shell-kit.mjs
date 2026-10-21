// Copies the shared Bizzux shell kit (components/shell/BizzuxProfileMenu.js) byte-for-byte into every Bizzux app as components/BizzuxProfileMenu.js.
// The apps are separate deployments; one source file, no forks. Usage: node scripts/sync-shell-kit.mjs [--check]  (--check reports drift, exits 1 on any)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
const apps = ["attendance", "chat", "crm", "files", "finance", "mail", "notes", "projects"];
const src = readFileSync(new URL("../components/shell/BizzuxProfileMenu.js", import.meta.url));
const h = (b) => createHash("sha256").update(b).digest("hex").slice(0, 10);
const check = process.argv.includes("--check");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
let drift = 0;
for (const a of apps) {
  if (only && !only.includes(a)) continue;
  const dir = new URL(`../../bizzux-${a}/components`, import.meta.url);
  if (!existsSync(dir)) { console.log(a.padEnd(11), "missing"); continue; }
  const dest = new URL(`../../bizzux-${a}/components/BizzuxProfileMenu.js`, import.meta.url);
  const cur = existsSync(dest) ? readFileSync(dest) : null;
  const same = !!cur && h(cur) === h(src);
  if (!same) drift++;
  if (!same && !check) writeFileSync(dest, src);
  console.log(a.padEnd(11), same ? "in sync" : check ? "DRIFT" : "updated", h(src));
}
if (check && drift) process.exit(1);
