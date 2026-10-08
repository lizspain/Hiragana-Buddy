import { defineConfig } from "@playwright/test";

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
    { name: "tablet", use: { viewport: { width: 820, height: 1180 } } },
    { name: "phone", use: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 } },
  ],
  webServer: {
    command: "npx vite --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: !process.env.CI,
  },
});
