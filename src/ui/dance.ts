// The octopus's celebration dance (art/octopus-dance.webp: 16 frames, 4x4).
// Plays at 10 fps, looping (or `loops` times, then resting on the calm first
// frame). With reduced motion it simply shows that frame. rAF pauses it while
// the page is hidden.

import art from "../art.json";
import { h } from "./dom";

const FPS = 10;

export function dance(cls = "dance", loops = Infinity): { el: HTMLCanvasElement; stop: () => void } {
  const { frameWidth: fw, frameHeight: fh, columns, frames } = art.dance;
  const el = h("canvas", { class: cls, width: fw, height: fh, "aria-hidden": "true" });
  const ctx = el.getContext("2d")!;
  const sheet = new Image();
  let raf = 0;
  let t0 = -1;
  let last = -1;

  const draw = (i: number) => {
    if (i === last) return;
    last = i;
    ctx.clearRect(0, 0, fw, fh);
    ctx.drawImage(sheet, (i % columns) * fw, Math.floor(i / columns) * fh, fw, fh, 0, 0, fw, fh);
  };

  const tick = (now: number) => {
    if (t0 < 0) t0 = now;
    const i = Math.floor(((now - t0) / 1000) * FPS);
    if (i >= frames * loops) return draw(0);
    draw(i % frames);
    raf = requestAnimationFrame(tick);
  };

  sheet.onload = () => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) draw(0);
    else raf = requestAnimationFrame(tick);
  };
  sheet.src = "art/octopus-dance.webp";
  return { el, stop: () => cancelAnimationFrame(raf) };
}
