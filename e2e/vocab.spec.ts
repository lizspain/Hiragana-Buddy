// Make a Word (docs/VOCAB-SPELLING-DESIGN.md): spell by tap and by drag, the
// finish sequence, and a whole clean game.

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Turn on the grown-ups switch, then open the game from home. */
async function startGame(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open("hiragana-buddy");
      r.onupgradeneeded = () => r.result.createObjectStore("data");
      r.onsuccess = () => res(r.result);
      r.onerror = rej;
    });
    const tx = db.transaction("data", "readwrite");
    const st = tx.objectStore("data");
    const cur = await new Promise((r) => {
      const q = st.get("settings");
      q.onsuccess = () => r(q.result);
    });
    st.put({ ...(cur as object), vocabGame: true }, "settings");
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  });
  await page.reload();
  await page.getByTestId("go-vocab").click();
  await expect(game(page)).toBeVisible();
}

const game = (page: Page) => page.getByTestId("vocab");
const tiles = (page: Page) => page.getByTestId("tiles");
/** A waiting tile with this kana. */
const tile = (page: Page, k: string) => tiles(page).locator(`.match-tile[data-kana="${k}"]:not(.gone)`).first();
const slot = (page: Page, i: number) => page.locator(`.vocab-slot[data-slot="${i}"]`);
const said = (page: Page) => page.evaluate(() => (window as unknown as { vocabSaid: string[] }).vocabSaid);

/** Wait for word `i` to be ready for input; returns its kana. */
async function ready(page: Page, i: number): Promise<string> {
  await expect(game(page)).toHaveAttribute("data-index", String(i), { timeout: 20_000 });
  await expect(game(page)).toHaveAttribute("data-state", "await", { timeout: 20_000 });
  return (await game(page).getAttribute("data-word"))!;
}

/** Drag a tile onto a slot with the mouse, in small steps like a finger. */
async function drag(page: Page, k: string, to: number) {
  const a = (await tile(page, k).boundingBox())!;
  const b = (await slot(page, to).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

/** Spell word `i` cleanly by taps, left to right. */
async function spellByTap(page: Page, i: number) {
  const word = await ready(page, i);
  for (const k of word) await tile(page, k).click();
  return word;
}

test("spell つき by tap: つ, き, then つき is said, and a gold pebble lands", async ({ page }) => {
  await startGame(page);
  for (let i = 0; i < 8; i++) {
    const word = await ready(page, i);
    if (word !== "つき") {
      for (const k of word) await tile(page, k).click();
      continue;
    }
    const before = (await said(page)).length;
    await tile(page, "つ").click();
    await expect(slot(page, 0)).toHaveClass(/filled/);
    await expect(slot(page, 1)).not.toHaveClass(/filled/);
    await tile(page, "き").click();
    await expect(game(page)).toHaveAttribute("data-state", "finish");
    // Each letter, left to right, then the whole word.
    await expect.poll(async () => (await said(page)).slice(before), { timeout: 10_000 }).toEqual(["つ", "き", "tsuki"]);
    await expect(page.locator(`.match-tray .slot >> nth=${i}`)).toHaveAttribute("data-clean", "true", { timeout: 10_000 });
    await expect(page.locator(".match-tray .slot").nth(i).locator(".pebble.gold")).toBeVisible();
    return;
  }
  throw new Error("つき never came up");
});

test("spell つき by drag, き first into the second slot", async ({ page }) => {
  await startGame(page);
  for (let i = 0; i < 8; i++) {
    const word = await ready(page, i);
    if (word !== "つき") {
      for (const k of word) await tile(page, k).click();
      continue;
    }
    await drag(page, "き", 1);
    await expect(slot(page, 1)).toHaveClass(/filled/);
    await expect(slot(page, 0)).not.toHaveClass(/filled/);
    await drag(page, "つ", 0);
    await expect(game(page)).toHaveAttribute("data-state", "finish");
    await expect(page.locator(".match-tray .slot").nth(i)).toHaveAttribute("data-clean", "true", { timeout: 10_000 });
    return;
  }
  throw new Error("つき never came up");
});

test("a wrong tile wiggles back and the word is said again; a drag dropped nowhere costs nothing", async ({ page }) => {
  await startGame(page);
  const word = await ready(page, 0);
  const extra = (await tiles(page).locator(".match-tile").evaluateAll((els, w) => els.map((e) => (e as HTMLElement).dataset.kana!).find((k) => !w.includes(k)), word))!;
  // Dropped far from any slot: slides back, still clean.
  const a = (await tile(page, extra).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y - 400, { steps: 8 });
  await page.mouse.move(5, 5, { steps: 4 });
  await page.mouse.up();
  await expect(game(page)).toHaveAttribute("data-state", "await");
  // Tapped: wrong, the word is said again, then it's ready again.
  const before = (await said(page)).length;
  await tile(page, extra).click();
  await expect(game(page)).toHaveAttribute("data-state", /wrong|prompt/);
  await expect.poll(async () => (await said(page)).length).toBeGreaterThan(before);
  await expect(game(page)).toHaveAttribute("data-state", "await", { timeout: 10_000 });
  await expect(page.locator(".vocab-slot.filled")).toHaveCount(0);
  for (const k of word) await tile(page, k).click();
  await expect(page.locator(".match-tray .slot").first()).toHaveAttribute("data-clean", "false", { timeout: 15_000 });
});

test("three wrong tiles make the next letter glow", async ({ page }) => {
  await startGame(page);
  const word = await ready(page, 0);
  const extra = (await tiles(page).locator(".match-tile").evaluateAll((els, w) => els.map((e) => (e as HTMLElement).dataset.kana!).find((k) => !w.includes(k)), word))!;
  for (let n = 0; n < 3; n++) {
    await expect(game(page)).toHaveAttribute("data-state", "await", { timeout: 10_000 });
    await tile(page, extra).click();
  }
  await expect(tiles(page).locator(".glow")).toHaveCount(1);
  await expect(tiles(page).locator(".glow")).toHaveAttribute("data-kana", word[0]);
});

test("taps while the word is being said do nothing", async ({ page }) => {
  await startGame(page);
  await expect(game(page)).toHaveAttribute("data-state", "prompt");
  const word = (await game(page).getAttribute("data-word"))!;
  await tile(page, word[0]).click();
  await expect(page.locator(".vocab-slot.filled")).toHaveCount(0);
});

test("a game of 8 clean words shows 3 stars", async ({ page }) => {
  test.setTimeout(120_000);
  await startGame(page);
  for (let i = 0; i < 8; i++) await spellByTap(page, i);
  await expect(game(page)).toHaveAttribute("data-state", "results", { timeout: 20_000 });
  await expect(game(page)).toHaveAttribute("data-stars", "3");
  await expect(game(page)).toHaveAttribute("data-clean", "8");
  await expect(page.locator(".pebble.gold")).toHaveCount(8);
  await expect(page.getByRole("button", { name: "Go on" })).toBeVisible({ timeout: 10_000 });
});
