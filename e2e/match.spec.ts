import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Turn on the grown-ups switch (and optionally sound off), then open the home screen. */
async function home(page: Page, settings: Record<string, unknown> = {}, items?: unknown[]) {
  await page.goto("/");
  await page.evaluate(async ({ patch, items }) => {
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
    st.put({ ...(cur as object), matchGame: true, ...patch }, "settings");
    if (items) st.put(items, "items");
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  }, { patch: settings, items });
  await page.reload();
}

const screen = (page: Page) => page.getByTestId("match");
const board = (page: Page) => page.getByTestId("board");
const tile = (page: Page, k: string) => board(page).locator(`.match-tile[data-kana="${k}"]`);

async function startGame(page: Page) {
  await home(page);
  await page.getByTestId("go-listen").click();
  await page.locator('[data-testid=stone][data-set="class-1"]').click({ force: true }); // it bobs, so never "stable"
  await expect(screen(page)).toBeVisible();
}

/** Wait until taps are open, return the asked-for kana. */
async function ready(page: Page, round: number): Promise<string> {
  await expect(screen(page)).toHaveAttribute("data-round", String(round));
  await expect(screen(page)).toHaveAttribute("data-state", "await", { timeout: 25_000 });
  return (await board(page).getAttribute("data-target"))!;
}

async function wrongTile(page: Page, target: string): Promise<string> {
  const left = await board(page).locator(".match-tile:not(.gone)").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.kana!));
  return left.find((k) => k !== target)!;
}

const positions = (page: Page) => board(page).locator(".match-tile").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.kana));

test("Listen & Match is hidden until a grown-up turns it on", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("go-word")).toBeVisible();
  await expect(page.getByTestId("go-listen")).toHaveCount(0);
});

test("eight first-tap finds fill the tray and earn 3 stars; tiles never move", async ({ page }) => {
  await startGame(page);
  const before = await positions(page);
  for (let r = 0; r < 8; r++) {
    const k = await ready(page, r);
    await tile(page, k).click();
    await expect(tile(page, k)).toHaveClass(/gone/);
    await expect(page.locator(".slot.filled")).toHaveCount(r + 1);
    expect(await positions(page)).toEqual(before); // found tiles leave a gap; nobody shifts
  }
  await expect(page.getByTestId("results")).toBeVisible();
  await expect(screen(page)).toHaveAttribute("data-stars", "3");
  await expect(page.locator(".match-stars .star.on")).toHaveCount(3, { timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Play again" })).toBeVisible();
  await page.getByRole("button", { name: "Go on" }).click();
  await expect(page.getByTestId("path")).toBeVisible();
});

test("a wrong tap only wiggles; the third makes the right tile glow; every game still ends with a star", async ({ page }) => {
  await startGame(page);
  for (let r = 0; r < 8; r++) {
    const k = await ready(page, r);
    if (r === 0) {
      for (let i = 1; i <= 3; i++) {
        const w = await wrongTile(page, k);
        await tile(page, w).click();
        await expect(tile(page, w)).toHaveClass(/wiggle/);
        await expect(tile(page, w)).not.toHaveClass(/gone/);
        if (i < 3) await expect(tile(page, k)).not.toHaveClass(/glow/);
        await ready(page, 0);
      }
      await expect(tile(page, k)).toHaveClass(/glow/);
    } else if (r < 7) {
      await tile(page, await wrongTile(page, k)).click();
      await ready(page, r);
    }
    await tile(page, k).click();
    await expect(tile(page, k)).toHaveClass(/gone/);
  }
  // Only the last round (one tile left) was a first-tap hit.
  await expect(screen(page)).toHaveAttribute("data-stars", "1");
  await expect(page.locator(".match-stars .star.on")).toHaveCount(1, { timeout: 10_000 });
});

test("taps while the sound is playing are ignored", async ({ page }) => {
  await startGame(page);
  const k = await ready(page, 0);
  await page.getByTestId("speaker").click(); // replay: locked again until it ends
  await expect(screen(page)).toHaveAttribute("data-state", "prompt");
  await tile(page, k).click({ force: true });
  await expect(tile(page, k)).not.toHaveClass(/gone/);
  await ready(page, 0);
  await tile(page, k).click();
  await expect(tile(page, k)).toHaveClass(/gone/);
});

test("a palm-sized touch on a tile does nothing; a fingertip taps it", async ({ page }) => {
  await startGame(page);
  const k = await ready(page, 0);
  const box = (await tile(page, k).boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const touch = async (radius: number) => {
    const p = { x: box.x + box.width / 2, y: box.y + box.height / 2, radiusX: radius, radiusY: radius };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await touch(60); // 120 px across: a palm
  await page.waitForTimeout(300);
  await expect(tile(page, k)).not.toHaveClass(/gone/);
  await touch(6);
  await expect(tile(page, k)).toHaveClass(/gone/);
});

test("with sound off, the button shows it and turns sound back on", async ({ page }) => {
  await home(page, { sound: false });
  const go = page.getByTestId("go-listen");
  await expect(go.getByLabel("Sound is off")).toBeVisible();
  await go.click();
  await expect(page.getByTestId("path")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("go-listen").getByLabel("Sound is off")).toHaveCount(0);
});

const readStore = (page: Page, key: string) =>
  page.evaluate(
    (k) =>
      new Promise<unknown>((res) => {
        const r = indexedDB.open("hiragana-buddy");
        r.onsuccess = () => {
          const q = r.result.transaction("data").objectStore("data").get(k);
          q.onsuccess = () => {
            res(q.result);
            r.result.close();
          };
        };
      }),
    key,
  );

test("a finished game is saved on the device, with its mix-ups, and goes into the backup", async ({ page }) => {
  await startGame(page);
  for (let r = 0; r < 8; r++) {
    const k = await ready(page, r);
    if (r === 0) {
      await tile(page, await wrongTile(page, k)).click();
      await ready(page, 0);
    }
    await tile(page, k).click();
    await expect(tile(page, k)).toHaveClass(/gone/);
  }
  await expect(screen(page)).toHaveAttribute("data-stars", "3"); // 7 of 8 first-tap hits
  await expect.poll(() => readStore(page, "matchResults")).toEqual([expect.objectContaining({ profileId: "p1", setId: "class-1", hits: 7, stars: 3 })]);
  const progress = (await readStore(page, "kanaProgress")) as { kana: string; mixedUpWith: Record<string, number> }[];
  expect(progress).toHaveLength(1);
  expect(Object.values(progress[0].mixedUpWith)).toEqual([1]);

  // Still there after a reload, and in the backup file.
  await page.reload();
  await page.getByRole("button", { name: /Settings/ }).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Enter"); // the hold gate's keyboard route
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save a backup" }).click()]);
  const backup = JSON.parse(await (await download.createReadStream()).toArray().then((b) => Buffer.concat(b).toString("utf8")));
  expect(backup.version).toBe(2);
  expect(backup.matchResults).toEqual([expect.objectContaining({ setId: "class-1", stars: 3 })]);
  expect(backup.kanaProgress).toHaveLength(1);
});

test("leaving mid-game asks with two pictures", async ({ page }) => {
  await startGame(page);
  await page.getByRole("button", { name: "Home" }).click();
  await page.getByRole("button", { name: "Keep playing" }).click();
  await expect(page.locator(".modal-back")).toHaveCount(0);
  await expect(screen(page)).toBeVisible();
  await page.getByRole("button", { name: "Home" }).click();
  await page.getByRole("button", { name: "Leave" }).click();
  await expect(page.getByTestId("go-listen")).toBeVisible();
});

const stone = (page: Page, id: string) => page.locator(`[data-testid=stone][data-set="${id}"]`);

/** Play the current game with every tile found on the first tap. */
async function playPerfect(page: Page) {
  for (let r = 0; r < 8; r++) {
    const k = await ready(page, r);
    await tile(page, k).click();
    await expect(tile(page, k)).toHaveClass(/gone/);
  }
  await expect(page.getByRole("button", { name: "Go on" })).toBeVisible({ timeout: 10_000 });
}

test("the path starts with only the first stone open, the mascot on it", async ({ page }) => {
  await home(page);
  await page.getByTestId("go-listen").click();
  await expect(page.locator("[data-testid=stone]")).toHaveCount(6);
  await expect(stone(page, "class-1")).toHaveAttribute("data-open", "true");
  await expect(stone(page, "class-1")).toHaveClass(/current/);
  await expect(stone(page, "class-1").locator("xpath=..").locator(".path-mascot")).toHaveCount(1);
  for (const id of ["class-2", "auto-3", "auto-4", "auto-5", "auto-6"]) {
    await expect(stone(page, id)).toHaveAttribute("data-open", "false");
    await expect(stone(page, id)).toBeDisabled();
  }
  await expect(page.getByTestId("word-stone")).toHaveCount(0); // no saved words yet
});

test("a set's first game previews every tile's sound; the next game goes straight to round 1", async ({ page }) => {
  await startGame(page);
  await expect(screen(page)).toHaveAttribute("data-state", "preview");
  await expect(board(page).locator(".match-tile.waiting")).not.toHaveCount(0);
  // Taps during the preview do nothing.
  await board(page).locator(".match-tile").first().click({ force: true });
  await expect(board(page).locator(".match-tile.gone")).toHaveCount(0);
  await ready(page, 0);
  await expect(board(page).locator(".match-tile.waiting")).toHaveCount(0);
  await playPerfect(page);
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(screen(page)).toHaveAttribute("data-state", "prompt");
  await expect(board(page).locator(".match-tile.waiting")).toHaveCount(0);
});

test("3 stars fly onto the stone, the next stone opens and the mascot hops onto it", async ({ page }) => {
  await startGame(page);
  await playPerfect(page);
  await page.getByRole("button", { name: "Go on" }).click();
  await expect(page.getByTestId("path")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
  await expect(stone(page, "class-1")).toHaveAttribute("data-best", "3");
  await expect(stone(page, "class-1").locator(".stone-stars .star.on")).toHaveCount(3);
  await expect(stone(page, "class-2")).toHaveAttribute("data-open", "true");
  await expect(stone(page, "class-2")).toBeEnabled();
  await expect(stone(page, "class-2")).toHaveClass(/current/);
  await expect(stone(page, "class-2").locator("xpath=..").locator(".path-mascot")).toHaveCount(1);
  await expect(stone(page, "auto-3")).toHaveAttribute("data-open", "false");
  // Stars stay after leaving and coming back.
  await page.getByRole("button", { name: "Home" }).click();
  await page.getByTestId("go-listen").click();
  await expect(stone(page, "class-1").locator(".stone-stars .star.on")).toHaveCount(3);
  await expect(stone(page, "class-2")).toHaveClass(/current/);
});

test("My word stones show the 3 most recent saved words and play their kana", async ({ page }) => {
  const at = (d: number) => new Date(Date.UTC(2026, 10, d)).toISOString();
  const word = (kana: string, input: string, d: number) => ({
    id: `word:${kana}`, profileId: "p1", kind: "word", input, mode: "romaji", kana: [...kana], createdAt: at(d), lastPracticedAt: at(d), sessions: [],
  });
  await home(page, {}, [word("ねこ", "neko", 1), word("えま", "emma", 2), word("いぬ", "inu", 3), word("さかな", "sakana", 4), { ...word("あ", "a", 5), id: "kana:あ", kind: "kana" }]);
  await page.getByTestId("go-listen").click();
  const words = page.getByTestId("word-stone");
  await expect(words).toHaveCount(3);
  expect(await words.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.set))).toEqual(["word:さかな", "word:いぬ", "word:えま"]);
  await words.first().click();
  await expect(screen(page)).toBeVisible();
  const kana = await positions(page);
  expect(kana).toHaveLength(8);
  expect(kana).toEqual(expect.arrayContaining(["さ", "か", "な"]));
});
