// Exports the app's UI for Figma / Figma Make:  npm run design-export
//
//   design-export/
//     screens-svg/   every screen as an editable SVG (import into Figma)
//     screens-png/   the same screens as 2x PNGs (attach to Figma Make)
//     assets/        icons, mascot, star, app icon, every kana glyph (SVG)
//     tokens.json    colours, radii, sizes, fonts (W3C design-token format)
//     README.md      how to bring it into Figma
//
// Drives the real app in headless Chromium (Playwright) against a Vite dev server.

import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = new URL("../../", import.meta.url);
const OUT = new URL("design-export/", root);
const strokes = JSON.parse(readFileSync(new URL("data/kana-strokes.json", root), "utf8")).kana;
const table = JSON.parse(readFileSync(new URL("data/kana-table.json", root), "utf8"));
const toSvg = readFileSync(new URL("scripts/design/dom-to-svg.js", root), "utf8");

const VIEWPORTS = {
  phone: { width: 393, height: 852 },
  tablet: { width: 820, height: 1180 },
  "tablet-landscape": { width: 1180, height: 820 },
};

rmSync(OUT, { recursive: true, force: true });
for (const d of ["screens-svg", "screens-png", "assets/icons", "assets/kana"]) mkdirSync(new URL(d, OUT), { recursive: true });

const server = await createServer({ root: fileURLToPath(root), server: { port: 5176, strictPort: true }, logLevel: "error" });
await server.listen();
const BASE = "http://localhost:5176/";
const browser = await chromium.launch();
const index = [];

// ---------- helpers ----------

async function capture(page, device, name, label, { full = false } = {}) {
  await page.mouse.move(0, 0);
  const file = `${device}--${name}`;
  await page.screenshot({ path: fileURLToPath(new URL(`screens-png/${file}.png`, OUT)), fullPage: full });
  const svg = await page.evaluate((t) => window.__toFigmaSVG(t), `${label} (${device})`);
  writeFileSync(new URL(`screens-svg/${file}.svg`, OUT), svg);
  index.push({ device, file, label });
  console.log("  ", file);
}

const stage = (page) => page.getByTestId("stage");

async function draw(page, pts) {
  const box = await stage(page).boundingBox();
  const [x, y, size] = (await stage(page).getAttribute("data-cell")).split(",").map(Number);
  const map = ([u, v]) => [box.x + x + u * size, box.y + y + v * size];
  await page.mouse.move(...map(pts[0]));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...map(p), { steps: 2 });
  await page.mouse.up();
}

async function ready(page, phase, k) {
  await page.waitForFunction(
    ([p, s]) => {
      const el = document.querySelector("[data-testid=stage]");
      return el?.dataset.phase === String(p) && el.dataset.stroke === String(s) && el.dataset.busy === "false";
    },
    [phase, k],
  );
}

async function finishPhase(page, kana, phase, from = 0) {
  const list = strokes[kana].strokes;
  for (let k = from; k < list.length; k++) {
    await ready(page, phase, k);
    await draw(page, list[k].points);
  }
}

async function newPage(device) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[device], deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(toSvg);
  // Headless Chromium crashes on SpeechRecognition.available(); answer like normal Chrome does.
  await page.addInitScript(() => {
    const SR = window.SpeechRecognition;
    if (SR && typeof SR.available === "function") SR.available = () => Promise.resolve("unavailable");
  });
  return page;
}

/** Fill history with a few practised items so the home shelf and grown-ups screen have content. */
async function seedHistory(page) {
  const drawingOf = (k) => strokes[k].strokes.map((s) => s.points.filter((_, i) => i % 2 === 0).map(([x, y]) => [x + 0.01, y + 0.01]));
  const items = [
    { kind: "word", kana: ["え", "ま"], input: "Emma", mode: "english", scores: [61, 74, 86] },
    { kind: "word", kana: ["ね", "こ"], input: "neko", mode: "romaji", scores: [52, 70] },
    { kind: "word", kana: ["の", "あ"], input: "Noah", mode: "english", scores: [90] },
    { kind: "kana", kana: ["し"], input: "し", mode: "chart", scores: [80, 93] },
    { kind: "kana", kana: ["き"], input: "き", mode: "chart", scores: [48] },
  ].map((it) => ({ ...it, drawing: it.kana.map(drawingOf) }));
  await page.evaluate(async (items) => {
    const store = await import("/src/store.ts");
    let t = Date.parse("2026-10-01T16:00:00Z");
    for (const it of items) {
      for (const score of it.scores) {
        t += 3600_000;
        await store.recordSession(it.kind, it.kana, it.input, it.mode, {
          at: new Date(t).toISOString(),
          score,
          stars: score >= 80 ? 3 : score >= 55 ? 2 : 1,
          perKana: it.kana.map((k, i) => ({ kana: k, score: Math.max(30, score - i * 12), retries: score < 60 ? 2 : 0 })),
          drawing: it.drawing,
        });
      }
    }
    // Keep step 1 in the export even for letters the seeded history has "mastered".
    await store.saveSettings({ skipPhase1WhenMastered: false });
  }, items);
}

// ---------- screens ----------

for (const device of ["phone", "tablet"]) {
  console.log(device);
  const page = await newPage(device);
  await page.goto(BASE);
  await page.getByTestId("go-word").waitFor();
  await capture(page, device, "01-home-first-visit", "Home, first visit");

  await seedHistory(page);
  await page.reload();
  await page.getByTestId("shelf-card").first().waitFor();
  await capture(page, device, "02-home", "Home with practised words", { full: true });

  await page.getByTestId("go-letter").click();
  await page.locator('[data-kana="あ"]').waitFor();
  await capture(page, device, "03-chart-basic", "Letter chart: basic", { full: true });
  await page.getByRole("tab", { name: "voiced" }).click();
  await capture(page, device, "04-chart-voiced", "Letter chart: voiced", { full: true });
  await page.getByRole("tab", { name: "small" }).click();
  await capture(page, device, "05-chart-small", "Letter chart: small kana", { full: true });

  await page.goto(BASE);
  await page.getByTestId("go-word").click();
  const input = page.getByTestId("word-input");
  await input.fill("Charlotte");
  await page.locator('.tile[data-kana="と"]').waitFor();
  await input.blur();
  await capture(page, device, "06-word-entry-name", "Word entry: a known name");
  await input.fill("dog");
  await page.locator(".chip").first().waitFor();
  await input.blur();
  await capture(page, device, "07-word-entry-choice", "Word entry: sound or Japanese word");
  await input.fill("neko");
  await page.getByTestId("hint").filter({ hasText: "Spelled by sound" }).waitFor();
  await page.locator(".tile[data-kana]").first().click();
  await capture(page, device, "08-word-entry-by-sound", "Word entry: spelled by sound, tile selected");

  // Writing: the word "Emma" (え has 2 strokes).
  await input.fill("Emma");
  await page.locator('.tile[data-kana="ま"]').waitFor();
  await page.getByTestId("start").click();
  await ready(page, 1, 0);
  await page.waitForTimeout(2600); // let the first demo finish
  await capture(page, device, "09-write-step1-follow-me", "Writing step 1: follow me");
  await draw(page, strokes["え"].strokes[0].points);
  await page.waitForTimeout(250);
  await capture(page, device, "10-write-step1-stroke-done", "Writing step 1: stroke accepted (sparkles)");
  await finishPhase(page, "え", 1, 1);
  await ready(page, 2, 0);
  await page.waitForTimeout(600);
  await capture(page, device, "11-write-step2-trace", "Writing step 2: trace");
  await draw(page, strokes["え"].strokes[1].points); // stroke 2 first
  await page.waitForTimeout(450);
  await capture(page, device, "12-write-order-slip", "Writing: order slip (this one first)");
  const scribble = [[0.85, 0.85], [0.9, 0.9], [0.86, 0.95], [0.92, 0.88]];
  await page.waitForTimeout(2200);
  await draw(page, scribble);
  await page.waitForTimeout(400);
  await capture(page, device, "13-write-try-again-dot", "Writing: try again, start at the green dot");
  await page.waitForTimeout(2600);
  await draw(page, scribble);
  await page.waitForTimeout(1500);
  await capture(page, device, "14-write-follow-me-fallback", "Writing: follow-me fallback after 3 misses");
  await finishPhase(page, "え", 2);
  await ready(page, 3, 0);
  await page.waitForTimeout(600);
  await capture(page, device, "15-write-step3-write", "Writing step 3: write it yourself");
  await draw(page, strokes["え"].strokes[0].points);
  await page.waitForTimeout(700);
  await capture(page, device, "16-write-step3-in-progress", "Writing step 3: in progress");
  await finishPhase(page, "え", 3, 1);
  await page.waitForTimeout(550);
  await capture(page, device, "17-write-celebration", "Writing: letter finished (rainbow stars)");
  for (const p of [1, 2, 3]) await finishPhase(page, "ま", p);
  await page.getByTestId("my-word").waitFor();
  await page.waitForTimeout(450);
  await capture(page, device, "18-my-word-celebration", "My word: celebration");
  await page.waitForTimeout(2600);
  await capture(page, device, "19-my-word", "My word: summary");

  await page.goto(BASE);
  const gear = page.getByRole("button", { name: "Grown-ups" });
  await gear.hover();
  await page.mouse.down();
  await page.waitForTimeout(1700);
  await page.mouse.up();
  await page.locator(".parent-body").waitFor();
  await capture(page, device, "20-grown-ups", "Grown-ups: settings, history, backup", { full: true });
  await page.context().close();
}

{
  const device = "tablet-landscape";
  console.log(device);
  const page = await newPage(device);
  await page.goto(BASE);
  await page.getByTestId("go-word").waitFor();
  await capture(page, device, "01-home-first-visit", "Home, first visit");
  await page.getByTestId("go-word").click();
  await page.getByTestId("word-input").fill("Charlotte");
  await page.locator(".tile[data-kana]").nth(5).waitFor();
  await page.getByTestId("start").click();
  await ready(page, 1, 0);
  await page.waitForTimeout(2600);
  await capture(page, device, "09-write-step1-follow-me", "Writing step 1: follow me");
  await finishPhase(page, "し", 1);
  await finishPhase(page, "し", 2);
  await ready(page, 3, 0);
  await page.waitForTimeout(600);
  await capture(page, device, "15-write-step3-write", "Writing step 3: write it yourself");
  await page.context().close();
}

// ---------- assets ----------

{
  const page = await newPage("tablet");
  await page.goto(BASE);
  await page.getByTestId("go-word").waitFor();
  const { icons, mascots, guide, ink } = await page.evaluate(async () => {
    const dom = await import("/src/ui/dom.ts");
    const board = await import("/src/ui/board.ts");
    const palette = await import("/src/ui/palette.ts");
    const icons = {};
    for (const [k, v] of Object.entries(dom.ICON)) {
      const holder = document.createElement("div");
      holder.innerHTML = v;
      const svg = holder.firstElementChild;
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("width", "48");
      svg.setAttribute("height", "48");
      icons[k] = svg.outerHTML.replaceAll("currentColor", "#4a3b35");
    }
    const mascots = {};
    for (const mood of ["happy", "cheer"]) {
      const m = dom.mascot("mascot", mood);
      m.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      m.removeAttribute("class");
      mascots[mood] = m.outerHTML;
    }
    return { icons, mascots, guide: board.GUIDE_COLORS, ink: palette.INK_COLORS };
  });
  for (const [k, v] of Object.entries(icons)) writeFileSync(new URL(`assets/icons/${k}.svg`, OUT), v);
  for (const [k, v] of Object.entries(mascots)) writeFileSync(new URL(`assets/mascot-${k}.svg`, OUT), v);
  writeFileSync(new URL("assets/app-icon.svg", OUT), readFileSync(new URL("public/icon.svg", root)));

  // Every practice glyph from the KanjiVG data, in textbook stroke shapes.
  const hidden = new Set("ゐゑゔゕゖ");
  for (const [k, g] of Object.entries(strokes)) {
    if (hidden.has(k)) continue;
    const name = `${(table.kana[k]?.romaji ?? "").replace(/[^a-z]/g, "") || g.codepoint.replace("U+", "")}-${k}`;
    const paths = g.strokes.map((s, i) => `<path id="stroke-${i + 1}" d="${s.d}"/>`).join("");
    writeFileSync(
      new URL(`assets/kana/${table.kana[k]?.small ? "small-" : ""}${name}.svg`, OUT),
      `<svg xmlns="http://www.w3.org/2000/svg" width="109" height="109" viewBox="0 0 109 109" fill="none" stroke="#4a3b35" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>\n`,
    );
  }

  // Design tokens from :root in styles.css plus the canvas colours.
  const css = readFileSync(new URL("src/styles.css", root), "utf8");
  const rootBlock = css.match(/:root\s*\{([\s\S]*?)\}/)[1];
  const vars = Object.fromEntries([...rootBlock.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const color = (v) => ({ $type: "color", $value: v });
  const tokens = {
    color: Object.fromEntries(Object.entries(vars).filter(([, v]) => v.startsWith("#")).map(([k, v]) => [k, color(v)])),
    ink: Object.fromEntries(ink.map((c, i) => [["orange", "pink", "blue", "green", "purple"][i] ?? `ink${i}`, color(c)])),
    writingCell: Object.fromEntries(Object.entries(guide).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, color(v)])),
    sparkle: Object.fromEntries((guide.sparkle ?? []).map((c, i) => [`sparkle${i + 1}`, color(c)])),
    radius: { card: { $type: "dimension", $value: vars.radius }, pill: { $type: "dimension", $value: "999px" } },
    size: { tapTarget: { $type: "dimension", $value: vars.tap }, swatch: { $type: "dimension", $value: "52px" } },
    font: { family: { $type: "fontFamily", $value: vars.font.split(",").map((f) => f.trim().replace(/"/g, "")) } },
  };
  writeFileSync(new URL("tokens.json", OUT), JSON.stringify(tokens, null, 2));
  await page.context().close();
}

await browser.close();
await server.close();

// ---------- README ----------

const byDevice = (d) => index.filter((i) => i.device === d).map((i) => `| \`${i.file}\` | ${i.label} |`).join("\n");
writeFileSync(
  new URL("README.md", OUT),
  `# Hiragana Buddy — UI export for Figma

Generated by \`npm run design-export\` from the running app (${new Date().toISOString().slice(0, 10)}).

## Into Figma (editable)

1. In a Figma Design file, drag the files from \`screens-svg/\` onto the canvas (or File → Import).
2. Each screen arrives as a frame of real layers: rounded rectangles with their fills,
   borders and drop-shadow effects, vector icons and kana, and text layers.
   Layers are named after the app's buttons and parts (e.g. "Home", "Play-it", "palette").
3. The writing cell (paper, guide strokes, the child's ink, sparkles) is drawn on a
   canvas in the app, so it comes in as an image layer. Use \`assets/kana/\` for the
   vector letters if you want to redesign the cell.
4. Text uses the app's system font stack. If Figma flags a missing font, swap in a
   rounded font such as Nunito or M PLUS Rounded 1c.

## Into Figma Make

Figma Make works from prompts plus attachments. Either:
- copy redesigned frames from Figma Design into Make, or
- attach PNGs from \`screens-png/\` (2x) and describe the change.

## Bringing a redesign back into the app

Share the Figma frame link with Claude Code. It can read Figma frames and update
\`src/styles.css\` and the screens to match.

## Contents

- \`screens-svg/\`, \`screens-png/\`: each screen at phone (393×852), tablet (820×1180)
  and tablet landscape (1180×820, home and writing only). Tall screens are full-page.
- \`assets/icons/\`: every UI icon (48×48 vectors). \`assets/mascot-*.svg\`, \`assets/app-icon.svg\`.
- \`assets/kana/\`: every practice glyph from KanjiVG (CC BY-SA 3.0 — keep the credit),
  one path per stroke in stroke order, named by romaji.
- \`tokens.json\`: colours, ink colours, writing-cell colours, radii, tap size and font
  stack in W3C design-token format (importable as Figma variables with a tokens plugin,
  or Figma's own variable import where available).

### Phone
| File | Screen |
| --- | --- |
${byDevice("phone")}

### Tablet
| File | Screen |
| --- | --- |
${byDevice("tablet")}

### Tablet landscape
| File | Screen |
| --- | --- |
${byDevice("tablet-landscape")}
`,
);
console.log(`\n${index.length} screens exported to design-export/`);
