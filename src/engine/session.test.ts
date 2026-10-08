import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GlyphData, Pt } from "./matcher";
import { CharacterSession } from "./session";

const data = JSON.parse(readFileSync(new URL("../../data/kana-strokes.json", import.meta.url), "utf8")).kana as Record<string, GlyphData>;
const a = data["あ"];
const scribble: Pt[] = [[0.9, 0.9], [0.95, 0.92], [0.9, 0.95]];

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
    expect(out).toMatchObject({ kind: "order", stroke: 0, drawn: 1, level: 1 });
    expect(s.submit(a.strokes[0].points).kind).toBe("accept");
    expect(s.retried).toBe(1);
  });

  it("climbs the correction ladder and then does it together", () => {
    const s = new CharacterSession(a, 3);
    expect(s.submit(scribble)).toMatchObject({ kind: "retry", level: 1 });
    expect(s.submit(scribble)).toMatchObject({ kind: "retry", level: 2 });
    expect(s.submit(scribble)).toMatchObject({ kind: "retry", level: 3 });
    expect(s.together).toBe(true);
    // A wobbly line that merely starts at the dot is accepted now.
    const start = a.strokes[0].points[0];
    const out = s.submit([start, [start[0] + 0.1, start[1] + 0.2]]);
    expect(out).toMatchObject({ kind: "accept", together: true });
    expect(s.misses).toBe(0);
  });

  it("never scores below 1 star", () => {
    const s = new CharacterSession(a, 3);
    for (const st of a.strokes) {
      s.submit(scribble);
      s.submit(scribble);
      s.submit(scribble);
      s.submit([st.points[0], [st.points[0][0] + 0.05, st.points[0][1]]]);
    }
    expect(s.done).toBe(true);
    expect(s.score().stars).toBeGreaterThanOrEqual(1);
  });
});
