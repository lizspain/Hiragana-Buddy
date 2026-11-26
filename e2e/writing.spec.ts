import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { readFileSync } from "node:fs";

type Pt = [number, number];
const data = JSON.parse(readFileSync(new URL("../data/kana-strokes.json", import.meta.url), "utf8")).kana as Record<
  string,
  { strokes: { points: Pt[] }[] }
>;

const stage = (page: Page) => page.getByTestId("stage");

async function cellToPage(page: Page): Promise<(p: Pt) => Pt> {
  const box = (await stage(page).boundingBox())!;
  const [x, y, size] = (await stage(page).getAttribute("data-cell"))!.split(",").map(Number);
  return ([u, v]) => [box.x + x + u * size, box.y + y + v * size];
}

/** Draw a stroke with the mouse along cell-unit points. */
async function drawMouse(page: Page, pts: Pt[]) {
  const map = await cellToPage(page);
  const [sx, sy] = map(pts[0]);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (const p of pts.slice(1)) {
    const [x, y] = map(p);
    await page.mouse.move(x, y, { steps: 2 });
  }
  await page.mouse.up();
}

async function waitReady(page: Page, phase: number, strokeIdx: number) {
  await expect(stage(page)).toHaveAttribute("data-phase", String(phase));
  await expect(stage(page)).toHaveAttribute("data-stroke", String(strokeIdx));
  await expect(stage(page)).toHaveAttribute("data-busy", "false");
}

async function openLetter(page: Page, kana: string) {
  await page.goto("/");
  await page.getByTestId("go-letter").click();
  await page.locator(`[data-kana="${kana}"]`).click();
  await expect(stage(page)).toHaveAttribute("data-kana", kana);
}

test("draw あ correctly with a mouse in all three phases → 3 stars", async ({ page }) => {
  await openLetter(page, "あ");
  const strokes = data["あ"].strokes;
  for (const phase of [1, 2, 3]) {
    for (let k = 0; k < strokes.length; k++) {
      await waitReady(page, phase, k);
      await drawMouse(page, strokes[k].points);
      await expect(stage(page)).toHaveAttribute("data-outcome", "accept");
    }
  }
  await page.waitForTimeout(650); // mid-celebration
  await page.screenshot({ path: `test-results/celebrate-${test.info().project.name}.png` });
  const word = page.getByTestId("my-word");
  await expect(word).toBeVisible({ timeout: 10_000 });
  await expect(word).toHaveAttribute("data-stars", "3");
  await page.waitForTimeout(2000); // the burst waits for the third star to fill
  await page.screenshot({ path: `test-results/done-burst-${test.info().project.name}.png` });
  await expect(page.locator(".done-corners")).toHaveClass(/show/);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `test-results/done-${test.info().project.name}.png` });

  // The octopus keeps dancing (loops): past the old 3.2 s stop, frames still change.
  await expect(page.getByTestId("done-home")).toBeVisible();
  await page.waitForTimeout(2500);
  const frame = () => page.evaluate(() => document.querySelector<HTMLCanvasElement>(".dance")!.toDataURL());
  const a = await frame();
  await page.waitForTimeout(350);
  expect(await frame()).not.toBe(a);

  // Saved to history: the big blue Home goes back, and the shelf shows it with a Play it button.
  await page.getByTestId("done-home").click();
  await expect(page.getByTestId("shelf-card")).toHaveCount(1);
  await expect(page.getByTestId("shelf-card").getByRole("button", { name: "Play it" })).toBeVisible();
  await expect(page.getByTestId("shelf-card")).toContainText("a");
  await page.screenshot({ path: `test-results/shelf-letter-${test.info().project.name}.png` });
});

test("a practised word's card shows what was typed and plays it", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { clipStarts: number };
    w.clipStarts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      if ((this.buffer?.duration ?? 0) > 0.05) w.clipStarts++; // voice clips, not the 40 ms button "tok"
      return start.apply(this, args);
    };
  });
  await page.goto("/");
  await page.getByTestId("go-word").click();
  await page.getByTestId("word-input").fill("neko");
  await page.getByTestId("start").click();
  for (const k of ["ね", "こ"]) {
    const strokes = data[k].strokes;
    for (const phase of [1, 2, 3]) {
      for (let n = 0; n < strokes.length; n++) {
        await expect(stage(page)).toHaveAttribute("data-kana", k);
        await waitReady(page, phase, n);
        await drawMouse(page, strokes[n].points);
      }
    }
  }
  await expect(page.getByTestId("my-word")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Home" }).first().click();
  const card = page.getByTestId("shelf-card");
  await expect(card).toContainText("neko");
  await page.screenshot({ path: `test-results/shelf-${test.info().project.name}.png` });
  const before = await page.evaluate(() => (window as unknown as { clipStarts: number }).clipStarts);
  await card.getByRole("button", { name: "Play it" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { clipStarts: number }).clipStarts)).toBeGreaterThan(before);
  await expect(page.locator("body")).toHaveAttribute("data-screen", "home"); // playing doesn't start practice
});

test("drawing stroke 2 first gives the order message, not a failure", async ({ page }) => {
  await openLetter(page, "あ");
  const strokes = data["あ"].strokes;
  await waitReady(page, 1, 0);
  await drawMouse(page, strokes[1].points);
  await expect(stage(page)).toHaveAttribute("data-outcome", "order");
  await expect(stage(page)).toHaveAttribute("data-stroke", "0");
  await page.screenshot({ path: `test-results/order-${test.info().project.name}.png` });
  await drawMouse(page, strokes[0].points);
  await expect(stage(page)).toHaveAttribute("data-outcome", "accept");
  await expect(stage(page)).toHaveAttribute("data-stroke", "1");
});

test("a tap outside the cell while drawing does not interrupt the stroke", async ({ page }) => {
  await openLetter(page, "い");
  const pts = data["い"].strokes[0].points;
  await waitReady(page, 1, 0);
  const map = await cellToPage(page);
  const cdp = await page.context().newCDPSession(page);
  await page.mouse.move(...map(pts[0]));
  await page.mouse.down();
  for (const p of pts.slice(1, 16)) await page.mouse.move(...map(p), { steps: 2 });
  // A finger taps the top bar area, outside the cell.
  const outside = { x: 30, y: 30, id: 7 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [outside] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  for (const p of pts.slice(16)) await page.mouse.move(...map(p), { steps: 2 });
  await page.mouse.up();
  await expect(stage(page)).toHaveAttribute("data-outcome", "accept");
});

test("two touches at once (a large palm at the cell edge) still give one clean stroke", async ({ page }) => {
  await openLetter(page, "い");
  const pts = data["い"].strokes[0].points;
  await waitReady(page, 1, 0);
  const map = await cellToPage(page);
  const [x, y, size] = (await stage(page).getAttribute("data-cell"))!.split(",").map(Number);
  const box = (await stage(page).boundingBox())!;
  const palm = { x: box.x + x + size * 0.97, y: box.y + y + size * 0.9, radiusX: 35, radiusY: 35, id: 2 };
  const pen = (p: Pt) => {
    const [px, py] = map(p);
    return { x: px, y: py, radiusX: 4, radiusY: 4, id: 1 };
  };
  const cdp = await page.context().newCDPSession(page);
  // Palm lands first, the finger a moment later; then both move.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [palm] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [palm, pen(pts[0])] });
  for (const p of pts.slice(1)) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...palm, x: palm.x + 2 }, pen(p)] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [palm] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(stage(page)).toHaveAttribute("data-outcome", "accept");
  await expect(stage(page)).toHaveAttribute("data-stroke", "1");
});

/**
 * A hand resting on the screen edge, then a finger drawing stroke 1 of い.
 * The hand lands just inside the cell's 12 px margin (where a hand holding a
 * phone lands) and is small enough not to be caught by the contact-size rule.
 */
async function palmThenFinger(page: Page, palmRadius: number, fingerRadius: number) {
  await waitReady(page, 1, 0);
  const pts = data["い"].strokes[0].points;
  const map = await cellToPage(page);
  const [x, y, size] = (await stage(page).getAttribute("data-cell"))!.split(",").map(Number);
  const box = (await stage(page).boundingBox())!;
  const palm = { x: box.x + x - 6, y: box.y + y + size * 0.6, radiusX: palmRadius, radiusY: palmRadius, id: 2 };
  const finger = (p: Pt) => {
    const [px, py] = map(p);
    return { x: px, y: py, radiusX: fingerRadius, radiusY: fingerRadius, id: 1 };
  };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [palm] });
  await page.waitForTimeout(400); // resting well past the 150 ms palm window
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...palm, x: palm.x + 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...palm, x: palm.x + 1 }, finger(pts[0])] });
  for (const p of pts.slice(1)) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...palm, x: palm.x + 1 }, finger(p)] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ ...palm, x: palm.x + 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(stage(page)).toHaveAttribute("data-outcome", "accept");
  await expect(stage(page)).toHaveAttribute("data-stroke", "1");
}

test("a hand resting on the edge does not block the drawing finger", async ({ page }) => {
  await openLetter(page, "い");
  await palmThenFinger(page, 15, 4); // 30 px contact: under the 40 px palm size
});

test("a hand landing on the edge mid-stroke does not cut the stroke", async ({ page }) => {
  await openLetter(page, "い");
  await waitReady(page, 1, 0);
  const pts = data["い"].strokes[0].points;
  const map = await cellToPage(page);
  const [x, y, size] = (await stage(page).getAttribute("data-cell"))!.split(",").map(Number);
  const box = (await stage(page).boundingBox())!;
  const palm = { x: box.x + x - 6, y: box.y + y + size * 0.6, radiusX: 15, radiusY: 15, id: 2 };
  const finger = (p: Pt) => {
    const [px, py] = map(p);
    return { x: px, y: py, radiusX: 4, radiusY: 4, id: 1 };
  };
  const cdp = await page.context().newCDPSession(page);
  const half = Math.ceil(pts.length / 2);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger(pts[0])] });
  for (const p of pts.slice(1, half)) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [finger(p)] });
  await page.waitForTimeout(250); // past the palm window, mid-stroke
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger(pts[half - 1]), palm] });
  for (const p of pts.slice(half)) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [finger(p), palm] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [palm] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(stage(page)).toHaveAttribute("data-outcome", "accept");
  await expect(stage(page)).toHaveAttribute("data-stroke", "1");
});

test.describe("on iPad", () => {
  // iPadOS Safari reports a fingertip as ~42 px across (2 × a ~21 pt radius).
  test.use({
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });

  async function touchStroke(page: Page, pts: Pt[], radius: number) {
    const map = await cellToPage(page);
    const tp = (p: Pt) => {
      const [x, y] = map(p);
      return { x, y, radiusX: radius, radiusY: radius, id: 1 };
    };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [tp(pts[0])] });
    for (const p of pts.slice(1)) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [tp(p)] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  // The one-time "Add to Home Screen" tip shows first on iOS; a grown-up taps OK.
  async function openOnIPad(page: Page, kana: string) {
    await page.goto("/");
    await page.getByRole("button", { name: "OK" }).click();
    await page.getByTestId("go-letter").click();
    await page.locator(`[data-kana="${kana}"]`).click();
    await expect(stage(page)).toHaveAttribute("data-kana", kana);
  }

  test("a finger draws", async ({ page }) => {
    await openOnIPad(page, "い");
    await waitReady(page, 1, 0);
    await touchStroke(page, data["い"].strokes[0].points, 21);
    await expect(stage(page)).toHaveAttribute("data-outcome", "accept");
    await expect(stage(page)).toHaveAttribute("data-stroke", "1");
  });

  test("a hand resting on the edge does not block the drawing finger", async ({ page }) => {
    await openOnIPad(page, "い");
    await palmThenFinger(page, 26, 21); // iOS sizes: 52 px hand (under the 72 px limit), 42 px finger
  });

  test("a resting hand still does nothing", async ({ page }) => {
    await openOnIPad(page, "い");
    await waitReady(page, 1, 0);
    await touchStroke(page, data["い"].strokes[0].points, 45);
    await page.waitForTimeout(300);
    await expect(stage(page)).toHaveAttribute("data-stroke", "0");
    await expect(stage(page)).not.toHaveAttribute("data-outcome", "accept");
  });
});

test("a romaji word goes through the tile editor into practice", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("go-word").click();
  // Not in the English list → spelled by sound automatically, no toggle.
  await page.getByTestId("word-input").fill("neko");
  await expect(page.getByTestId("tiles").locator(".tile:not(.add)")).toHaveCount(2);
  await expect(page.getByTestId("hint")).toHaveText(""); // the tiles speak for themselves
  await page.getByTestId("word-input").fill("Charlotte");
  await expect(page.getByTestId("hint")).toHaveText("");
  await expect(page.getByTestId("tiles").locator(".tile:not(.add)")).toHaveCount(6);
  await expect(page.getByTestId("max-reached")).toHaveCount(0);
  await page.screenshot({ path: `test-results/entry-${test.info().project.name}.png` });
  await page.getByTestId("start").click();
  await expect(stage(page)).toHaveAttribute("data-kana", "し");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-results/write-${test.info().project.name}.png` });
});

test("at 14 sounds the add tile gives way to a note", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("go-word").click();
  await page.getByTestId("word-input").fill("aiueokakikukekosasisuse"); // exactly 14 sounds
  await expect(page.getByTestId("tiles").locator(".tile:not(.add)")).toHaveCount(14);
  await expect(page.getByTestId("tiles").locator(".tile.add")).toHaveCount(0);
  await expect(page.getByTestId("max-reached")).toHaveText("Max 14 sounds");
  await page.getByTestId("word-input").fill("aiueokakikukekosasisu"); // 13: room for one more
  await expect(page.getByTestId("tiles").locator(".tile.add")).toHaveCount(1);
  await expect(page.getByTestId("max-reached")).toHaveCount(0);
});

for (const phase of [2, 3]) {
  test(`phase ${phase}: three misses on a stroke switch it to follow-me, then it can be traced`, async ({ page }) => {
    await openLetter(page, "い");
    const strokes = data["い"].strokes;
    for (let p = 1; p < phase; p++) {
      for (let k = 0; k < strokes.length; k++) {
        await waitReady(page, p, k);
        await drawMouse(page, strokes[k].points);
      }
    }
    await waitReady(page, phase, 0);
    const scribble: Pt[] = [[0.85, 0.85], [0.9, 0.9], [0.86, 0.95], [0.92, 0.88]];
    for (let i = 0; i < 3; i++) {
      await expect(stage(page)).toHaveAttribute("data-follow", "false");
      await drawMouse(page, scribble);
      await expect(stage(page)).toHaveAttribute("data-outcome", "retry");
    }
    await expect(stage(page)).toHaveAttribute("data-follow", "true");
    await page.waitForTimeout(700); // demo is playing
    await page.screenshot({ path: `test-results/follow-p${phase}-${test.info().project.name}.png` });
    await drawMouse(page, strokes[0].points);
    await expect(stage(page)).toHaveAttribute("data-outcome", "accept");
    await expect(stage(page)).toHaveAttribute("data-follow", "false");
    await expect(stage(page)).toHaveAttribute("data-stroke", "1");
  });
}

test("speaker buttons play recorded clips when they exist", async ({ page }) => {
  // One-second 440 Hz WAV standing in for a recording.
  const rate = 8000;
  const wav = Buffer.alloc(44 + rate * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + rate * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(rate * 2, 40);
  for (let i = 0; i < rate; i++) wav.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);

  await page.route("**/audio/manifest.json", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ ja: { ね: "t.wav", こ: "t.wav" }, en: {} }) }),
  );
  await page.route("**/audio/t.wav", (r) => r.fulfill({ contentType: "audio/wav", body: wav }));
  await page.addInitScript(() => {
    const w = window as unknown as { clipStarts: number };
    w.clipStarts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      if ((this.buffer?.duration ?? 0) > 0.05) w.clipStarts++; // voice clips, not the 40 ms button "tok"
      return start.apply(this, args);
    };
  });
  await page.goto("/");
  await page.getByTestId("go-word").click();
  await page.getByTestId("word-input").fill("neko");
  await expect(page.getByTestId("tiles").locator(".tile:not(.add)")).toHaveCount(2);
  await page.getByRole("button", { name: "Hear it" }).click();
  // Sounded out from mora clips: ね + こ.
  await expect.poll(() => page.evaluate(() => (window as unknown as { clipStarts: number }).clipStarts)).toBe(2);
});

test("the shipped Japanese clips play for a kana and for a dictionary word", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { clipStarts: number };
    w.clipStarts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      if ((this.buffer?.duration ?? 0) > 0.05) w.clipStarts++; // voice clips, not the 40 ms button "tok"
      return start.apply(this, args);
    };
  });
  const starts = () => page.evaluate(() => (window as unknown as { clipStarts: number }).clipStarts);
  await page.goto("/");
  await page.getByTestId("go-word").click();
  await page.getByTestId("word-input").fill("Emma");
  await expect(page.getByTestId("tiles").locator(".tile:not(.add)")).toHaveCount(2);
  await page.getByTestId("tiles").locator(".tile").first().click(); // え
  await expect.poll(starts).toBe(1);
  await page.getByRole("button", { name: "Hear it" }).click(); // えま has its own clip
  await expect.poll(starts).toBe(2);
});

test("voice lines take turns with a pause between them", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("go-letter").click(); // a user gesture so audio may start
  const starts = await page.evaluate(async () => {
    const log: { at: number; dur: number; ctx: string }[] = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when?: number, ...rest: number[]) {
      // Real time the clip is due to start: wall clock now + how far ahead it's scheduled.
      // (The audio clock alone can stall while a headless browser's audio starts up.)
      const ahead = Math.max(0, (when ?? this.context.currentTime) - this.context.currentTime);
      if ((this.buffer?.duration ?? 0) > 0.05) log.push({ at: performance.now() / 1000 + ahead, dur: this.buffer?.duration ?? 0, ctx: this.context.state });
      return start.call(this, when, ...rest);
    };
    // Served by the Vite dev server; a variable keeps TypeScript from resolving it here.
    const path = "/src/ui/audio.ts";
    const audio = (await import(path)) as typeof import("../src/ui/audio");
    audio.unlockAudio();
    audio.sayKana("あ", false);
    audio.sayKana("い", false);
    audio.sayWord(["ね", "こ"], false);
    await new Promise((r) => setTimeout(r, 4000));
    return log;
  });
  expect(starts.length).toBe(3); // あ, い, ねこ (its own clip: the Japanese word for "cat")
  // あ → い → ねこ: each starts after the previous line ends, plus a pause.
  expect(starts[1].at).toBeGreaterThanOrEqual(starts[0].at + starts[0].dur + 0.2);
  expect(starts[2].at).toBeGreaterThanOrEqual(starts[1].at + starts[1].dur + 0.2);
});

test("ink colour is picked on the drawing screen and recolours the letter", async ({ page }) => {
  await expect(async () => {
    await page.goto("/");
    await expect(page.getByTestId("palette")).toHaveCount(0); // not on the home page any more
  }).toPass();
  await openLetter(page, "い");
  await waitReady(page, 1, 0);
  const pts = data["い"].strokes[0].points;
  await drawMouse(page, pts);
  await expect(stage(page)).toHaveAttribute("data-outcome", "accept");

  // Colour of the ink layer at the middle of the accepted stroke.
  const inkAt = (p: Pt) =>
    page.evaluate(([u, v]) => {
      const s = document.querySelector<HTMLElement>("[data-testid=stage]")!;
      const [x, y, size] = s.dataset.cell!.split(",").map(Number);
      const c = s.querySelector<HTMLCanvasElement>(".layer-ink")!;
      const k = c.width / s.clientWidth;
      const d = c.getContext("2d")!.getImageData(Math.round((x + u * size) * k), Math.round((y + v * size) * k), 1, 1).data;
      return [d[0], d[1], d[2]];
    }, p);
  expect(await inkAt(pts[16])).toEqual([0xd9, 0x77, 0x06]); // default amber

  await page.getByTestId("palette").locator('[data-color="#f87171"]').click();
  await expect(page.getByTestId("palette").locator('[data-color="#f87171"]')).toHaveAttribute("aria-checked", "true");
  expect(await inkAt(pts[16])).toEqual([0xf8, 0x71, 0x71]); // coral, same stroke
  await page.screenshot({ path: `test-results/palette-portrait-${test.info().project.name}.png` });

  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: vp.height, height: vp.width });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `test-results/palette-landscape-${test.info().project.name}.png` });

  // The choice is remembered.
  await page.reload();
  await openLetter(page, "う");
  await expect(page.getByTestId("palette").locator('[data-color="#f87171"]')).toHaveAttribute("aria-checked", "true");
});

test("drawing makes a soft sand sound, built once and only while the finger moves", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { sandLoops: number; sandGain: number[] };
    w.sandLoops = 0;
    w.sandGain = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      if (this.loop) w.sandLoops++;
      return start.apply(this, args);
    };
    const target = AudioParam.prototype.setTargetAtTime;
    AudioParam.prototype.setTargetAtTime = function (v: number, t: number, c: number) {
      if (this.maxValue > 1e30 && this.defaultValue === 1) w.sandGain.push(v); // GainNode.gain
      return target.call(this, v, t, c);
    };
  });
  await openLetter(page, "い");
  await waitReady(page, 1, 0);
  await drawMouse(page, data["い"].strokes[0].points);
  await waitReady(page, 1, 1);
  await drawMouse(page, data["い"].strokes[1].points);
  const r = await page.evaluate(() => {
    const w = window as unknown as { sandLoops: number; sandGain: number[] };
    return { sandLoops: w.sandLoops, sandGain: w.sandGain };
  });
  expect(r.sandLoops).toBe(1); // one looping sand source for the whole session
  expect(Math.max(...r.sandGain)).toBeGreaterThan(0); // audible while moving
  expect(r.sandGain.at(-1)).toBe(0); // silent once the stroke ends
});

test("no requests leave the site", async ({ page }) => {
  const foreign: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://localhost:5174")) foreign.push(r.url());
  });
  await openLetter(page, "か");
  await page.getByTestId("stage").waitFor();
  expect(foreign).toEqual([]);
});

test("after three together tries that miss, the stroke is filled in and the letter moves on", async ({ page }) => {
  await openLetter(page, "あ");
  for (let i = 0; i < 6; i++) {
    await waitReady(page, 1, 0);
    await drawMouse(page, [[0.85, 0.85], [0.9, 0.88], [0.86, 0.92]]);
    await page.waitForTimeout(300);
  }
  await expect(stage(page)).toHaveAttribute("data-outcome", "moveOn");
  await expect(stage(page)).toHaveAttribute("data-stroke", "1");
  await expect(stage(page)).toHaveAttribute("data-together", "false");
});

// Bug: after "Oops" on the do-it-yourself step, the filled-in model stroke was
// scored as the child's drawing and a one-stroke letter earned 3 stars. A letter
// the app traced entirely by itself now gets 0 stars (agreed Nov 2026).
test("a letter finished by \"Oops\" on the do-it-yourself step gets 0 stars, not 3", async ({ page }) => {
  await openLetter(page, "し");
  const stroke = data["し"].strokes[0].points;
  for (const phase of [1, 2]) {
    await waitReady(page, phase, 0);
    await drawMouse(page, stroke);
    await expect(stage(page)).toHaveAttribute("data-outcome", "accept");
  }
  // Phase 3: replay, pulse, three follow-me, three together, then "Oops".
  for (let i = 0; i < 9; i++) {
    await waitReady(page, 3, 0);
    await drawMouse(page, [[0.85, 0.85], [0.9, 0.88], [0.86, 0.92]]);
    await page.waitForTimeout(300);
  }
  const word = page.getByTestId("my-word");
  await expect(word).toBeVisible({ timeout: 15_000 });
  await expect(word).toHaveAttribute("data-stars", "0");
  await expect(page.locator(".stars.big .star")).toHaveCount(3); // three grey stars
  await expect(page.locator(".stars.big .star.on")).toHaveCount(0);
});

test("tapping a tile in the tile editor plays that kana's VOICEVOX clip", async ({ page }) => {
  const played: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/audio/kana/") && r.url().endsWith(".mp3")) played.push(new URL(r.url()).pathname.split("/").pop()!);
  });
  await page.goto("/");
  await page.getByTestId("go-word").click();
  await page.getByTestId("word-input").fill("neko");
  await expect(page.getByTestId("tiles").locator(".tile:not(.add)")).toHaveCount(2);
  await page.getByTestId("tiles").locator(".tile").first().click(); // ね
  await expect.poll(() => played).toContain("ne.mp3");
  await page.getByTestId("tiles").locator(".tile").nth(1).click(); // こ
  await expect.poll(() => played).toContain("ko.mp3");
});

test("the About screen credits the kana voice, as its terms require", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Settings/ }).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Enter"); // the hold gate's keyboard route
  const credit = page.getByTestId("kana-voice-credit");
  await expect(credit).toContainText("VOICEVOX:四国めたん");
  await expect(credit.getByRole("link", { name: "VOICEVOX:四国めたん" })).toHaveAttribute("href", "https://voicevox.hiroshiba.jp/");
  await expect(credit.getByRole("link", { name: "voice terms" })).toHaveAttribute("href", "https://zunko.jp/con_ongen_kiyaku.html");
});

test("a sounded-out word leaves space between the kana voice's sounds", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { starts: { when: number; dur: number }[] };
    w.starts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, ...rest: number[]) {
      if ((this.buffer?.duration ?? 0) > 0.1) w.starts.push({ when, dur: this.buffer!.duration }); // voice, not the button "tok"
      return start.call(this, when, ...rest);
    };
  });
  await page.goto("/");
  await page.getByTestId("go-word").click();
  await page.getByTestId("word-input").fill("kasa"); // no whole-word clip: sounded out as か・さ
  await expect(page.getByTestId("tiles").locator(".tile:not(.add)")).toHaveCount(2);
  await page.getByRole("button", { name: "Hear it" }).click();
  const starts = () => page.evaluate(() => (window as unknown as { starts: { when: number; dur: number }[] }).starts);
  await expect.poll(async () => (await starts()).length).toBe(2);
  const [ka, sa] = await starts();
  // さ starts only after the whole か clip (with its 30 ms of quiet) plus a gap: no overlap.
  expect(sa.when - (ka.when + ka.dur)).toBeGreaterThanOrEqual(0.05);
});
