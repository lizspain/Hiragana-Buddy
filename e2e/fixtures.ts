// Shared test setup. Headless Chromium exposes the on-device speech API but
// ships without the speech engine, and calling SpeechRecognition.available()
// crashes the tab there (normal Chrome answers "unavailable"). Every test page
// gets the normal-Chrome answer unless a test installs its own fake.

import { test as base } from "@playwright/test";

export const NO_LOCAL_SPEECH = () => {
  const SR = (window as unknown as { SpeechRecognition?: { available?: unknown } }).SpeechRecognition;
  if (SR && typeof SR.available === "function") SR.available = () => Promise.resolve("unavailable");
};

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(NO_LOCAL_SPEECH);
    await use(page);
  },
});

export { expect } from "@playwright/test";
