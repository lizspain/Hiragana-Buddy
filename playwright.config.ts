import { defineConfig } from "@playwright/test";

/** Tests that need the real production build (service worker, precache) run against `vite preview`. */
const BUILT = /built\.spec\.ts$/;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5174",
    browserName: "chromium",
    hasTouch: true,
  },
  projects: [
    { name: "tablet", testIgnore: BUILT, use: { viewport: { width: 820, height: 1180 } } },
    { name: "phone", testIgnore: BUILT, use: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 } },
    { name: "built", testMatch: BUILT, use: { baseURL: "http://localhost:4175", viewport: { width: 820, height: 1180 } } },
  ],
  webServer: [
    {
      command: "npx vite --port 5174 --strictPort",
      url: "http://localhost:5174",
      reuseExistingServer: !process.env.CI,
    },
    {
      // Builds first, so the service worker and its precache are the real ones.
      command: "npm run build && npx vite preview --port 4175 --strictPort",
      url: "http://localhost:4175",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
