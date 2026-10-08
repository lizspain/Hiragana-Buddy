// Same synthetic suite as matcher.test.mjs, run against the TypeScript port src/engine/matcher.ts.
// Run: node --test tests/
//
// Generates child-like traces from every kana in data/kana-strokes.json:
//   good  = jitter + wobble + offset + scale + uneven sampling  -> should pass
//   bad   = reversed direction, wrong stroke, random scribble     -> should fail
// Prints pass rates per phase. Thresholds below are the acceptance bar.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareStroke, judgeNext, scoreCharacter } from "../src/engine/matcher.ts";

const data = JSON.parse(readFileSync(new URL("../data/kana-strokes.json", import.meta.url), "utf8")).kana;
const PRACTICE = [...Object.keys(data)].filter((c) => !"ゐゑゔゕゖ".includes(c));

// Deterministic PRNG so results are repeatable.
let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

// Child-like copy of a model stroke.
// Noise is relative to the cell (0..1). Wobble shrinks on short strokes: a
// child's dakuten tick is sloppy but not wavy.
function childTrace(points, { jitter = 0.006, wobble = 0.03, offset = 0.05, scale = 0.12, center = [0.5, 0.5] } = {}) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  wobble *= Math.min(1, len / 0.4);
  jitter *= Math.min(1, 0.4 + len);
  const s = 1 + (rand() * 2 - 1) * scale;
  const ox = (rand() * 2 - 1) * offset, oy = (rand() * 2 - 1) * offset;
  const ph = rand() * 6.28, freq = 1 + rand() * 2;
  const out = [];
  // uneven sampling: 20..60 points, clustered (slow and fast finger)
  const n = 20 + Math.floor(rand() * 40);
  const speed = 0.7 + rand() * 0.6; // <1 = fast start, >1 = slow start
  for (let i = 0; i < n; i++) {
    const u = Math.pow(i / (n - 1), speed);
    const f = u * (points.length - 1), k = Math.min(points.length - 2, Math.floor(f)), t = f - k;
    const x = points[k][0] + (points[k + 1][0] - points[k][0]) * t;
    const y = points[k][1] + (points[k + 1][1] - points[k][1]) * t;
    const w = wobble * Math.sin(ph + u * freq * 6.28);
    out.push([
      center[0] + (x - center[0]) * s + ox + w + gauss() * jitter,
      center[1] + (y - center[1]) * s + oy - w + gauss() * jitter,
    ]);
  }
  return out;
}

function rates(phase, opts) {
  let good = 0, goodN = 0, rev = 0, revN = 0, wrong = 0, wrongN = 0, scrib = 0, scribN = 0;
  for (const ch of PRACTICE) {
    const strokes = data[ch].strokes;
    strokes.forEach((st, i) => {
      for (let r = 0; r < 5; r++) {
        goodN++; if (compareStroke(childTrace(st.points, opts), st, phase).pass) good++;
      }
      revN++; if (!compareStroke(childTrace([...st.points].reverse(), opts), st, phase).pass) rev++;
      const j = (i + 1) % strokes.length;
      if (j !== i) { wrongN++; if (!compareStroke(childTrace(strokes[j].points, opts), st, phase).pass) wrong++; }
      const sc = Array.from({ length: 30 }, () => [rand(), rand()]);
      scribN++; if (!compareStroke(sc, st, phase).pass) scrib++;
    });
  }
  return { goodAccepted: good / goodN, reversedRejected: rev / revN, wrongStrokeRejected: wrong / wrongN, scribbleRejected: scrib / scribN };
}

for (const phase of [1, 2]) {
  test(`phase ${phase}: tolerant of wobble, strict on order and direction`, () => {
    const r = rates(phase, { offset: 0.04 });
    console.log(`phase ${phase}`, JSON.stringify(r, (k, v) => (typeof v === "number" ? +v.toFixed(3) : v)));
    assert.ok(r.goodAccepted >= 0.95, "good traces accepted");
    assert.ok(r.reversedRejected >= 0.9, "reversed strokes rejected");
    assert.ok(r.wrongStrokeRejected >= 0.85, "wrong stroke rejected");
    assert.ok(r.scribbleRejected >= 0.99, "scribbles rejected");
  });
}

test("phase 3: forgives placement offset up to ~0.15 of the cell", () => {
  const r = rates(3, { offset: 0.14 });
  console.log("phase 3", JSON.stringify(r, (k, v) => (typeof v === "number" ? +v.toFixed(3) : v)));
  assert.ok(r.goodAccepted >= 0.95);
  assert.ok(r.reversedRejected >= 0.9);
  assert.ok(r.scribbleRejected >= 0.99);
});

test("order mistakes are reported as order, not as a miss", () => {
  const k = data["さ"];
  const res = judgeNext(childTrace(k.strokes[1].points, { offset: 0.02 }), k, 0, 2);
  assert.equal(res.kind, "order");
  assert.equal(res.matchedStroke, 1);
});

test("character score: neat > wobbly > misplaced, stars never below 1", () => {
  const k = data["あ"];
  const neat = scoreCharacter(k.strokes.map((s) => childTrace(s.points, { jitter: 0.004, wobble: 0.005, offset: 0, scale: 0 })), k);
  const wobbly = scoreCharacter(k.strokes.map((s) => childTrace(s.points, { jitter: 0.015, wobble: 0.05, offset: 0.03 })), k);
  console.log("score neat", neat.score, "wobbly", wobbly.score);
  assert.ok(neat.score > wobbly.score);
  assert.ok(neat.stars === 3);
  assert.ok(wobbly.stars >= 1);
});
