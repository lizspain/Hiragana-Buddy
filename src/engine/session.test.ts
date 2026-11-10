import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GlyphData, Pt } from "./matcher";
import { CharacterSession } from "./session";

const data = JSON.parse(readFileSync(new URL("../../data/kana-strokes.json", import.meta.url), "utf8")).kana as Record<string, GlyphData>;
const a = data["あ"];
const scribble: Pt[] = [[0.9, 0.9], [0.95, 0.92], [0.9, 0.95]];
/** The right stroke drawn sloppily: too far off even for phase 1, still recognisably this stroke. */
const sloppy = (pts: Pt[]) => pts.map(([x, y]) => [x + 0.14, y + 0.08] as Pt);
/** Starts at the dot, then runs right across the page. */
const across = (start: Pt): Pt[] => [start, [start[0] + 0.45, start[1]], [start[0] + 0.9, start[1] + 0.02]];

describe("CharacterSession", () => {
  it("accepts the model strokes in order and scores 3 stars", () => {
    const s = new CharacterSession(a, 3);
    for (const st of a.strokes) expect(s.submit(st.points).kind).toBe("accept");
    expect(s.done).toBe(true);
    expect(s.score().stars).toBe(3);
    expect(s.drawing()[0]).toHaveLength(16);
  });

  it("reports stroke 2 drawn first as an order slip, then still accepts stroke 1", () => {
    const s = new CharacterSession(a, 2);
    const out = s.submit(a.strokes[1].points);
    expect(out).toMatchObject({ kind: "order", stroke: 0, drawn: 1, help: "replay" });
    expect(s.submit(a.strokes[0].points).kind).toBe("accept");
    expect(s.retried).toBe(1);
  });

  it("phase 1: climbs the correction ladder and then does it together", () => {
    const s = new CharacterSession(a, 1);
    expect(s.submit(scribble)).toMatchObject({ kind: "retry", help: "replay" });
    expect(s.submit(scribble)).toMatchObject({ kind: "retry", help: "pulse" });
    expect(s.submit(scribble)).toMatchObject({ kind: "retry", help: "together" });
    expect(s.together).toBe(true);
    expect(s.submit(across(a.strokes[0].points[0]))).toMatchObject({ kind: "retry", help: "together" });
    expect(s.submit(sloppy(a.strokes[0].points))).toMatchObject({ kind: "accept", together: true });
  });

  it("phases 2–3: third miss switches the stroke to follow-me, judged as phase 1", () => {
    for (const phase of [2, 3] as const) {
      const s = new CharacterSession(a, phase);
      s.submit(scribble);
      s.submit(scribble);
      expect(s.submit(scribble)).toMatchObject({ kind: "retry", help: "follow" });
      expect(s.followMe).toBe(true);
      expect(s.judgePhase).toBe(1);
      expect(s.together).toBe(false);
      // A trace that is a little off: too loose for phase 3, fine for phase 1.
      const off = a.strokes[0].points.map(([x, y]) => [x + 0.09, y + 0.05] as Pt);
      expect(s.submit(off)).toMatchObject({ kind: "accept", together: false });
      expect(s.followMe).toBe(false); // the next stroke starts fresh
    }
  });

  it("phases 2–3: after three follow-me misses, does it together", () => {
    const s = new CharacterSession(a, 3);
    for (let i = 0; i < 5; i++) s.submit(scribble);
    expect(s.submit(scribble)).toMatchObject({ kind: "retry", help: "together" });
    expect(s.together).toBe(true);
    // Together, a sloppy copy of the stroke is enough; a line across the page still isn't.
    expect(s.submit(across(a.strokes[0].points[0])).kind).toBe("retry");
    const out = s.submit(sloppy(a.strokes[0].points));
    expect(out).toMatchObject({ kind: "accept", together: true });
    expect(s.misses).toBe(0);
  });

  it("never scores below 1 star", () => {
    const s = new CharacterSession(a, 3);
    for (const st of a.strokes) {
      for (let i = 0; i < 6; i++) s.submit(scribble);
      s.submit(sloppy(st.points));
    }
    expect(s.done).toBe(true);
    expect(s.score().stars).toBeGreaterThanOrEqual(1);
  });

  it("after three together tries that miss, fills the stroke in and moves on", () => {
    for (const [phase, togetherAt] of [[1, 3], [3, 6]] as const) {
      const s = new CharacterSession(a, phase);
      for (let i = 0; i < togetherAt + 2; i++) expect(s.submit(scribble).kind).toBe("retry");
      const out = s.submit(scribble);
      expect(out).toMatchObject({ kind: "moveOn", stroke: 0, phaseDone: false });
      expect(s.k).toBe(1);
      expect(s.misses).toBe(0);
      expect(s.accepted[0]).toEqual(a.strokes[0].points);
    }
  });

  it("a word where every stroke moves on still finishes with at least 1 star", () => {
    const s = new CharacterSession(a, 3);
    while (!s.done) s.submit(scribble);
    expect(s.score().stars).toBeGreaterThanOrEqual(1);
  });
});
