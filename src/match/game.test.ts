import { describe, expect, it } from "vitest";
import { HARD_PAIRS, HOMOPHONES, STAR_THRESHOLDS } from "./config";
import { MatchGame, shuffle } from "./game";
import { starsFor } from "./scoring";
import { CLASS_SETS, problems } from "./sets";

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

const SET = CLASS_SETS[0].kana;
const newGame = (seed = 1) => new MatchGame(SET, seeded(seed), () => 0);

/** Play a round: `wrongFirst` wrong taps, then the right one. Returns the found result. */
function playRound(g: MatchGame, wrongFirst = 0) {
  g.unlock();
  const wrong = g.tiles.filter((k) => k !== g.target && !g.found.includes(k));
  for (let i = 0; i < wrongFirst; i++) {
    expect(g.tap(wrong[i % wrong.length]).kind).toBe("wrong");
    g.lock(); // the prompt replays
    g.unlock();
  }
  const r = g.tap(g.target!);
  expect(r.kind).toBe("found");
  g.next();
  return r;
}

describe("scoring", () => {
  it("turns first-pick hits into 1–3 stars, never 0", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(starsFor)).toEqual([1, 1, 1, 1, 1, 2, 2, 3, 3]);
    expect(STAR_THRESHOLDS).toEqual({ three: 7, two: 5 });
  });
});

describe("shuffle", () => {
  it("keeps every item exactly once", () => {
    for (let s = 1; s < 50; s++) expect(shuffle(SET, seeded(s)).sort()).toEqual([...SET].sort());
  });

  it("shuffles the board and the prompts separately", () => {
    let differ = 0;
    for (let s = 1; s < 50; s++) {
      const g = newGame(s);
      expect([...g.tiles].sort()).toEqual([...SET].sort());
      expect([...g.prompts].sort()).toEqual([...SET].sort());
      if (g.tiles.join() !== g.prompts.join()) differ++;
    }
    expect(differ).toBeGreaterThan(45);
  });
});

describe("a game", () => {
  it("all first-try finds → 8 hits, 3 stars", () => {
    const g = newGame();
    for (let i = 0; i < 8; i++) expect(playRound(g)).toEqual({ kind: "found", firstTry: true, last: i === 7 });
    expect(g.done).toBe(true);
    expect(g.hits).toBe(8);
    expect(g.stars).toBe(3);
    expect(g.found.sort()).toEqual([...SET].sort());
  });

  it("a miss before every find still ends the game, with 1 star (the last round can't be missed)", () => {
    const g = newGame();
    for (let i = 0; i < 7; i++) expect(playRound(g, 1)).toMatchObject({ firstTry: false });
    expect(g.tilesLeft).toBe(1);
    expect(playRound(g, 0)).toMatchObject({ firstTry: true, last: true });
    expect(g.hits).toBe(1);
    expect(g.stars).toBe(1);
  });

  it("five hits → 2 stars", () => {
    const g = newGame();
    for (let i = 0; i < 8; i++) playRound(g, i < 3 ? 2 : 0);
    expect(g.hits).toBe(5);
    expect(g.stars).toBe(2);
  });

  it("only the round's first tap counts; later wrong taps are logged but change nothing", () => {
    const g = newGame();
    playRound(g, 2);
    expect(g.firstPickHit[0]).toBe(false);
    expect(g.wrongTaps[0]).toBe(2);
    expect(g.taps).toHaveLength(3);
    expect(g.taps[0]).toMatchObject({ round: 0, target: g.prompts[0], tilesLeft: 8 });
    expect(g.taps[2]).toMatchObject({ kana: g.prompts[0] });
  });

  it("taps while locked are ignored and not counted", () => {
    const g = newGame();
    expect(g.tap(g.target!)).toEqual({ kind: "ignored" }); // still saying the first prompt
    expect(g.taps).toHaveLength(0);
    g.unlock();
    const wrong = g.tiles.find((k) => k !== g.target)!;
    g.tap(wrong);
    g.lock(); // replaying
    expect(g.tap(g.target!)).toEqual({ kind: "ignored" });
    g.unlock();
    expect(g.tap(g.target!)).toMatchObject({ kind: "found", firstTry: false });
    // Found: locked until the next prompt.
    expect(g.tap(g.tiles.find((k) => !g.found.includes(k))!)).toEqual({ kind: "ignored" });
  });

  it("found tiles and unknown kana can't be tapped", () => {
    const g = newGame();
    playRound(g);
    g.unlock();
    expect(g.tap(g.found[0])).toEqual({ kind: "ignored" });
    expect(g.tap("ん")).toEqual({ kind: "ignored" });
    expect(g.wrongTaps[1]).toBe(0);
  });

  it("the third wrong tap turns on the hint, and the round ends only on the right tile", () => {
    const g = newGame();
    g.unlock();
    const wrong = g.tiles.filter((k) => k !== g.target);
    expect(g.tap(wrong[0])).toEqual({ kind: "wrong", wrongs: 1, hint: false });
    expect(g.tap(wrong[1])).toEqual({ kind: "wrong", wrongs: 2, hint: false });
    expect(g.hinting).toBe(false);
    expect(g.tap(wrong[2])).toEqual({ kind: "wrong", wrongs: 3, hint: true });
    expect(g.hinting).toBe(true);
    for (let i = 0; i < 10; i++) g.tap(wrong[i % wrong.length]);
    g.next(); // not found yet: no effect
    expect(g.round).toBe(0);
    g.tap(g.target!);
    g.next();
    expect(g.round).toBe(1);
    expect(g.hinting).toBe(false);
  });

  it("refuses a set that isn't 8 different kana", () => {
    expect(() => new MatchGame([..."かきく"])).toThrow();
    expect(() => new MatchGame([..."かかくけこさしす"])).toThrow();
  });
});

describe("sets", () => {
  it("class sets 1 and 2 pass every rule", () => {
    for (const s of CLASS_SETS) expect(problems(s.kana)).toEqual([]);
  });

  it("catches homophones, repeats, small kana and wrong sizes", () => {
    expect(problems([..."おをかきくけこさ"])).toContain("お and を sound the same");
    expect(problems([..."じぢかきくけこさ"])).toContain("じ and ぢ sound the same");
    expect(problems([..."かかきくけこさし"])).toContain("repeats a kana");
    expect(problems([..."かきくけこさしゃ"]).join()).toMatch(/not a full-size kana|has 7 tiles/);
    expect(problems([..."かきくけこさしっ"])).toContain("っ is not a full-size kana");
    expect(problems([..."かきく"])).toContain("has 3 tiles, not 8");
  });

  it("allows a hard pair the curriculum or the word brings, but not one made by filler", () => {
    const kana = [..."しちかきくけこさ"];
    expect(problems(kana)).toEqual([]);
    expect(problems(kana, ["ち"])).toEqual(["filler makes the hard pair し/ち"]);
    expect(HARD_PAIRS).toHaveLength(5);
    expect(HOMOPHONES.map((p) => p.join("")).sort()).toEqual(["おを", "じぢ", "ずづ"]);
  });
});
