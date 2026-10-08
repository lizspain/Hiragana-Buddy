// Stroke matcher for Hiragana Buddy: a TypeScript port of
// reference/stroke-matcher.js. Behaviour and TOLERANCE must stay identical to
// the reference unless playtests say otherwise (tests/matcher-ts.test.mjs runs
// the same synthetic suite against this file).
//
// Coordinates: everything is in cell units, 0..1 on both axes (the writing
// square), matching data/kana-strokes.json.

export type Pt = [number, number];
export type Phase = 1 | 2 | 3;

export interface StrokeData {
  d: string;
  points: Pt[];
  length: number;
  numberPos: Pt;
}

export interface GlyphData {
  codepoint?: string;
  strokeCount: number;
  strokes: StrokeData[];
}

export interface CompareResult {
  pass: boolean;
  quality: number;
  meanDist: number;
  startDist: number;
  offset: number;
  lenRatio: number;
  dirCos: number;
  reasons: string[];
}

export interface JudgeResult extends CompareResult {
  kind: "ok" | "order" | "miss";
  matchedStroke?: number;
}

export interface CharacterScore {
  score: number;
  shape: number;
  placement: number;
  proportion: number;
  stars: 1 | 2 | 3;
}

export const N = 32; // points per resampled stroke (matches the data file)

// Leniency per phase, in cell units.
export const TOLERANCE: Record<Phase, { mean: number; start: number; shift: number }> = {
  1: { mean: 0.15, start: 0.22, shift: 0.0 }, // watch and trace: ghost of one stroke
  2: { mean: 0.13, start: 0.2, shift: 0.0 }, // trace whole ghost
  3: { mean: 0.12, start: 0.18, shift: 0.18 }, // write from memory: up to 0.18 offset forgiven
};
const MIN_TOL = 0.07; // floor for tiny strokes (dakuten ticks)
const LENGTH_RATIO: [number, number] = [0.4, 2.0];
const MIN_DIR_COS = 0.2; // direction check for strokes with a clear chord

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function pathLength(pts: Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

export function resample(pts: Pt[], n = N): Pt[] {
  if (pts.length === 1) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]] as Pt);
  const total = pathLength(pts);
  if (total === 0) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]] as Pt);
  const step = total / (n - 1);
  const out: Pt[] = [[pts[0][0], pts[0][1]]];
  let acc = 0;
  let target = step;
  for (let i = 1; i < pts.length && out.length < n - 1; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let seg = dist(a, b);
    while (acc + seg >= target && out.length < n - 1) {
      const t = (target - acc) / seg;
      const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(p);
      seg -= target - acc;
      acc = 0;
      a = p;
      target = step;
    }
    acc += seg;
  }
  const last = pts[pts.length - 1];
  while (out.length < n) out.push([last[0], last[1]]);
  return out;
}

// 5-point moving average, endpoints kept.
export function smooth(pts: Pt[]): Pt[] {
  return pts.map((p, i) => {
    if (i < 2 || i > pts.length - 3) return p;
    let x = 0;
    let y = 0;
    for (let k = -2; k <= 2; k++) {
      x += pts[i + k][0];
      y += pts[i + k][1];
    }
    return [x / 5, y / 5] as Pt;
  });
}

const centroid = (pts: Pt[]): Pt => {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
};

// Distance from point p to the nearest point of polyline `line`.
export function nearestDistance(p: Pt, line: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    if (d < best) best = d;
  }
  return best;
}

/** Start tolerance compareStroke uses for this stroke and phase ("let's do it together" reuses it). */
export function startTolerance(target: StrokeData, phase: Phase): number {
  const tLen = target.length ?? pathLength(target.points);
  const scale = Math.max(MIN_TOL, Math.min(1, 0.6 + tLen));
  return Math.max(MIN_TOL * 1.5, TOLERANCE[phase].start * scale);
}

// Compare one drawn stroke with one target stroke.
export function compareStroke(drawn: Pt[], target: StrokeData, phase: Phase = 2): CompareResult {
  const tol = TOLERANCE[phase];
  const u0 = resample(drawn);
  const t = target.points;
  const tLen = target.length ?? pathLength(t);
  const scale = Math.max(MIN_TOL, Math.min(1, 0.6 + tLen)); // short strokes get tighter absolute tol, floored
  const meanTol = Math.max(MIN_TOL, tol.mean * scale);
  const startTol = Math.max(MIN_TOL * 1.5, tol.start * scale);

  // Phase 3: forgive overall placement up to `shift`; placement is scored separately.
  const cu = centroid(u0);
  const ct = centroid(t);
  let ox = cu[0] - ct[0];
  let oy = cu[1] - ct[1];
  const off = Math.hypot(ox, oy);
  if (tol.shift === 0) {
    ox = 0;
    oy = 0;
  } else if (off > tol.shift) {
    ox *= tol.shift / off;
    oy *= tol.shift / off;
  }
  const u: Pt[] = u0.map(([x, y]) => [x - ox, y - oy]);

  let sum = 0;
  for (let i = 0; i < N; i++) sum += dist(u[i], t[i]);
  const meanDist = sum / N;
  const startDist = dist(u[0], t[0]);
  // Length is measured on a lightly smoothed copy so finger jitter does not
  // count as extra ink; short strokes (ticks) get a looser upper bound.
  const lenRatio = pathLength(smooth(u0)) / (tLen || 1e-9);
  const maxRatio = LENGTH_RATIO[1] + (tLen < 0.15 ? 1 : 0);
  const tc: Pt = [t[N - 1][0] - t[0][0], t[N - 1][1] - t[0][1]];
  const uc: Pt = [u[N - 1][0] - u[0][0], u[N - 1][1] - u[0][1]];
  const tcLen = Math.hypot(tc[0], tc[1]);
  const ucLen = Math.hypot(uc[0], uc[1]);
  const dirCos = tcLen > 0.08 && ucLen > 1e-6 ? (tc[0] * uc[0] + tc[1] * uc[1]) / (tcLen * ucLen) : 1;

  const reasons: string[] = [];
  if (meanDist > meanTol) reasons.push("shape");
  if (startDist > startTol) reasons.push("start");
  if (lenRatio < LENGTH_RATIO[0]) reasons.push("too-short");
  if (lenRatio > maxRatio) reasons.push("too-long");
  if (dirCos < MIN_DIR_COS) reasons.push("direction");

  const quality = Math.max(0, Math.min(1, 1 - meanDist / (meanTol * 1.25)));
  return { pass: reasons.length === 0, quality, meanDist, startDist, offset: off, lenRatio, dirCos, reasons };
}

// Judge a drawn stroke when stroke `expected` is next. If it fails but matches
// a later stroke, report an order slip so the UI can say "Let's do stroke 2 first".
export function judgeNext(drawn: Pt[], kana: GlyphData, expected: number, phase: Phase = 2): JudgeResult {
  const res = compareStroke(drawn, kana.strokes[expected], phase);
  if (res.pass) return { ...res, kind: "ok" };
  for (let k = expected + 1; k < kana.strokes.length; k++) {
    const other = compareStroke(drawn, kana.strokes[k], phase);
    if (other.pass) return { ...res, kind: "order", matchedStroke: k };
  }
  return { ...res, kind: "miss" };
}

// "Hot potato / cold potato": 0 = right on the model (hot), 1 = far (cold).
export function warmth(p: Pt, line: Pt[], phase: Phase = 2): number {
  const t = TOLERANCE[phase].mean * 1.5;
  return Math.min(1, nearestDistance(p, line) / t);
}

export const starsFor = (score: number): 1 | 2 | 3 => (score >= 80 ? 3 : score >= 55 ? 2 : 1);

// Phase-3 character score, 0..100: shape 70, placement 15, proportion 15,
// minus 5 per retried stroke. `strokes` = accepted drawn strokes in order.
export function scoreCharacter(strokes: Pt[][], kana: GlyphData, firstTryCount = strokes.length): CharacterScore {
  const results = strokes.map((s, i) => compareStroke(s, kana.strokes[i], 3));
  const shape = results.reduce((a, r) => a + r.quality, 0) / results.length;
  const all = strokes.flat();
  const model = kana.strokes.flatMap((s) => s.points);
  const bb = (pts: Pt[]) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return { x0, x1, y0, y1 };
  };
  const a = bb(all);
  const m = bb(model);
  const ca: Pt = [(a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2];
  const cm: Pt = [(m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2];
  const placement = Math.max(0, 1 - dist(ca, cm) / 0.25);
  const rw = (a.x1 - a.x0) / Math.max(0.05, m.x1 - m.x0);
  const rh = (a.y1 - a.y0) / Math.max(0.05, m.y1 - m.y0);
  const proportion = Math.max(0, 1 - (Math.abs(Math.log(rw)) + Math.abs(Math.log(rh))) / 1.4);
  const retryPenalty = 1 - 0.05 * Math.max(0, strokes.length - firstTryCount);
  const score = Math.max(0, Math.round(100 * retryPenalty * (0.7 * shape + 0.15 * placement + 0.15 * proportion)));
  return { score, shape, placement, proportion, stars: starsFor(score) };
}
