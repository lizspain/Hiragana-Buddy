/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Relative base so the same build works at lizspain.github.io/Hiragana-Buddy/,
// on Cloudflare Pages, or from any sub-folder.
export default defineConfig({
  base: "./",
  build: { target: "es2020", assetsInlineLimit: 0 },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Hiragana Buddy",
        short_name: "Hiragana",
        description: "Learn to write your name in hiragana, one stroke at a time.",
        lang: "en",
        start_url: ".",
        scope: ".",
        display: "standalone",
        orientation: "any",
        background_color: "#fff8ef",
        theme_color: "#ffb36b",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,json,webmanifest}"],
        navigateFallback: "index.html",
      },
    }),
  ],
  test: { include: ["src/**/*.test.ts"] },
});
