// Rainbow star burst: stars stream out from a centre on spiral arms while the
// whole swirl turns slowly, then fade. Used when a letter is finished (on the
// writing board) and when the "my word" screen opens (as a page overlay).

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface Burst {
  /** Draw frame at `t` ms since the start; false once finished. `size` scales the swirl. */
  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, t: number): boolean;
}

export function createBurst(ms = 1500, count = 96): Burst {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const still = reducedMotion();
  const stars = Array.from({ length: count }, (_, i) => ({
    born: (i / count) * 0.65 * ms, // emitted over the first two thirds
    angle: i * golden,
    reach: 0.28 + Math.random() * 0.24, // how far out it travels, in units of `size`
    size: 0.022 + Math.random() * 0.024,
    hue: (i * 137.5) % 360, // golden-angle steps: the full rainbow is out at any moment
    spin: (Math.random() - 0.5) * 6,
  }));
  return {
    draw(ctx, cx, cy, size, t) {
      if (t > ms) return false;
      const turn = still ? 0 : (t / 1000) * 1.1; // slow rotation of the whole swirl, rad
      const fadeOut = Math.min(1, (ms - t) / 350);
      for (const s of stars) {
        const age = still ? ms : t - s.born;
        if (age < 0) continue;
        const f = Math.min(1, age / (ms * 0.6));
        const out = 1 - Math.pow(1 - f, 3); // ease out
        const r = size * (0.04 + s.reach * out);
        const a = s.angle + turn + out * 1.2; // curve outward like a spiral arm
        const twinkle = 0.75 + 0.25 * Math.sin(age / 70 + s.hue);
        ctx.save();
        ctx.globalAlpha = Math.min(1, age / 120) * fadeOut;
        ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.rotate(still ? 0 : (age / 1000) * s.spin);
        ctx.fillStyle = `hsl(${(s.hue + t * 0.12) % 360} 92% 62%)`;
        star(ctx, 0, 0, size * s.size * twinkle);
        ctx.restore();
      }
      return true;
    },
  };
}

/**
 * Play a burst over the whole page, centred on `around` (or the viewport).
 * The overlay ignores touches and removes itself when done.
 */
export function pageBurst(around?: Element | null, ms = 1500): () => void {
  const c = document.createElement("canvas");
  c.className = "page-burst";
  c.setAttribute("aria-hidden", "true");
  document.body.appendChild(c);
  const w = innerWidth;
  const h = innerHeight;
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = around?.getBoundingClientRect();
  const cx = r ? r.left + r.width / 2 : w / 2;
  const cy = r ? r.top + r.height / 2 : h / 2;
  const size = Math.min(Math.max(w, h) * 0.9, Math.min(w, h) * 1.6);
  const burst = createBurst(ms, 140);
  let raf = 0;
  let t0 = -1;
  const frame = (now: number) => {
    if (t0 < 0) t0 = now;
    ctx.clearRect(0, 0, w, h);
    if (burst.draw(ctx, cx, cy, size, now - t0)) raf = requestAnimationFrame(frame);
    else c.remove();
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    c.remove();
  };
}

export function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let n = 0; n < 8; n++) {
    const rr = n % 2 ? r * 0.38 : r;
    const a = (n * Math.PI) / 4 - Math.PI / 2;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}
