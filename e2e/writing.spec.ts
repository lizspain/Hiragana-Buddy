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
  const word = page.getByTestId("my-word");
  await expect(word).toBeVisible({ timeout: 10_000 });
  await expect(word).toHaveAttribute("data-stars", "3");
  await page.screenshot({ path: `test-results/done-${test.info().project.name}.png` });

  // Saved to history: the home shelf shows it.
  await page.getByRole("button", { name: "Home" }).first().click();
  await expect(page.locator(".shelf-card")).toHaveCount(1);
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
  await page.getByRole("button", { name: "Sounds (romaji)" }).click();
  await page.getByTestId("word-input").fill("neko");
  await expect(page.getByTestId("tiles").locator(".tile:not(.add)")).toHaveCount(2);
  await page.getByRole("button", { name: "English" }).click();
  await page.getByTestId("word-input").fill("Charlotte");
  await expect(page.getByTestId("tiles").locator(".tile:not(.add)")).toHaveCount(6);
  await expect(page.locator(".mora-count")).toHaveText("5 / 14 sounds");
  await page.screenshot({ path: `test-results/entry-${test.info().project.name}.png` });
  await page.getByTestId("start").click();
  await expect(stage(page)).toHaveAttribute("data-kana", "し");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-results/write-${test.info().project.name}.png` });
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
