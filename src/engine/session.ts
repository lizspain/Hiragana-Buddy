// Per-character stroke-order engine: demo(k) → await(k) → judge → accept | retry.
// Pure logic, no DOM; the writing screen drives it and renders the outcome.

import { judgeNext, resample, scoreCharacter, startTolerance, type CharacterScore, type GlyphData, type Phase, type Pt } from "./matcher";

/** Accept anything that starts this close to the dot once we are "doing it together". */
const TOGETHER_START = 0.22;

export type Outcome =
  | { kind: "accept"; stroke: number; together: boolean; phaseDone: boolean }
  /** level 1: fade + replay; 2: pulse start dot + arrow; 3: let's do it together */
  | { kind: "retry"; stroke: number; level: 1 | 2 | 3 }
  /** Drew a later stroke: "That's stroke {drawn+1}! Let's do stroke {stroke+1} first." */
  | { kind: "order"; stroke: number; drawn: number; level: 1 | 2 | 3 };

export class CharacterSession {
  phase: Phase;
  /** Index of the stroke that is due next. */
  k = 0;
  /** Misses (incl. order slips) on the current stroke. */
  misses = 0;
  accepted: Pt[][] = [];
  /** Strokes in this phase that needed at least one retry. */
  retried = 0;

  readonly glyph: GlyphData;

  constructor(glyph: GlyphData, phase: Phase) {
    this.glyph = glyph;
    this.phase = phase;
  }

  get strokeCount(): number {
    return this.glyph.strokes.length;
  }

  get done(): boolean {
    return this.k >= this.strokeCount;
  }

  /** Third miss on a stroke switches to "let's do it together". */
  get together(): boolean {
    return this.misses >= 3;
  }

  submit(points: Pt[]): Outcome {
    const stroke = this.k;
    const target = this.glyph.strokes[stroke];
    if (this.together) {
      const tol = Math.max(TOGETHER_START, startTolerance(target, this.phase));
      if (Math.hypot(points[0][0] - target.points[0][0], points[0][1] - target.points[0][1]) <= tol) {
        return this.accept(points, true);
      }
    }
    const res = judgeNext(points, this.glyph, stroke, this.phase);
    if (res.kind === "ok") return this.accept(points, false);
    this.misses++;
    const level = Math.min(3, this.misses) as 1 | 2 | 3;
    if (res.kind === "order") return { kind: "order", stroke, drawn: res.matchedStroke!, level };
    return { kind: "retry", stroke, level };
  }

  private accept(points: Pt[], together: boolean): Outcome {
    const stroke = this.k;
    if (this.misses > 0) this.retried++;
    this.accepted.push(points);
    this.k++;
    this.misses = 0;
    return { kind: "accept", stroke, together, phaseDone: this.done };
  }

  /** Phase-3 score; call once `done`. */
  score(): CharacterScore {
    return scoreCharacter(this.accepted, this.glyph, this.strokeCount - this.retried);
  }

  /** Accepted strokes downsampled to 16 points each, rounded, for history. */
  drawing(): Pt[][] {
    return this.accepted.map((s) => resample(s, 16).map(([x, y]) => [round3(x), round3(y)] as Pt));
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
