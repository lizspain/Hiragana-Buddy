// One-pen pointer input with palm rejection for the writing stage.
//
// Rules (CLAUDE.md "Input rules"):
//  - only pointers that start inside the cell (+12 px) count
//  - one active pen; a second pointer within 150 ms that is larger / further
//    from the centre is the palm (the other becomes the pen)
//  - contact > ~40 CSS px across is a palm
//  - strokes < 2% of the cell lasting < 80 ms are dropped silently
//  - a palm landing mid-stroke never cancels the live stroke
//  - pointercancel discards without a miss
//  - once a stylus is seen, touch is ignored

export interface CellRect {
  /** Cell origin and size in stage CSS pixels. */
  x: number;
  y: number;
  size: number;
  /** Stage origin in client (viewport) pixels. */
  left: number;
  top: number;
}

export interface PenHandlers {
  /** A new stroke started at stage-pixel point (x, y). */
  start(x: number, y: number): void;
  /** More stage-pixel points for the live stroke. */
  move(xs: number[], ys: number[]): void;
  /** Stroke finished; points are in cell units (0..1). */
  end(points: [number, number][]): void;
  /** Stroke dropped (cancel, tap, or replaced by the real pen). Not a miss. */
  discard(): void;
}

const MARGIN = 12;
const PALM_WINDOW_MS = 150;
const PALM_CONTACT_PX = 40;
const TAP_LEN = 0.02;
const TAP_MS = 80;

interface Active {
  id: number;
  type: string;
  t0: number;
  area: number;
  dist: number;
  xs: number[];
  ys: number[];
}

export class PenInput {
  private active: Active | null = null;
  private penSeen = false;
  private el: HTMLElement;
  private rect: () => CellRect;
  private h: PenHandlers;
  enabled = true;

  constructor(el: HTMLElement, rect: () => CellRect, handlers: PenHandlers) {
    this.el = el;
    this.rect = rect;
    this.h = handlers;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onCancel);
    el.addEventListener("lostpointercapture", this.onLost);
    el.addEventListener("contextmenu", prevent);
  }

  destroy(): void {
    const el = this.el;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onCancel);
    el.removeEventListener("lostpointercapture", this.onLost);
    el.removeEventListener("contextmenu", prevent);
  }

  get drawing(): boolean {
    return this.active !== null;
  }

  private local(e: PointerEvent, r: CellRect): [number, number] {
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    if (!this.enabled) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.pointerType === "pen") this.penSeen = true;
    else if (e.pointerType === "touch" && this.penSeen) return;

    const r = this.rect();
    const [x, y] = this.local(e, r);
    if (x < r.x - MARGIN || y < r.y - MARGIN || x > r.x + r.size + MARGIN || y > r.y + r.size + MARGIN) return;

    const w = e.pointerType === "touch" ? e.width || 0 : 0;
    const hgt = e.pointerType === "touch" ? e.height || 0 : 0;
    if (Math.max(w, hgt) > PALM_CONTACT_PX) return;

    const cx = r.x + r.size / 2;
    const cy = r.y + r.size / 2;
    const cand: Active = {
      id: e.pointerId,
      type: e.pointerType,
      t0: e.timeStamp,
      area: w * hgt,
      dist: Math.hypot(x - cx, y - cy),
      xs: [x],
      ys: [y],
    };

    const cur = this.active;
    if (cur) {
      // A second contact. Only within the palm window can it take over, and
      // only if the current one looks more like a palm (larger, or further out).
      if (e.timeStamp - cur.t0 > PALM_WINDOW_MS) return;
      const curIsPalm = cur.area > 0 && cand.area > 0 && cur.area !== cand.area ? cur.area > cand.area : cur.dist > cand.dist;
      if (!curIsPalm) return;
      this.release(cur.id);
      this.active = null;
      this.h.discard();
    }

    this.active = cand;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events in tests */
    }
    this.h.start(x, y);
  };

  private onMove = (e: PointerEvent) => {
    const a = this.active;
    if (!a || e.pointerId !== a.id) return;
    const r = this.rect();
    const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const list = events.length ? events : [e];
    const xs: number[] = [];
    const ys: number[] = [];
    for (const ev of list) {
      const [x, y] = this.local(ev, r);
      const lx = a.xs[a.xs.length - 1];
      const ly = a.ys[a.ys.length - 1];
      if (Math.abs(x - lx) < 0.5 && Math.abs(y - ly) < 0.5) continue;
      a.xs.push(x);
      a.ys.push(y);
      xs.push(x);
      ys.push(y);
    }
    if (xs.length) this.h.move(xs, ys);
  };

  private onUp = (e: PointerEvent) => {
    const a = this.active;
    if (!a || e.pointerId !== a.id) return;
    this.onMove(e);
    this.active = null;
    this.release(a.id);
    const r = this.rect();
    const pts: [number, number][] = a.xs.map((x, i) => [(x - r.x) / r.size, (a.ys[i] - r.y) / r.size]);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (len < TAP_LEN && e.timeStamp - a.t0 < TAP_MS) {
      this.h.discard();
      return;
    }
    if (pts.length === 1) pts.push([pts[0][0] + 0.001, pts[0][1]]);
    this.h.end(pts);
  };

  private onCancel = (e: PointerEvent) => {
    const a = this.active;
    if (!a || e.pointerId !== a.id) return;
    this.active = null;
    this.h.discard();
  };

  // Capture lost without an up (e.g. element hidden): treat like cancel.
  private onLost = (e: PointerEvent) => {
    if (this.active && e.pointerId === this.active.id) this.onCancel(e);
  };

  /** Abandon a live stroke (e.g. leaving the screen). */
  cancel(): void {
    if (this.active) {
      this.release(this.active.id);
      this.active = null;
      this.h.discard();
    }
  }

  private release(id: number) {
    try {
      if (this.el.hasPointerCapture(id)) this.el.releasePointerCapture(id);
    } catch {
      /* ignore */
    }
  }
}

const prevent = (e: Event) => e.preventDefault();
