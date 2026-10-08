import "./styles.css";
import { initRouter, nav } from "./app";
import { loadStrokes } from "./data";
import { loadStore, getSettings } from "./store";
import { setSoundEnabled } from "./ui/audio";

// No pinch / double-tap zoom anywhere (iOS ignores user-scalable=no).
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

async function boot() {
  const root = document.getElementById("app")!;
  await Promise.all([loadStrokes(), loadStore()]);
  setSoundEnabled(getSettings().sound);
  initRouter(root);
  document.getElementById("boot")?.remove();
  nav.home();

  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    const { registerSW } = await import("virtual:pwa-register");
    registerSW({ immediate: true });
  }
}

void boot();
