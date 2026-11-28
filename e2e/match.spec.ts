import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  expect(backup.version).toBe(3);
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
    await expect(stone(page, id)).toBeHidden(); // not on the path until the stone before has 3 stars
  }
  await expect(page.getByTestId("word-stone")).toHaveCount(0); // no saved words yet
});

test("a set's first game previews every tile's sound; the next game goes straight to round 1", async ({ page }) => {
  await startGame(page);
  await expect(screen(page)).toHaveAttribute("data-state", "preview", { timeout: 15_000 }); // after the first-ever intro
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
  await expect(stone(page, "class-2")).toBeVisible(); // appeared on the path
  await expect(stone(page, "class-2")).toBeEnabled();
  await expect(stone(page, "class-2")).toHaveClass(/current/);
  await expect(stone(page, "class-2").locator("xpath=..").locator(".path-mascot")).toHaveCount(1);
  await expect(stone(page, "auto-3")).toHaveAttribute("data-open", "false");
  await expect(stone(page, "auto-3")).toBeHidden();
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

const openGrownUps = async (page: Page) => {
  await page.getByRole("button", { name: /Settings/ }).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Enter"); // the hold gate's keyboard route
};

test("the very first game opens with the spoken intro, Japanese then English; later games don't", async ({ page }) => {
  const said: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/audio/kana/intro-ja.mp3")) said.push("ja");
  });
  await startGame(page);
  await expect(screen(page)).toHaveAttribute("data-state", "intro");
  await expect.poll(() => said).toContain("ja");
  await ready(page, 0); // then the preview, then round 1
  await page.getByRole("button", { name: "Home" }).click();
  await page.getByRole("button", { name: "Leave" }).click();
  await page.getByTestId("go-listen").click();
  await page.locator('[data-testid=stone][data-set="class-1"]').click({ force: true });
  await expect(screen(page)).toBeVisible();
  await expect(screen(page)).not.toHaveAttribute("data-state", "intro");
  await expect(screen(page)).toHaveAttribute("data-state", "preview"); // first game not finished, so the preview again
});

test("home: the game cards are just an icon and a label, lined up", async ({ page }) => {
  await home(page, { vocabGame: true });
  // The corner stone and its stars came off the Listen & Match card (Nov 2026).
  await expect(page.locator(".big-btn .stars, .big-btn .listen-stone")).toHaveCount(0);
  const cards = page.locator(".big-choices > .big-btn");
  await expect(cards).toHaveCount(4);
  const spots = await cards.evaluateAll((els) =>
    els.map((b) => {
      const r = b.getBoundingClientRect();
      const i = b.querySelector(".big-icon")!.getBoundingClientRect();
      const l = b.querySelector(".big-label")!.getBoundingClientRect();
      return { icon: i.top + i.height / 2 - r.top, label: l.top - r.top, height: r.height };
    }),
  );
  for (const s of spots) {
    expect(Math.abs(s.icon - spots[0].icon)).toBeLessThan(1.5);
    expect(Math.abs(s.label - spots[0].label)).toBeLessThan(1);
    expect(Math.abs(s.height - spots[0].height)).toBeLessThan(1);
  }
});

test("grown-ups: unlock the whole path, see mixed-up sounds, and reset", async ({ page }) => {
  await home(page, { matchIntroDone: true });
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res) => {
      const r = indexedDB.open("hiragana-buddy");
      r.onsuccess = () => res(r.result);
    });
    const tx = db.transaction("data", "readwrite");
    tx.objectStore("data").put([{ profileId: "p1", setId: "class-1", playedAt: "2026-11-20T00:00:00Z", hits: 4, stars: 1 }], "matchResults");
    tx.objectStore("data").put([{ profileId: "p1", kana: "し", mixedUpWith: { ち: 3 } }], "kanaProgress");
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  });
  await page.reload();
  await openGrownUps(page);
  const card = page.getByTestId("match-card");
  await expect(card.getByTestId("mixups")).toContainText("し and ち: mixed up 3 times");

  await card.getByText("Unlock whole path").click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByTestId("go-listen").click();
  for (const id of ["class-2", "auto-3", "auto-6"]) await expect(stone(page, id)).toHaveAttribute("data-open", "true");
  await expect(stone(page, "class-1")).toHaveClass(/current/); // still the first unfinished one
  await expect(stone(page, "class-1")).toHaveAttribute("data-best", "1");

  await page.getByRole("button", { name: "Home" }).click();
  await openGrownUps(page);
  await card.getByText("Unlock whole path").click(); // off again: unearned stones close, stars stay
  page.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "Reset set progress" }).click();
  await expect(card).toContainText("No games played yet.");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByTestId("go-listen").click();
  await expect(stone(page, "class-1")).toHaveAttribute("data-best", "0");
  await expect(stone(page, "class-2")).toHaveAttribute("data-open", "false");
  await expect(stone(page, "class-2")).toBeHidden();
});

test("with reduced motion the whole game still plays through to the path", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startGame(page);
  await playPerfect(page);
  await page.getByRole("button", { name: "Go on" }).click();
  await expect(page.getByTestId("path")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
  await expect(stone(page, "class-2")).toHaveClass(/current/);
  await expect(page.locator(".flying-star, .flyer")).toHaveCount(0);
});

test("once a recorded voice ships, the About credit follows it and the English intro plays its clip", async ({ page }) => {
  const real = JSON.parse(readFileSync(new URL("../public/audio/kana/manifest.json", import.meta.url), "utf8"));
  const recorded = { ...real, "Listen, then tap the one you hear!": "intro-en.mp3", voice: "a parent at our school", interim: false };
  await page.route("**/audio/kana/manifest.json", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(recorded) }));
  await page.route("**/audio/kana/intro-en.mp3", (r) => r.fulfill({ path: fileURLToPath(new URL("../public/audio/kana/a.mp3", import.meta.url)), contentType: "audio/mpeg" }));
  const fetched: string[] = [];
  page.on("request", (r) => r.url().includes("/audio/kana/intro-") && fetched.push(r.url().split("/").pop()!));

  await home(page);
  await page.getByRole("button", { name: /Settings/ }).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Enter");
  const credit = page.getByTestId("kana-voice-credit");
  await expect(credit).toHaveText("Letter sounds: a parent at our school.");
  await expect(credit.getByRole("link")).toHaveCount(0);

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByTestId("go-listen").click();
  await page.locator('[data-testid=stone][data-set="class-1"]').click({ force: true });
  // The Japanese line (5 s) plays first, then the English one.
  await expect.poll(() => fetched, { timeout: 15_000 }).toEqual(expect.arrayContaining(["intro-ja.mp3", "intro-en.mp3"]));
});

test("a whole Listen & Match visit makes no requests outside the app's own files", async ({ page }) => {
  const outside: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin !== "http://localhost:5174" && !u.protocol.startsWith("data") && !u.protocol.startsWith("blob")) outside.push(r.url());
  });
  await startGame(page); // home → path → game (with the intro and preview)
  await playPerfect(page);
  await page.getByRole("button", { name: "Go on" }).click();
  await expect(page.getByTestId("path")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
  expect(outside).toEqual([]);
});

/** Touch several points at once (one touchstart), then lift them all. CDP radius = half the contact size. */
async function touchTogether(page: Page, points: { x: number; y: number; r: number }[]) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, radiusX: p.r, radiusY: p.r, id: i })) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const centre = async (page: Page, k: string) => {
  const b = (await tile(page, k).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width };
};

test("a wobbly tap that slides off the edge of its tile still counts as a tap", async ({ page }) => {
  await startGame(page);
  const k = await ready(page, 0);
  await tile(page, k).click({ trial: true }); // waits until it has finished arriving
  const b = (await tile(page, k).boundingBox())!;
  // Pressed near the bottom edge, wobbled 24 px down, off the tile.
  await page.mouse.move(b.x + b.width / 2, b.y + b.height - 6);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 6, b.y + b.height + 18, { steps: 4 });
  await page.mouse.up();
  await expect(tile(page, k)).toHaveClass(/gone/);
});

test("two fingers at once: the first touch wins, the second tile is left alone", async ({ page }) => {
  await startGame(page);
  const k = await ready(page, 0);
  const other = await wrongTile(page, k);
  const [a, b] = [await centre(page, k), await centre(page, other)];
  await touchTogether(page, [
    { ...a, r: 6 },
    { ...b, r: 6 },
  ]);
  await expect(tile(page, k)).toHaveClass(/gone/);
  await expect(tile(page, other)).not.toHaveClass(/wiggle|gone/);
});

test("a resting palm on one tile and a fingertip on another: only the fingertip counts", async ({ page }) => {
  await startGame(page);
  const k = await ready(page, 0);
  const other = await wrongTile(page, k);
  const [palm, finger] = [await centre(page, other), await centre(page, k)];
  await touchTogether(page, [
    { ...palm, r: 60 }, // 120 px across: a palm, even though it lands first
    { ...finger, r: 6 },
  ]);
  await expect(tile(page, k)).toHaveClass(/gone/);
  await expect(tile(page, other)).not.toHaveClass(/wiggle|gone/);
});
