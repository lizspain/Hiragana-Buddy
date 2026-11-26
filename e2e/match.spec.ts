import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Turn on the grown-ups switch (and optionally sound off), then open the home screen. */
async function home(page: Page, settings: Record<string, unknown> = {}) {
  await page.goto("/");
  await page.evaluate(async (patch) => {
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
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  }, settings);
  await page.reload();
}

const screen = (page: Page) => page.getByTestId("match");
const board = (page: Page) => page.getByTestId("board");
const tile = (page: Page, k: string) => board(page).locator(`.match-tile[data-kana="${k}"]`);

async function startGame(page: Page) {
  await home(page);
  await page.getByTestId("go-listen").click();
  await expect(screen(page)).toBeVisible();
}

/** Wait until taps are open, return the asked-for kana. */
async function ready(page: Page, round: number): Promise<string> {
  await expect(screen(page)).toHaveAttribute("data-round", String(round));
  await expect(screen(page)).toHaveAttribute("data-state", "await", { timeout: 15_000 });
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
  await expect(page.getByTestId("go-listen")).toBeVisible();
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
  await expect(screen(page)).toBeVisible();
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
