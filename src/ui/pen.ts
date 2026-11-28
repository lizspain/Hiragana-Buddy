// One-pen pointer input with palm rejection for the writing stage.
//
// Rules (CLAUDE.md "Input rules"):
//  - only pointers that start inside the cell (+12 px) count
//  - one active pen; a second pointer within 150 ms that is larger / further
//    from the centre is the palm (the other becomes the pen)
//  - contact > ~40 CSS px across is a palm (72 px on iOS, which reports
//    contact size larger: see PALM_CONTACT_PX_IOS)
//  - strokes < 2% of the cell lasting < 80 ms are dropped silently
//  - a palm landing mid-stroke never cancels the live stroke
//  - a contact that has rested without moving (a hand holding the phone's
//    edge, which on phones lands inside the cell) gives way to a new touch,
//    unless the new one is the larger contact
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
// iOS/iPadOS WebKit reports touch width/height as 2 × UITouch.majorRadius, and
// a normal fingertip there is ~21 pt (steps of ~5: 21, 26, 31), i.e. 42-63 px.
// With the 40 px limit every finger looked like a palm and nothing drew on iPad.
// A resting hand on iOS reports a much larger radius, so it is still caught.
const PALM_CONTACT_PX_IOS = 72;
const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
const palmContactPx = IS_IOS ? PALM_CONTACT_PX_IOS : PALM_CONTACT_PX;

/** A touch this wide is a palm or resting hand, not a fingertip (shared with Listen & Match's tiles). */
export const isPalmContact = (e: PointerEvent): boolean =>
  e.pointerType === "touch" && Math.max(e.width || 0, e.height || 0) > palmContactPx;

/**
 * A tile press that lifts within this distance (CSS px) of where it landed is a
 * tap, wherever the finger ends up: small fingers wobble (playtest, Nov 2026).
 * Shared by Listen & Match's and Look & Write's tiles.
 */
export const TAP_SLOP_PX = 30;

/** True when a press from (x0, y0) lifted at (x, y) is close enough to count as a tap. */
export const isTapDistance = (x0: number, y0: number, x: number, y: number): boolean => Math.hypot(x - x0, y - y0) <= TAP_SLOP_PX;
const TAP_LEN = 0.02;
/** A contact that has not strayed this far (cell units) from where it landed is resting, not drawing. */
const RESTING_LEN = 0.04;
const TAP_MS = 80;

interface Active {
  id: number;
  type: string;
  t0: number;
  area: number;
  dist: number;
  /** Furthest it has strayed from where it landed (stage px). */
  reach: number;
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
    if (Math.max(w, hgt) > palmContactPx) return;

    const cx = r.x + r.size / 2;
    const cy = r.y + r.size / 2;
    const cand: Active = {
      id: e.pointerId,
      type: e.pointerType,
      t0: e.timeStamp,
      area: w * hgt,
      dist: Math.hypot(x - cx, y - cy),
      reach: 0,
      xs: [x],
      ys: [y],
    };

    const cur = this.active;
    if (cur) {
      // A second contact. Within the palm window it takes over if the current one
      // looks more like a palm (larger, or further out). Later, it takes over
      // only from a contact that is resting rather than drawing (a hand on the
      // edge would otherwise block every finger until it lifts), and not if the
      // newcomer is itself the larger contact. A stroke being drawn is never cut.
      const bothSized = cur.area > 0 && cand.area > 0 && cur.area !== cand.area;
      if (e.timeStamp - cur.t0 <= PALM_WINDOW_MS) {
        const curIsPalm = bothSized ? cur.area > cand.area : cur.dist > cand.dist;
        if (!curIsPalm) return;
      } else {
        const resting = cur.reach < RESTING_LEN * r.size;
        if (!resting || (bothSized && cand.area > cur.area)) return;
      }
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
      a.reach = Math.max(a.reach, Math.hypot(x - a.xs[0], y - a.ys[0]));
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
