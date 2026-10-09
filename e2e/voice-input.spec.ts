import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// A stand-in for the browser's on-device speech recogniser, plus a silent mic.
// window.__say maps a language to what that recogniser "hears".
async function fakeRecogniser(page: Page, opts: { status?: string; say: Record<string, string> }) {
  await page.addInitScript(({ status, say }) => {
    const w = window as unknown as Record<string, unknown>;
    w.__say = say;
    w.__started = [] as { lang: string; local: boolean; track: boolean }[];
    w.__installed = false;
    class FakeSR {
      lang = "";
      continuous = false;
      interimResults = true;
      maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      private _local = false;
      static available() {
        return Promise.resolve(w.__installed ? "available" : (status ?? "available"));
      }
      static install() {
        w.__installed = true;
        return Promise.resolve(true);
      }
      start(track?: MediaStreamTrack) {
        (w.__started as unknown[]).push({ lang: this.lang, local: this._local, track: !!track });
      }
      stop() {
        setTimeout(() => {
          const said = (w.__say as Record<string, string>)[this.lang];
          if (said) this.onresult?.({ results: [Object.assign([{ transcript: said, confidence: 0.9 }], { isFinal: true })] });
          this.onend?.();
        }, 30);
      }
      abort() {
        this.onend?.();
      }
    }
    Object.defineProperty(FakeSR.prototype, "processLocally", {
      get(this: { _local: boolean }) {
        return this._local;
      },
      set(this: { _local: boolean }, v: boolean) {
        this._local = v;
      },
    });
    w.SpeechRecognition = FakeSR;
    navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
  }, opts);
}

const started = (page: Page) => page.evaluate(() => (window as unknown as { __started: { lang: string; local: boolean }[] }).__started);
const tiles = (page: Page) => page.getByTestId("tiles").locator(".tile[data-kana]");

async function openEntry(page: Page) {
  await page.goto("/");
  await page.getByTestId("go-word").click();
}

test("no mic button where private, on-device recognition isn't available", async ({ page }) => {
  // The fixture makes the browser answer "unavailable", as normal Chrome does without a speech pack.
  await openEntry(page);
  await expect(page.getByTestId("word-input")).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByTestId("mic")).toBeHidden();
});

test("no mic button in browsers without the speech API at all", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  });
  await openEntry(page);
  await page.waitForTimeout(300);
  await expect(page.getByTestId("mic")).toBeHidden();
});

test("no mic button where only cloud recognition exists (no processLocally)", async ({ page }) => {
  await page.addInitScript(() => {
    class CloudOnly {
      start() {
        (window as unknown as { __cloudUsed: boolean }).__cloudUsed = true;
      }
    }
    (window as unknown as Record<string, unknown>).SpeechRecognition = CloudOnly;
  });
  await openEntry(page);
  await page.waitForTimeout(300);
  await expect(page.getByTestId("mic")).toBeHidden();
});

test("hold to talk: English name from the list", async ({ page }) => {
  await fakeRecogniser(page, { say: { "en-US": "Emma", "ja-JP": "エマ" } });
  await openEntry(page);
  const mic = page.getByTestId("mic");
  await expect(mic).toBeVisible();
  await mic.hover();
  await page.mouse.down();
  await expect(mic).toHaveAttribute("data-state", "listening");
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect(page.getByTestId("word-input")).toHaveValue("Emma");
  await expect(tiles(page)).toHaveCount(2);
  await expect(page.getByTestId("hint")).toContainText("Heard “Emma”");
  // Both languages listened, and only ever in on-device mode.
  expect(await started(page)).toEqual([
    { lang: "en-US", local: true, track: true },
    { lang: "ja-JP", local: true, track: true },
  ]);
  await page.screenshot({ path: `test-results/voice-heard-${test.info().project.name}.png` });
});

test("tap to start, tap again to stop: Japanese sounds become romaji", async ({ page }) => {
  await fakeRecogniser(page, { say: { "en-US": "Necco", "ja-JP": "ねこ" } });
  await openEntry(page);
  const mic = page.getByTestId("mic");
  await mic.click(); // quick tap
  await page.waitForTimeout(700);
  await expect(mic).toHaveAttribute("data-state", "listening"); // still listening after the tap
  await page.screenshot({ path: `test-results/voice-listening-${test.info().project.name}.png` });
  await mic.click(); // second tap stops
  await expect(page.getByTestId("word-input")).toHaveValue("neko");
  await expect(tiles(page)).toHaveCount(2);
  await expect(mic).toHaveAttribute("data-state", "idle");
});

test("first use downloads the browser's on-device speech pack, then listens", async ({ page }) => {
  await fakeRecogniser(page, { status: "downloadable", say: { "en-US": "dinosaur" } });
  await openEntry(page);
  const mic = page.getByTestId("mic");
  await expect(mic).toBeVisible();
  await mic.click();
  await expect(mic).toHaveAttribute("data-state", "listening");
  expect(await page.evaluate(() => (window as unknown as { __installed: boolean }).__installed)).toBe(true);
  await mic.click();
  await expect(page.getByTestId("word-input")).toHaveValue("dinosaur");
});

test("nothing usable heard: a gentle hint, input untouched", async ({ page }) => {
  await fakeRecogniser(page, { say: { "ja-JP": "猫" } });
  await openEntry(page);
  await page.getByTestId("mic").click();
  await page.getByTestId("mic").click();
  await expect(page.getByTestId("hint")).toContainText("didn't catch that");
  await expect(page.getByTestId("word-input")).toHaveValue("");
});
