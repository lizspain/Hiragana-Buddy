import { describe, expect, it } from "vitest";
import { STAR_THRESHOLDS } from "../match/config";
import { pathState, currentStone } from "../match/progress";
import { extraKana, tilesFor, VocabGame } from "./game";
import { stageById, VOCAB_STAGES } from "./stages";

/** Small seeded PRNG (mulberry32) so shuffles are repeatable. */
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const S1A = stageById("1A")!;
const S1B = stageById("1B")!;
const S2B = stageById("2B")!;

/** The waiting tile that fits slot `i` of the current word. */
const fits = (g: VocabGame, i: number) => g.tiles.find((t) => t.slot === null && t.kana === g.word!.kana[i])!.id;
/** A waiting tile that fits no empty slot (the extra, or a duplicate already used). */
const misfit = (g: VocabGame) => g.tiles.find((t) => t.extra)!.id;

/** Spell the current word by taps, `wrong` wrong tiles first. */
function spell(g: VocabGame, wrong = 0) {
  g.unlock();
  for (let i = 0; i < wrong; i++) {
    expect(g.tap(misfit(g)).kind).toBe("wrong");
    g.lock(); // the word is said again
    g.unlock();
  }
  let r;
  for (let i = 0; i < g.word!.kana.length; i++) r = g.tap(fits(g, i));
  expect(r).toMatchObject({ kind: "placed", wordDone: true });
  g.next();
}

describe("tiles", () => {
  it("the extra tile comes from the stage's set and is never in the word", () => {
    for (const stage of VOCAB_STAGES)
      for (const w of stage.words)
        for (let s = 1; s <= 30; s++) {
          const x = extraKana(w.kana, stage.setKana, seeded(s));
          expect(stage.setKana).toContain(x);
          expect(w.kana).not.toContain(x);
        }
  });

  it("a set 2 word gets a set 2 extra tile (くま)", () => {
    const kuma = stageById("2A")!.words.find((w) => w.id === "kuma")!;
    for (let s = 1; s <= 30; s++) expect([..."しまうはあこさと"]).toContain(extraKana(kuma.kana, stageById("2A")!.setKana, seeded(s)));
  });

  it("one tile per letter plus one: みみ has two み, とまと two と", () => {
    const mimi = tilesFor(["み", "み"], S1B.setKana, seeded(3));
    expect(mimi.filter((t) => t.kana === "み")).toHaveLength(2);
    expect(mimi).toHaveLength(3);
    const tomato = tilesFor(["と", "ま", "と"], S2B.setKana, seeded(4));
    expect(tomato.filter((t) => t.kana === "と")).toHaveLength(2);
    expect(tomato).toHaveLength(4);
    expect(tomato.filter((t) => t.extra)).toHaveLength(1);
    expect(new Set(tomato.map((t) => t.id)).size).toBe(4);
  });

  it("shuffles the tiles", () => {
    const orders = new Set(Array.from({ length: 20 }, (_, s) => tilesFor(["つ", "み", "き"], S1B.setKana, seeded(s)).map((t) => t.kana).join("")));
    expect(orders.size).toBeGreaterThan(3);
  });
});

describe("a game", () => {
  it("is the stage's 8 words in a shuffled order", () => {
    const g = new VocabGame(S1A, seeded(1));
    expect(g.words.map((w) => w.id).sort()).toEqual(S1A.words.map((w) => w.id).sort());
    const orders = new Set(Array.from({ length: 10 }, (_, s) => new VocabGame(S1A, seeded(s)).words.map((w) => w.id).join()));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("all clean: 8 clean words, 3 stars", () => {
    const g = new VocabGame(S1A, seeded(2));
    while (!g.done) spell(g);
    expect(g.cleanWords).toBe(8);
    expect(g.stars).toBe(3);
  });

  it("scores clean words with the shared thresholds", () => {
    const play = (dirty: number) => {
      const g = new VocabGame(S1B, seeded(5));
      for (let i = 0; !g.done; i++) spell(g, i < dirty ? 1 : 0);
      return g;
    };
    expect(STAR_THRESHOLDS).toEqual({ three: 7, two: 5 });
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((d) => play(d).stars)).toEqual([3, 3, 2, 2, 1, 1, 1, 1, 1]); // clean 8 7 | 6 5 | 4 … 0
    expect(play(3).cleanWords).toBe(5);
    expect(play(3).clean.filter((c) => !c)).toHaveLength(3);
  });

  it("tap out of order: the tile is wrong and stays out; the next letter still fits", () => {
    const g = new VocabGame(S1A, seeded(7));
    while (g.word!.kana.length < 2 || g.word!.kana[0] === g.word!.kana[1]) spell(g);
    g.unlock();
    const second = fits(g, 1);
    expect(g.tap(second)).toEqual({ kind: "wrong", wrongs: 1, hint: false });
    expect(g.tiles.find((t) => t.id === second)!.slot).toBeNull();
    expect(g.tap(fits(g, 0))).toEqual({ kind: "placed", slot: 0, wordDone: false });
    expect(g.tap(second)).toEqual({ kind: "placed", slot: 1, wordDone: true });
    g.next();
    expect(g.clean).toContain(false);
  });

  it("drag into a later slot: stays when it fits, even with earlier slots empty", () => {
    const g = new VocabGame(S1A, seeded(8));
    while (g.word!.kana.length < 2) spell(g);
    g.unlock();
    expect(g.drop(fits(g, 1), 1)).toEqual({ kind: "placed", slot: 1, wordDone: false });
    expect(g.slots[0]).toBeNull();
    expect(g.leftmostEmpty).toBe(0);
    // A tap now fills the leftmost empty slot, slot 0.
    expect(g.tap(fits(g, 0))).toEqual({ kind: "placed", slot: 0, wordDone: true });
    expect(g.wrongTiles[g.index]).toBe(0);
  });

  it("drag onto a slot needing another kana is wrong; onto a filled slot is nothing", () => {
    const g = new VocabGame(S1A, seeded(9));
    while (g.word!.kana.length < 2 || g.word!.kana[0] === g.word!.kana[1]) spell(g);
    g.unlock();
    expect(g.drop(fits(g, 0), 1)).toMatchObject({ kind: "wrong", wrongs: 1 });
    g.drop(fits(g, 1), 1);
    expect(g.drop(misfit(g), 1)).toEqual({ kind: "ignored" });
    expect(g.wrongTiles[g.index]).toBe(1);
  });

  it("same-kana tiles are interchangeable (みみ)", () => {
    const g = new VocabGame(S1B, seeded(10));
    while (g.word!.id !== "mimi") spell(g);
    g.unlock();
    const [a, b] = g.tiles.filter((t) => t.kana === "み").map((t) => t.id);
    expect(g.drop(b, 0)).toMatchObject({ kind: "placed", slot: 0 });
    expect(g.tap(a)).toEqual({ kind: "placed", slot: 1, wordDone: true });
  });

  it("three wrong tiles, then the tile for the leftmost empty slot glows", () => {
    const g = new VocabGame(S1A, seeded(11));
    while (g.word!.kana.length < 2) spell(g);
    g.unlock();
    g.drop(fits(g, 1), 1); // slot 1 filled, slot 0 still empty
    expect(g.tap(misfit(g))).toEqual({ kind: "wrong", wrongs: 1, hint: false });
    expect(g.tap(misfit(g))).toEqual({ kind: "wrong", wrongs: 2, hint: false });
    expect(g.hintTile).toBeNull();
    expect(g.tap(misfit(g))).toEqual({ kind: "wrong", wrongs: 3, hint: true });
    expect(g.hintTile).toBe(fits(g, 0));
    g.tap(g.hintTile!);
    g.next();
    expect(g.hintTile).toBeNull(); // the next word starts fresh
    expect(g.clean).toEqual([...g.clean.slice(0, -1), false]); // a hinted word isn't clean
  });

  it("touches during a lock are ignored and not counted", () => {
    const g = new VocabGame(S1A, seeded(12));
    expect(g.isLocked).toBe(true); // locked until the word has been said
    expect(g.tap(misfit(g))).toEqual({ kind: "ignored" });
    expect(g.tap(fits(g, 0))).toEqual({ kind: "ignored" });
    expect(g.drop(fits(g, 0), 0)).toEqual({ kind: "ignored" });
    expect(g.wrongTiles[0]).toBe(0);
    expect(g.slots.every((s) => s === null)).toBe(true);
    // Finishing a word locks again for the finish sequence.
    g.unlock();
    for (let i = 0; i < g.word!.kana.length; i++) g.tap(fits(g, i));
    expect(g.isLocked).toBe(true);
    g.next();
    expect(g.isLocked).toBe(true);
    expect(g.tap(fits(g, 0))).toEqual({ kind: "ignored" });
  });

  it("a placed tile can't be placed again, and next() waits for a finished word", () => {
    const g = new VocabGame(S1A, seeded(13));
    while (g.word!.kana.length < 2) spell(g);
    g.unlock();
    const t = fits(g, 0);
    g.tap(t);
    expect(g.tap(t)).toEqual({ kind: "ignored" });
    const at = g.index;
    g.next();
    expect(g.index).toBe(at);
  });
});

describe("the stage path", () => {
  it("1A opens first; each next stage opens at a best of 3 stars; the parent switch opens all", () => {
    const ids = VOCAB_STAGES.map((s) => s.id);
    const best = (b: Record<string, 0 | 1 | 2 | 3>) => (id: string) => b[id] ?? 0;
    expect(pathState(ids, best({})).map((s) => s.open)).toEqual([true, false, false, false]);
    expect(pathState(ids, best({ "1A": 2 })).map((s) => s.open)).toEqual([true, false, false, false]);
    expect(pathState(ids, best({ "1A": 3 })).map((s) => s.open)).toEqual([true, true, false, false]);
    expect(pathState(ids, best({ "1A": 3, "1B": 3, "2A": 1 })).map((s) => s.open)).toEqual([true, true, true, false]);
    expect(pathState(ids, best({}), true).map((s) => s.open)).toEqual([true, true, true, true]);
    // Switch off again: unearned stages close, the stars stay. (2B stays open: the
    // stage right before it has 3 stars, the same rule as Listen & Match.)
    const off = pathState(ids, best({ "1B": 2, "2A": 3 }), false);
    expect(off.map((s) => s.open)).toEqual([true, false, false, true]);
    expect(off.map((s) => s.best)).toEqual([0, 2, 3, 0]);
    expect(currentStone(pathState(ids, best({ "1A": 3 })))).toBe(1);
  });
});
