// Reference stroke matcher for Hiragana Writing Buddy.
// Plain ES module, no dependencies. The app may port this to TypeScript;
// keep the behaviour and the thresholds in TOLERANCE unless playtests say otherwise.
//
// Coordinates: everything is in cell units, 0..1 on both axes (the writing
// square), matching data/kana-strokes.json.

export const N = 32; // points per resampled stroke (matches the data file)

// Leniency per phase, in cell units. Tuned with tests/matcher.test.mjs on
// synthetic child-like traces; re-tune after real playtests.
export const TOLERANCE = {
  1: { mean: 0.15, start: 0.22, shift: 0.0 },  // watch and trace: ghost of one stroke
  2: { mean: 0.13, start: 0.20, shift: 0.0 },  // trace whole ghost
  3: { mean: 0.12, start: 0.18, shift: 0.18 }, // write from memory: shape judged after
                                               // removing up to 0.18 of offset
};
const MIN_TOL = 0.07;          // floor for tiny strokes (dakuten ticks)
const LENGTH_RATIO = [0.4, 2.0];
const MIN_DIR_COS = 0.2;       // direction check for strokes with a clear chord

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function pathLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

export function resample(pts, n = N) {
  if (pts.length === 1) return Array.from({ length: n }, () => pts[0].slice());
  const total = pathLength(pts);
  if (total === 0) return Array.from({ length: n }, () => pts[0].slice());
  const step = total / (n - 1);
  const out = [pts[0].slice()];
  let acc = 0, target = step;
  for (let i = 1; i < pts.length && out.length < n - 1; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let seg = dist(a, b);
    while (acc + seg >= target && out.length < n - 1) {
      const t = (target - acc) / seg;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(p);
      seg -= target - acc; acc = 0; a = p; target = step;
    }
    acc += seg;
  }
  while (out.length < n) out.push(pts[pts.length - 1].slice());
  return out;
}

// 5-point moving average, endpoints kept.
export function smooth(pts) {
  return pts.map((p, i) => {
    if (i < 2 || i > pts.length - 3) return p;
    let x = 0, y = 0;
    for (let k = -2; k <= 2; k++) { x += pts[i + k][0]; y += pts[i + k][1]; }
    return [x / 5, y / 5];
  });
}

const centroid = (pts) => {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
};

// Distance from point p to the nearest point of polyline `line`.
export function nearestDistance(p, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    if (d < best) best = d;
  }
  return best;
}

// Compare one drawn stroke with one target stroke.
// Returns { pass, quality (0..1), meanDist, startDist, offset, reasons[] }.
export function compareStroke(drawn, target, phase = 2) {
  const tol = TOLERANCE[phase];
  const u0 = resample(drawn);
  const t = target.points;
  const tLen = target.length ?? pathLength(t);
  const scale = Math.max(MIN_TOL, Math.min(1, 0.6 + tLen)); // short strokes get tighter absolute tol, floored
  const meanTol = Math.max(MIN_TOL, tol.mean * scale);
  const startTol = Math.max(MIN_TOL * 1.5, tol.start * scale);

  // Phase 3: forgive overall placement up to `shift`; placement is scored separately.
  const cu = centroid(u0), ct = centroid(t);
  let ox = cu[0] - ct[0], oy = cu[1] - ct[1];
  const off = Math.hypot(ox, oy);
  if (tol.shift === 0) { ox = 0; oy = 0; }
  else if (off > tol.shift) { ox *= tol.shift / off; oy *= tol.shift / off; }
  const u = u0.map(([x, y]) => [x - ox, y - oy]);

  let sum = 0;
  for (let i = 0; i < N; i++) sum += dist(u[i], t[i]);
  const meanDist = sum / N;
  const startDist = dist(u[0], t[0]);
  // Length is measured on a lightly smoothed copy so finger jitter does not
  // count as extra ink; short strokes (ticks) get a looser upper bound.
  const lenRatio = pathLength(smooth(u0)) / (tLen || 1e-9);
  const maxRatio = LENGTH_RATIO[1] + (tLen < 0.15 ? 1 : 0);
  const tc = [t[N - 1][0] - t[0][0], t[N - 1][1] - t[0][1]];
  const uc = [u[N - 1][0] - u[0][0], u[N - 1][1] - u[0][1]];
  const tcLen = Math.hypot(...tc), ucLen = Math.hypot(...uc);
  const dirCos = tcLen > 0.08 && ucLen > 1e-6 ? (tc[0] * uc[0] + tc[1] * uc[1]) / (tcLen * ucLen) : 1;

  const reasons = [];
  if (meanDist > meanTol) reasons.push("shape");
  if (startDist > startTol) reasons.push("start");
  if (lenRatio < LENGTH_RATIO[0]) reasons.push("too-short");
  if (lenRatio > maxRatio) reasons.push("too-long");
  if (dirCos < MIN_DIR_COS) reasons.push("direction");

  const quality = Math.max(0, Math.min(1, 1 - meanDist / (meanTol * 1.25)));
  return { pass: reasons.length === 0, quality, meanDist, startDist, offset: off, lenRatio, dirCos, reasons };
}

// Judge a drawn stroke when stroke `expected` is next.
// If it fails but matches a later stroke, report an order mistake so the UI
// can say "Let's do stroke 2 first" instead of "try again".
export function judgeNext(drawn, kana, expected, phase = 2) {
  const res = compareStroke(drawn, kana.strokes[expected], phase);
  if (res.pass) return { ...res, kind: "ok" };
  for (let k = expected + 1; k < kana.strokes.length; k++) {
    const other = compareStroke(drawn, kana.strokes[k], phase);
    if (other.pass) return { ...res, kind: "order", matchedStroke: k };
  }
  return { ...res, kind: "miss" };
}

// "Hot potato / cold potato": 0 = right on the model (hot), 1 = far (cold).
// Use per point while drawing to tint the ink. `line` = target stroke points.
export function warmth(p, line, phase = 2) {
  const t = TOLERANCE[phase].mean * 1.5;
  return Math.min(1, nearestDistance(p, line) / t);
}

// Phase-3 character score, 0..100.
//   shape 70: mean stroke quality
//   placement 15: how close the character's centre is to the cell centre of the model
//   proportion 15: bounding-box width/height vs the model's
// `strokes` = drawn strokes in order (already accepted), `kana` = data entry.
export function scoreCharacter(strokes, kana, firstTryCount = strokes.length) {
  const results = strokes.map((s, i) => compareStroke(s, kana.strokes[i], 3));
  const shape = results.reduce((a, r) => a + r.quality, 0) / results.length;
  const all = strokes.flat(), model = kana.strokes.flatMap((s) => s.points);
  const bb = (pts) => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  const a = bb(all), m = bb(model);
  const ca = [(a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2], cm = [(m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2];
  const placement = Math.max(0, 1 - dist(ca, cm) / 0.25);
  const rw = (a.x1 - a.x0) / Math.max(0.05, m.x1 - m.x0), rh = (a.y1 - a.y0) / Math.max(0.05, m.y1 - m.y0);
  const proportion = Math.max(0, 1 - (Math.abs(Math.log(rw)) + Math.abs(Math.log(rh))) / 1.4);
  const retryPenalty = 1 - 0.05 * Math.max(0, strokes.length - firstTryCount);
  const score = Math.round(100 * retryPenalty * (0.7 * shape + 0.15 * placement + 0.15 * proportion));
  return { score: Math.max(0, score), shape, placement, proportion, stars: score >= 80 ? 3 : score >= 55 ? 2 : 1 };
}
