import "./styles.css";
import { initRouter, nav } from "./app";
import { loadStrokes } from "./data";
import { loadStore, getSettings } from "./store";
import { loadVoice, primeAudio, setSoundEnabled } from "./ui/audio";
import { installPressFeedback } from "./ui/press";

// No pinch / double-tap zoom anywhere (iOS ignores user-scalable=no).
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

async function boot() {
  const root = document.getElementById("app")!;
  installPressFeedback();
  await Promise.all([loadStrokes(), loadStore(), loadVoice()]);
  setSoundEnabled(getSettings().sound);
  // Dev-only tools; the import is dropped from production builds.
  if (import.meta.env.DEV && location.hash === "#audio-review") {
    const { audioReviewScreen } = await import("./dev/audio-review");
    document.getElementById("boot")?.remove();
    root.replaceChildren(audioReviewScreen());
    return;
  }
  initRouter(root);
  // Tests drive screens directly (e.g. a Look & Write stage before its path exists); never set for a child.
  if (navigator.webdriver) (window as unknown as { hbNav: typeof nav }).hbNav = nav;
  document.getElementById("boot")?.remove();
  nav.home();
  primeAudio();

  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    const { registerSW } = await import("virtual:pwa-register");
    registerSW({ immediate: true });
  }
}

void boot();
