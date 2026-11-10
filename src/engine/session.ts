// Per-character stroke-order engine: demo(k) → await(k) → judge → accept | retry.
// Pure logic, no DOM; the writing screen drives it and renders the outcome.
//
// Help ladder for the stroke that is due, by misses (order slips count):
//   phase 1:     1 replay · 2 pulse the start dot · 3+ do it together
//   phases 2–3:  1 replay · 2 pulse the start dot · 3–5 follow me (this stroke
//                goes back to phase-1 "watch and trace": demo, its own ghost,
//                phase-1 tolerance) · 6+ do it together

import { compareStroke, judgeNext, resample, scoreCharacter, startTolerance, type CharacterScore, type GlyphData, type Phase, type Pt } from "./matcher";

/** "Doing it together": a stroke that starts this close to the dot… */
const TOGETHER_START = 0.22;
const FOLLOW_AT = 3;
const TOGETHER_AFTER_FOLLOW = 6;
/** "Together" tries before the stroke is filled in and we move on. */
const TOGETHER_TRIES = 3;

export type Help = "replay" | "pulse" | "follow" | "together";

export type Outcome =
  | { kind: "accept"; stroke: number; together: boolean; phaseDone: boolean }
  /** Still no match after the "together" tries: the model stroke stands in for theirs. */
  | { kind: "moveOn"; stroke: number; points: Pt[]; phaseDone: boolean }
  | { kind: "retry"; stroke: number; help: Help }
  /** Drew a later stroke: "That's stroke {drawn+1}! Let's do stroke {stroke+1} first." */
  | { kind: "order"; stroke: number; drawn: number; help: Help };

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

  /** Phases 2–3 only: the current stroke is shown and judged as in phase 1. */
  get followMe(): boolean {
    return this.phase !== 1 && this.misses >= FOLLOW_AT;
  }

  /** Accept any stroke that starts near the dot. */
  get together(): boolean {
    return this.misses >= this.togetherAt;
  }

  private get togetherAt(): number {
    return this.phase === 1 ? FOLLOW_AT : TOGETHER_AFTER_FOLLOW;
  }

  /** Tolerances used for the current stroke. */
  get judgePhase(): Phase {
    return this.followMe ? 1 : this.phase;
  }

  get help(): Help {
    if (this.together) return "together";
    if (this.followMe) return "follow";
    return this.misses >= 2 ? "pulse" : "replay";
  }

  submit(points: Pt[]): Outcome {
    const stroke = this.k;
    const target = this.glyph.strokes[stroke];
    if (this.together) {
      const tol = Math.max(TOGETHER_START, startTolerance(target, this.judgePhase));
      const nearDot = Math.hypot(points[0][0] - target.points[0][0], points[0][1] - target.points[0][1]) <= tol;
      if (nearDot && roughlyThisStroke(points, target)) return this.accept(points, true);
    }
    const res = judgeNext(points, this.glyph, stroke, this.judgePhase);
    if (res.kind === "ok") return this.accept(points, false);
    this.misses++;
    if (this.misses >= this.togetherAt + TOGETHER_TRIES) return this.moveOn();
    if (res.kind === "order") return { kind: "order", stroke, drawn: res.matchedStroke!, help: this.help };
    return { kind: "retry", stroke, help: this.help };
  }

  private accept(points: Pt[], together: boolean): Outcome {
    const stroke = this.k;
    if (this.misses > 0) this.retried++;
    this.accepted.push(points);
    this.k++;
    this.misses = 0;
    return { kind: "accept", stroke, together, phaseDone: this.done };
  }

  /** Fill in the model stroke (counted as retried) and go on to the next one. */
  private moveOn(): Outcome {
    const stroke = this.k;
    const points = this.glyph.strokes[stroke].points.map(([x, y]) => [x, y] as Pt);
    this.retried++;
    this.accepted.push(points);
    this.k++;
    this.misses = 0;
    return { kind: "moveOn", stroke, points, phaseDone: this.done };
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

/**
 * …is accepted if it is still recognisably this stroke: the right direction and
 * about the right length, with its shape within 1.25× the gentlest (phase 1)
 * tolerance. A sloppy try passes; a scribble or a line across the page doesn't.
 * (Until Nov 2026 any stroke starting near the dot was accepted.)
 */
function roughlyThisStroke(points: Pt[], target: GlyphData["strokes"][number]): boolean {
  const r = compareStroke(points, target, 1);
  const forgiven = new Set(["shape", "start"]); // start is checked by the caller, more leniently
  return r.reasons.every((x) => forgiven.has(x)) && r.quality > 0;
}
