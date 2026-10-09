// "My word": the child's phase-3 drawings side by side, stars, the word spoken.

import type { Nav, Screen, WordResult } from "../app";
import type { Pt } from "../engine/matcher";
import { fanfare, praise, sayKana, sayWord, unlockAudio } from "../ui/audio";
import { traceSmooth } from "../ui/board";
import { h, ICON, iconButton, mascot, stars } from "../ui/dom";
import { getSettings } from "../store";

export function drawingCanvas(strokes: Pt[][], color: string, cls = "my-letter"): HTMLCanvasElement {
  const c = h("canvas", { class: cls });
  const paint = () => {
    const size = c.clientWidth || 120;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.height = Math.round(size * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.setLineDash([size * 0.03, size * 0.03]);
    ctx.strokeStyle = "rgba(217,185,143,.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(size / 2, size * 0.06);
    ctx.lineTo(size / 2, size * 0.94);
    ctx.moveTo(size * 0.06, size / 2);
    ctx.lineTo(size * 0.94, size / 2);
    ctx.stroke();
    ctx.restore();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, size * 0.055);
    for (const s of strokes) traceSmooth(ctx, s.map(([x, y]) => [x * size, y * size] as Pt));
  };
  requestAnimationFrame(paint);
  return c;
}

export function doneScreen(nav: Nav, r: WordResult): Screen {
  const color = getSettings().inkColor;
  const word = r.plan.kana;
  const timers: number[] = [];

  const el = h(
    "div",
    { class: "screen done" },
    h(
      "main",
      { class: "done-body" },
      mascot("mascot cheer-bounce", "cheer"),
      stars(r.stars, "stars big"),
      h(
        "div",
        { class: "my-word", "data-testid": "my-word", "data-stars": String(r.stars) },
        r.drawings.map((d, i) =>
          h("button", { class: "my-letter-wrap", style: `--i:${i}`, "aria-label": word[i], onclick: () => sayKana(word[i]) }, drawingCanvas(d, color)),
        ),
      ),
      h(
        "div",
        { class: "done-actions" },
        iconButton(ICON.speaker, "Hear my word", () => (unlockAudio(), sayWord(word)), "big-round"),
        iconButton(ICON.replay, "Again", () => nav.write(r.plan), "big-round"),
        iconButton(ICON.home, "Home", () => nav.home(), "big-round"),
      ),
    ),
  );

  return {
    el,
    mounted() {
      fanfare();
      timers.push(window.setTimeout(() => sayWord(word), 600));
      timers.push(window.setTimeout(() => praise(), 2000));
    },
    destroy() {
      timers.forEach(clearTimeout);
    },
  };
}
