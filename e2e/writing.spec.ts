import { expect, test, type Page } from "@playwright/test";
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
  await page.screenshot({ path: `test-results/done-${test.info().project.name}.png` });

  // Saved to history: the home shelf shows it, with a Play it button.
  await page.getByRole("button", { name: "Home" }).first().click();
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
      w.clipStarts++;
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

test("a romaji word goes through the tile editor into practice", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("go-word").click();
  // Not in the English list → spelled by sound automatically, no toggle.
  await page.getByTestId("word-input").fill("neko");
  await expect(page.getByTestId("tiles").locator(".tile:not(.add)")).toHaveCount(2);
  await expect(page.getByTestId("hint")).toContainText("Spelled by sound");
  await page.getByTestId("word-input").fill("Charlotte");
  await expect(page.getByTestId("hint")).toHaveText("");
  await expect(page.getByTestId("tiles").locator(".tile:not(.add)")).toHaveCount(6);
  await expect(page.locator(".mora-count")).toHaveText("5 / 14 sounds");
  await page.screenshot({ path: `test-results/entry-${test.info().project.name}.png` });
  await page.getByTestId("start").click();
  await expect(stage(page)).toHaveAttribute("data-kana", "し");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-results/write-${test.info().project.name}.png` });
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
      w.clipStarts++;
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
      w.clipStarts++;
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
    const log: { at: number; dur: number }[] = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when?: number, ...rest: number[]) {
      log.push({ at: when ?? this.context.currentTime, dur: this.buffer?.duration ?? 0 });
      return start.call(this, when, ...rest);
    };
    const audio = await import("/src/ui/audio.ts");
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

test("no requests leave the site", async ({ page }) => {
  const foreign: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://localhost:5174")) foreign.push(r.url());
  });
  await openLetter(page, "か");
  await page.getByTestId("stage").waitFor();
  expect(foreign).toEqual([]);
});
