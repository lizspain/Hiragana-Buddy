// Tactile press feedback from the Figma Make mockup: any button sinks 4 px and
// darkens for ~240 ms when tapped, clicked or activated from the keyboard.
// It also plays a soft plastic "tok" (audio.ts thunk), except on buttons
// marked data-quiet: ones that speak (the "tok" would talk over the voice)
// and the mute button, which plays its own only when sound comes back on.
// One listener on the document covers every screen. The writing stage and
// draggable tiles are left alone (they have their own feedback).

import { thunk } from "./audio";

const PRESS_MS = 240;
const timers = new WeakMap<Element, number>();

function press(el: Element | null) {
  const btn = el?.closest("button");
  if (!btn || btn.disabled || btn.closest(".stage, .tile-row")) return;
  clearTimeout(timers.get(btn));
  btn.classList.add("is-pressed");
  if (!btn.hasAttribute("data-quiet")) thunk();
  timers.set(
    btn,
    window.setTimeout(() => btn.classList.remove("is-pressed"), PRESS_MS),
  );
}

export function installPressFeedback(): void {
  document.addEventListener("pointerdown", (e) => press(e.target as Element), { capture: true, passive: true });
  document.addEventListener(
    "keydown",
    (e) => {
      if ((e.key === "Enter" || e.key === " ") && !e.repeat) press(e.target as Element);
    },
    { capture: true },
  );
}
