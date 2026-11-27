// Checks against the production build (`vite preview`, with the service
// worker): Listen & Match after the first visit with no network at all.

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function setSettings(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(async (p) => {
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
    st.put({ ...(cur as object), ...p }, "settings");
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  }, patch);
}

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

test("offline after the first visit: Listen & Match plays, its sounds come from the cache, and the game is saved", async ({ page, context }) => {
  // First visit online: the service worker installs and precaches the app and the kana clips.
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const n of names) for (const r of await (await caches.open(n)).keys()) urls.push(new URL(r.url).pathname);
    return urls.filter((u) => /\/audio\/kana\/.+\.mp3$/.test(u)).length;
  });
  expect(cached).toBe(72); // 71 kana + the Japanese intro
  // The Japanese praise clips (the end-of-game cheer) are fetched once the app is idle, into the runtime cache.
  await expect
    .poll(() => page.evaluate(async () => (await (await caches.open("voice-clips")).keys()).length), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(4);

  await setSettings(page, { matchGame: true, matchIntroDone: true });

  // Airplane mode.
  await context.setOffline(true);
  const failed: string[] = [];
  page.on("requestfailed", (r) => failed.push(r.url()));
  await page.reload();
  await page.getByTestId("go-listen").click();
  await page.locator('[data-testid=stone][data-set="class-1"]').click({ force: true });

  const screen = page.getByTestId("match");
  const board = page.getByTestId("board");
  for (let r = 0; r < 8; r++) {
    await expect(screen).toHaveAttribute("data-round", String(r));
    await expect(screen).toHaveAttribute("data-state", "await", { timeout: 25_000 });
    const k = (await board.getAttribute("data-target"))!;
    await board.locator(`.match-tile[data-kana="${k}"]`).click();
    await expect(board.locator(`.match-tile[data-kana="${k}"]`)).toHaveClass(/gone/);
  }
  await expect(screen).toHaveAttribute("data-stars", "3");
  await expect.poll(() => readStore(page, "matchResults")).toEqual([expect.objectContaining({ setId: "class-1", stars: 3 })]);
  expect(failed).toEqual([]); // every page, script and clip came from the cache
});

// CLAUDE.md: 40 fps minimum, sustained, with 4× CPU throttling. A timing
// measurement, so it runs only when asked: PERF=1 npx playwright test --project built
test("frame rate stays at 40+ fps through a whole game at 4× CPU throttling", async ({ page }) => {
  test.skip(!process.env.PERF, "set PERF=1 to run the frame-rate check");
  test.setTimeout(180_000);
  await page.goto("/");
  await setSettings(page, { matchGame: true, matchIntroDone: true });
  await page.reload();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  // Every animation frame's timestamp, from the first prompt to the path's arrival animation.
  await page.evaluate(() => {
    const w = window as unknown as { frames: number[]; where: string[] };
    w.frames = [];
    w.where = [];
    const tick = (t: number) => {
      w.frames.push(t);
      // Which screen and game state each frame belongs to, to place any hitch.
      const m = document.querySelector<HTMLElement>("[data-testid=match]");
      w.where.push(m ? `match:${m.dataset.state}:${m.dataset.round}` : (document.body.dataset.screen ?? "?"));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByTestId("go-listen").click();
  await page.locator('[data-testid=stone][data-set="class-1"]').click({ force: true });
  const screen = page.getByTestId("match");
  const board = page.getByTestId("board");
  for (let r = 0; r < 8; r++) {
    await expect(screen).toHaveAttribute("data-round", String(r));
    await expect(screen).toHaveAttribute("data-state", "await", { timeout: 40_000 });
    const k = (await board.getAttribute("data-target"))!;
    await board.locator(`.match-tile[data-kana="${k}"]`).click();
  }
  await expect(page.getByRole("button", { name: "Go on" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Go on" }).click();
  await expect(page.getByTestId("path")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });

  const { frames, where } = await page.evaluate(() => window as unknown as { frames: number[]; where: string[] }).then(() =>
    page.evaluate(() => {
      const w = window as unknown as { frames: number[]; where: string[] };
      return { frames: w.frames, where: w.where };
    }),
  );
  const gaps = frames.slice(1).map((t, i) => t - frames[i]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  // Worst one-second stretch.
  let worst = Infinity;
  for (let i = 0, j = 0; i < frames.length; i++) {
    while (j < frames.length && frames[j] - frames[i] < 1000) j++;
    if (j < frames.length) worst = Math.min(worst, j - i);
  }
  const avg = (frames.length - 1) / ((frames.at(-1)! - frames[0]) / 1000);
  console.log(`frames ${frames.length}, average ${avg.toFixed(1)} fps, 95th-percentile frame ${p95.toFixed(1)} ms, worst 1 s window ${worst} fps, longest frame ${sorted.at(-1)!.toFixed(0)} ms`);
  const longest = gaps
    .map((g, i) => ({ g, at: where[i + 1] }))
    .sort((a, b) => b.g - a.g)
    .slice(0, 5)
    .map((x) => `${Math.round(x.g)} ms @ ${x.at}`);
  console.log(`longest frames: ${longest.join(", ")}`);
  expect(worst).toBeGreaterThanOrEqual(40);
});
