// First-load budget (CLAUDE.md acceptance checks): the JS and CSS the page
// loads up front must stay under 150 KB gzipped. Lazy chunks (stroke data,
// the name dictionary, WanaKana) and audio are excluded: they load later or
// install in the background. Run after `npm run build`:
//
//   node scripts/check-budget.mjs        (npm run check:budget)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const BUDGET_KB = 150;
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const html = readFileSync(join(dist, "index.html"), "utf8");

// The entry script, its stylesheet, and anything it preloads.
const tags = html.match(/<(script|link)\b[^>]*>/g) ?? [];
const files = new Set();
for (const t of tags) {
  const src = t.match(/\b(?:src|href)="([^"]+)"/)?.[1];
  if (!src || !/\.(js|css)$/.test(src)) continue;
  if (t.startsWith("<script") || /rel="(stylesheet|modulepreload)"/.test(t)) files.add(src.replace(/^\.\//, ""));
}
if (!files.size) throw new Error("No JS or CSS found in dist/index.html: run npm run build first.");

let total = 0;
for (const f of files) {
  const gz = gzipSync(readFileSync(join(dist, f)), { level: 9 }).length;
  total += gz;
  console.log(`${(gz / 1024).toFixed(1).padStart(7)} KB  ${f}`);
}
const kb = total / 1024;
console.log(`${kb.toFixed(1).padStart(7)} KB  first load (budget ${BUDGET_KB} KB, ${Math.round((kb / BUDGET_KB) * 100)}%)`);
if (kb > BUDGET_KB) {
  console.error(`Over the first-load budget by ${(kb - BUDGET_KB).toFixed(1)} KB.`);
  process.exit(1);
}
