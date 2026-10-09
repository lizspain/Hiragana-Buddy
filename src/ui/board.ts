// The writing stage: three stacked canvases.
//   guide   (bottom): paper, cross guidelines, ghosts, start dots. Redrawn on scene change.
//   ink     (middle): accepted strokes + the live stroke, drawn incrementally.
//   effects (top):    demo animation, sparkles, fades, pulses. Animated only while busy.

import type { GlyphData, Phase, Pt, StrokeData } from "../engine/matcher";
import type { CellRect } from "./pen";

export interface GuideScene {
  glyph: GlyphData;
  phase: Phase;
  /** Next expected stroke. */
  k: number;
  /** Follow me (phases 2–3 after three misses): show stroke k as in phase 1. */
  follow: boolean;
  /** "Let's do it together": light up stroke k's ghost. */
  together: boolean;
}

const C = {
  paper: "#fffdf8",
  paperEdge: "#efd9bd",
  cross: "#d9b98f",
  ghost: "#e6e9ee",
  ghostLine: "#7d8794", // ≥3:1 on paper
  ghostDone: "#eef0f3",
  together: "#ffe3a3",
  dot: "#3fae74",
  dotLater: "#9fb7aa",
  demo: "#3d4a5c",
  demoTip: "#ff9f5a",
  sparkle: ["#ffc93c", "#ff8fab", "#7ec8f2", "#9be38f", "#ffb36b"],
};

const MAX_DPR = 2;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Effect {
  /** Draw at time `now`; return false when finished. */
  draw(ctx: CanvasRenderingContext2D, now: number): boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

export class Board {
  readonly stage: HTMLElement;
  private guide: HTMLCanvasElement;
  private ink: HTMLCanvasElement;
  private fx: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private i: CanvasRenderingContext2D;
  private f: CanvasRenderingContext2D;
  private ro: ResizeObserver;

  cell: CellRect = { x: 0, y: 0, size: 1, left: 0, top: 0 };
  private w = 1;
  private h = 1;
  private dpr = 1;

  inkColor = "#f28c28";
  private scene: GuideScene | null = null;
  private accepted: Pt[][] = []; // cell units
  private liveX: number[] = [];
  private liveY: number[] = [];
  private liveDrawn = 0;
  private inkRaf = 0;

  private effects: Effect[] = [];
  private fxRaf = 0;
  private particles: Particle[] = Array.from({ length: 64 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, color: "" }));
  private demoCancel: (() => void) | null = null;

  /** Called after a resize so callers can drop a live stroke. */
  onResize: (() => void) | null = null;

  constructor(stage: HTMLElement) {
    this.stage = stage;
    this.guide = this.layer("guide");
    this.ink = this.layer("ink");
    this.fx = this.layer("fx");
    this.g = this.guide.getContext("2d")!;
    this.i = this.ink.getContext("2d")!;
    this.f = this.fx.getContext("2d")!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(stage);
    window.addEventListener("scroll", this.updateOrigin, true);
    this.resize();
  }

  private layer(name: string): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.className = `layer layer-${name}`;
    this.stage.appendChild(c);
    return c;
  }

  destroy(): void {
    this.ro.disconnect();
    window.removeEventListener("scroll", this.updateOrigin, true);
    cancelAnimationFrame(this.inkRaf);
    cancelAnimationFrame(this.fxRaf);
    this.demoCancel?.();
  }

  private updateOrigin = () => {
    const r = this.stage.getBoundingClientRect();
    this.cell.left = r.left;
    this.cell.top = r.top;
  };

  resize(): void {
    const r = this.stage.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const size = Math.floor(Math.min(this.w, this.h) * 0.96);
    this.cell = { x: Math.round((this.w - size) / 2), y: Math.round((this.h - size) / 2), size, left: r.left, top: r.top };
    this.stage.dataset.cell = `${this.cell.x},${this.cell.y},${size}`; // read by e2e tests
    for (const [c, ctx] of [[this.guide, this.g], [this.ink, this.i], [this.fx, this.f]] as const) {
      c.width = Math.round(this.w * this.dpr);
      c.height = Math.round(this.h * this.dpr);
      c.style.width = `${this.w}px`;
      c.style.height = `${this.h}px`;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    this.liveX = [];
    this.liveY = [];
    this.drawGuide();
    this.redrawInk();
    this.onResize?.();
  }

  // ---------- coordinates ----------

  private px(p: Pt): Pt {
    return [this.cell.x + p[0] * this.cell.size, this.cell.y + p[1] * this.cell.size];
  }

  private get inkWidth() {
    return Math.max(6, this.cell.size * 0.05);
  }

  /** Path2D of a KanjiVG stroke, transformed into stage pixels. */
  private strokePath(ctx: CanvasRenderingContext2D, s: StrokeData, draw: () => void) {
    const k = this.cell.size / 109;
    ctx.save();
    ctx.translate(this.cell.x, this.cell.y);
    ctx.scale(k, k);
    draw();
    ctx.stroke(pathOf(s));
    ctx.restore();
  }

  // ---------- guide layer ----------

  setScene(scene: GuideScene | null): void {
    this.scene = scene;
    this.drawGuide();
  }

  private drawGuide(): void {
    const ctx = this.g;
    const { x, y, size } = this.cell;
    ctx.clearRect(0, 0, this.w, this.h);

    // paper
    ctx.save();
    ctx.shadowColor = "rgba(160, 110, 60, 0.18)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = C.paper;
    roundRect(ctx, x, y, size, size, size * 0.06);
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.paperEdge;
    roundRect(ctx, x, y, size, size, size * 0.06);
    ctx.stroke();

    // cross guidelines
    ctx.save();
    ctx.setLineDash([size * 0.025, size * 0.022]);
    ctx.lineWidth = Math.max(1.5, size * 0.005);
    ctx.strokeStyle = C.cross;
    ctx.globalAlpha = this.scene?.phase === 3 ? 0.95 : 0.6;
    ctx.beginPath();
    ctx.moveTo(x + size / 2, y + size * 0.04);
    ctx.lineTo(x + size / 2, y + size * 0.96);
    ctx.moveTo(x + size * 0.04, y + size / 2);
    ctx.lineTo(x + size * 0.96, y + size / 2);
    ctx.stroke();
    ctx.restore();

    const sc = this.scene;
    if (!sc) return;
    const strokes = sc.glyph.strokes;
    const look: Phase = sc.follow ? 1 : sc.phase;
    const show: number[] = [];
    if (look === 1 || sc.together) show.push(sc.k);
    else if (look === 2) strokes.forEach((_, n) => show.push(n));

    for (const n of show) {
      if (n >= strokes.length) continue;
      const s = strokes[n];
      const done = n < sc.k;
      const lit = sc.together && n === sc.k;
      this.strokePath(ctx, s, () => {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = 9;
        ctx.strokeStyle = lit ? C.together : done ? C.ghostDone : C.ghost;
      });
      if (!done) {
        this.strokePath(ctx, s, () => {
          ctx.lineWidth = 0.9;
          ctx.setLineDash([2.2, 2.2]);
          ctx.strokeStyle = C.ghostLine;
        });
      }
    }

    // start dots: phase 2 numbers every stroke still to come; others show the next one only
    const dots = look === 2 ? strokes.map((_, n) => n).filter((n) => n >= sc.k) : show.filter((n) => n === sc.k);
    for (const n of [...dots].reverse()) this.drawStartDot(ctx, strokes[n], n, n === sc.k);
    if (show.includes(sc.k) && sc.k < strokes.length) this.drawArrow(ctx, strokes[sc.k], C.dot, 1);
  }

  private drawStartDot(ctx: CanvasRenderingContext2D, s: StrokeData, n: number, next: boolean, scale = 1) {
    const [cx, cy] = this.px(s.points[0]);
    const r = this.cell.size * (next ? 0.042 : 0.032) * scale;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = next ? C.dot : C.dotLater;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `800 ${Math.round(r * 1.25)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n + 1), cx, cy + r * 0.06);
  }

  /** Chevron a little way along the stroke, pointing the way to go. */
  private drawArrow(ctx: CanvasRenderingContext2D, s: StrokeData, color: string, alpha: number) {
    const pts = s.points;
    const at = Math.min(pts.length - 2, s.length < 0.2 ? 14 : 8);
    const [ax, ay] = this.px(pts[at - 2]);
    const [bx, by] = this.px(pts[at + 1]);
    const ang = Math.atan2(by - ay, bx - ax);
    const [cx, cy] = this.px(pts[at]);
    const len = this.cell.size * 0.045;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(-len * 0.6, -len * 0.7);
    ctx.lineTo(len * 0.5, 0);
    ctx.lineTo(-len * 0.6, len * 0.7);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, this.cell.size * 0.014);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth += 4;
    ctx.stroke();
    ctx.lineWidth -= 4;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }

  // ---------- ink layer ----------

  beginLive(x: number, y: number): void {
    this.stopDemo();
    this.liveX = [x];
    this.liveY = [y];
    this.liveDrawn = 0;
    this.scheduleInk();
  }

  extendLive(xs: number[], ys: number[]): void {
    for (let n = 0; n < xs.length; n++) {
      this.liveX.push(xs[n]);
      this.liveY.push(ys[n]);
    }
    this.scheduleInk();
  }

  private scheduleInk() {
    if (!this.inkRaf) this.inkRaf = requestAnimationFrame(this.drawLive);
  }

  /** Draws only the segments added since the last frame. */
  private drawLive = () => {
    this.inkRaf = 0;
    const xs = this.liveX;
    const ys = this.liveY;
    const n = xs.length;
    if (!n) return;
    const ctx = this.i;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = this.inkWidth;
    ctx.strokeStyle = this.inkColor;
    ctx.fillStyle = this.inkColor;
    if (this.liveDrawn === 0) {
      ctx.beginPath();
      ctx.arc(xs[0], ys[0], this.inkWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (n < 2) {
      this.liveDrawn = 1;
      return;
    }
    ctx.beginPath();
    let i = Math.max(1, this.liveDrawn);
    // Quadratic smoothing: each segment runs midpoint → midpoint through the sample.
    ctx.moveTo(i === 1 ? xs[0] : (xs[i - 2] + xs[i - 1]) / 2, i === 1 ? ys[0] : (ys[i - 2] + ys[i - 1]) / 2);
    for (; i < n; i++) {
      const mx = (xs[i - 1] + xs[i]) / 2;
      const my = (ys[i - 1] + ys[i]) / 2;
      ctx.quadraticCurveTo(xs[i - 1], ys[i - 1], mx, my);
    }
    ctx.lineTo(xs[n - 1], ys[n - 1]);
    ctx.stroke();
    this.liveDrawn = n;
  };

  /** The live stroke was accepted: keep it, settled into a smooth version. */
  acceptLive(points: Pt[]): void {
    this.accepted.push(points);
    this.liveX = [];
    this.liveY = [];
    this.redrawInk();
  }

  /** The live stroke did not match: fade it gently. */
  fadeLive(): void {
    const xs = this.liveX;
    const ys = this.liveY;
    this.liveX = [];
    this.liveY = [];
    this.redrawInk();
    if (xs.length < 1) return;
    const color = this.inkColor;
    const width = this.inkWidth;
    const t0 = performance.now();
    this.addEffect({
      draw: (ctx, now) => {
        const a = 1 - (now - t0) / 650;
        if (a <= 0) return false;
        ctx.save();
        ctx.globalAlpha = a * 0.85;
        ctx.strokeStyle = color;
        ctx.lineWidth = width * (0.7 + 0.3 * a);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(xs[0], ys[0]);
        for (let n = 1; n < xs.length; n++) ctx.lineTo(xs[n], ys[n]);
        if (xs.length === 1) ctx.lineTo(xs[0] + 0.1, ys[0]);
        ctx.stroke();
        ctx.restore();
        return true;
      },
    });
  }

  /** Drop the live stroke with no effect (palm, cancel, tap). */
  dropLive(): void {
    this.liveX = [];
    this.liveY = [];
    this.redrawInk();
  }

  clearInk(): void {
    this.accepted = [];
    this.liveX = [];
    this.liveY = [];
    this.redrawInk();
  }

  private redrawInk(): void {
    const ctx = this.i;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = this.inkWidth;
    ctx.strokeStyle = this.inkColor;
    for (const s of this.accepted) traceSmooth(ctx, s.map((p) => this.px(p)));
    this.liveDrawn = 0;
    if (this.liveX.length) this.drawLive();
  }

  // ---------- effects layer ----------

  private addEffect(e: Effect) {
    this.effects.push(e);
    if (!this.fxRaf) this.fxRaf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.fxRaf = 0;
    const ctx = this.f;
    ctx.clearRect(0, 0, this.w, this.h);
    this.effects = this.effects.filter((e) => e.draw(ctx, now));
    const sparkling = this.drawParticles(ctx);
    // Keep animating only while something moves; the last frame leaves the layer clear.
    if (this.effects.length || sparkling) this.fxRaf = requestAnimationFrame(this.tick);
  };

  /**
   * Animate stroke k: a dot leads a growing line at a child's writing speed.
   * Resolves when finished or cancelled (a pen touching down cancels it).
   */
  playDemo(s: StrokeData): Promise<void> {
    this.stopDemo();
    return new Promise((resolve) => {
      const dur = Math.min(1200, Math.max(600, 500 + s.length * 700));
      const hold = 350;
      const fade = 300;
      const L = s.length * 109 * 1.03;
      let t0 = -1;
      let cancelled = false;
      this.demoCancel = () => {
        cancelled = true;
        this.demoCancel = null;
        resolve();
      };
      this.addEffect({
        draw: (ctx, now) => {
          if (cancelled) return false;
          if (t0 < 0) t0 = now;
          const t = now - t0;
          const f = Math.min(1, t / dur);
          const ease = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
          const alpha = t > dur + hold ? Math.max(0, 1 - (t - dur - hold) / fade) : 1;
          this.strokePath(ctx, s, () => {
            ctx.globalAlpha = alpha;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.lineWidth = 5.5;
            ctx.strokeStyle = C.demo;
            ctx.setLineDash([L, L]);
            ctx.lineDashOffset = L * (1 - ease);
          });
          if (t <= dur + hold) {
            const [x, y] = this.px(pointAt(s.points, ease));
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.arc(x, y, this.cell.size * 0.03, 0, Math.PI * 2);
            ctx.fillStyle = C.demoTip;
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = "#fff";
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          if (t >= dur + hold + fade) {
            this.demoCancel = null;
            resolve();
            return false;
          }
          return true;
        },
      });
    });
  }

  stopDemo(): void {
    this.demoCancel?.();
  }

  get demoPlaying(): boolean {
    return this.demoCancel !== null;
  }

  /** Burst of sparkles along an accepted stroke (cell units). */
  sparkle(points: Pt[]): void {
    if (reducedMotion()) return;
    let spawned = 0;
    const want = 14;
    for (let n = 0; n < want; n++) {
      const p = this.particles.find((q) => q.life <= 0);
      if (!p) break;
      const src = points[Math.floor((n / want) * (points.length - 1))];
      const [x, y] = this.px(src);
      const a = Math.random() * Math.PI * 2;
      const sp = this.cell.size * (0.002 + Math.random() * 0.004);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - this.cell.size * 0.002;
      p.max = p.life = 40 + Math.random() * 25;
      p.size = this.cell.size * (0.012 + Math.random() * 0.014);
      p.color = C.sparkle[n % C.sparkle.length];
      spawned++;
    }
    if (spawned && !this.fxRaf) this.fxRaf = requestAnimationFrame(this.tick);
  }

  private drawParticles(ctx: CanvasRenderingContext2D): boolean {
    let alive = false;
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      alive = true;
      p.life--;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += this.cell.size * 0.00012;
      const a = p.life / p.max;
      ctx.globalAlpha = Math.min(1, a * 1.5);
      ctx.fillStyle = p.color;
      star(ctx, p.x, p.y, p.size * (0.6 + 0.4 * a));
    }
    ctx.globalAlpha = 1;
    return alive;
  }

  /** Miss 2: the start dot pulses and the arrow shows the way. */
  pulseStart(s: StrokeData, n: number): void {
    const t0 = performance.now();
    const total = reducedMotion() ? 1800 : 2600;
    this.addEffect({
      draw: (ctx, now) => {
        const t = now - t0;
        if (t > total) return false;
        const ph = (t % 866) / 866;
        const [cx, cy] = this.px(s.points[0]);
        if (!reducedMotion()) {
          ctx.beginPath();
          ctx.arc(cx, cy, this.cell.size * (0.045 + ph * 0.06), 0, Math.PI * 2);
          ctx.lineWidth = 5;
          ctx.strokeStyle = `rgba(63,174,116,${0.7 * (1 - ph)})`;
          ctx.stroke();
        }
        this.drawStartDot(ctx, s, n, true, 1 + 0.12 * Math.sin(ph * Math.PI));
        this.drawArrow(ctx, s, C.dot, 1);
        return true;
      },
    });
  }

  /** Light up one stroke's ghost for a moment (order slip: "this one first"). */
  highlight(s: StrokeData, n: number, ms = 2400): void {
    const t0 = performance.now();
    this.addEffect({
      draw: (ctx, now) => {
        const t = now - t0;
        if (t > ms) return false;
        const a = Math.min(1, t / 200, (ms - t) / 400) * (reducedMotion() ? 1 : 0.75 + 0.25 * Math.sin(t / 140));
        this.strokePath(ctx, s, () => {
          ctx.globalAlpha = a;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.lineWidth = 10;
          ctx.strokeStyle = "#ffcf66";
        });
        ctx.globalAlpha = a;
        this.drawStartDot(ctx, s, n, true);
        this.drawArrow(ctx, s, C.dot, a);
        ctx.globalAlpha = 1;
        return true;
      },
    });
  }

  clearEffects(): void {
    this.stopDemo();
    this.effects = [];
    for (const p of this.particles) p.life = 0;
    this.f.clearRect(0, 0, this.w, this.h);
  }
}

// ---------- helpers ----------

const pathCache = new WeakMap<StrokeData, Path2D>();
function pathOf(s: StrokeData): Path2D {
  let p = pathCache.get(s);
  if (!p) pathCache.set(s, (p = new Path2D(s.d)));
  return p;
}

function pointAt(pts: Pt[], f: number): Pt {
  const x = f * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(x));
  const t = x - i;
  return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
}

export function traceSmooth(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
  for (let n = 1; n < pts.length; n++) {
    const mx = (pts[n - 1][0] + pts[n][0]) / 2;
    const my = (pts[n - 1][1] + pts[n][1]) / 2;
    ctx.quadraticCurveTo(pts[n - 1][0], pts[n - 1][1], mx, my);
  }
  ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let n = 0; n < 8; n++) {
    const rr = n % 2 ? r * 0.38 : r;
    const a = (n * Math.PI) / 4 - Math.PI / 2;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}
