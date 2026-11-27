import { describe, expect, it } from "vitest";
import { HARD_PAIRS, HOMOPHONES } from "./config";
import type { TapLog } from "./game";
import { addMixUps, addResult, bestStars, currentStone, hasPlayed, MAX_RESULTS, mergeProgress, mergeResults, pathState, topMixUps, type MatchResult } from "./progress";
import { AUTO_SETS, BASIC_KANA, CLASS_SETS, PATH_SETS, problems, wordSet, wordSetId } from "./sets";

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const hasPair = (kana: string[], pairs: readonly (readonly [string, string])[]) => pairs.some(([a, b]) => kana.includes(a) && kana.includes(b));

describe("path sets", () => {
  it("are the class sets, then the four auto-filled stones from the plan", () => {
    expect(PATH_SETS.map((s) => s.id)).toEqual(["class-1", "class-2", "auto-3", "auto-4", "auto-5", "auto-6"]);
    expect(AUTO_SETS.map((s) => s.kana.join(""))).toEqual(["いえおけすせそち", "なにぬねのひふへ", "ほむもやゆよらる", "りれろわんあかさ"]);
  });

  it("auto sets pass every rule, treating every kana as filler", () => {
    for (const s of AUTO_SETS) expect(problems(s.kana, s.kana), s.id).toEqual([]);
  });

  it("together cover every basic kana except を (お's twin)", () => {
    const covered = new Set(PATH_SETS.flatMap((s) => s.kana));
    expect(BASIC_KANA).toHaveLength(46);
    expect(BASIC_KANA.filter((k) => !covered.has(k))).toEqual(["を"]);
    expect(CLASS_SETS).toHaveLength(2);
  });
});

describe("My word sets", () => {
  it("start with the word's kana and pad to 8 with filler that never clashes", () => {
    for (let seed = 1; seed < 200; seed++) {
      const s = wordSet([..."えま"], seeded(seed));
      expect(s.kana.slice(0, 2)).toEqual(["え", "ま"]);
      expect(s.kana).toHaveLength(8);
      expect(problems(s.kana, s.filler)).toEqual([]);
      expect(hasPair(s.kana, HARD_PAIRS)).toBe(false);
      expect(s.filler.every((k) => BASIC_KANA.includes(k))).toBe(true);
    }
  });

  it("skip small kana and ー, and keep a hard pair the word brings", () => {
    const s = wordSet([..."しゃーろっと"], seeded(3));
    expect(s.kana.slice(0, 3)).toEqual(["し", "ろ", "と"]);
    expect(s.id).toBe("word:しゃーろっと");
    expect(s.id).toBe(wordSetId([..."しゃーろっと"]));
    const shichi = wordSet([..."しち"], seeded(4));
    expect(shichi.kana.slice(0, 2)).toEqual(["し", "ち"]);
    expect(problems(shichi.kana, shichi.filler)).toEqual([]);
  });

  it("filler never sounds like a kana in the word", () => {
    for (let seed = 1; seed < 200; seed++) {
      const s = wordSet([..."おじ"], seeded(seed));
      expect(hasPair(s.kana, HOMOPHONES)).toBe(false);
      expect(s.kana).not.toContain("を");
      expect(s.kana).not.toContain("ぢ");
    }
  });

  it("a long word gives only its first 8 different kana and no filler", () => {
    const s = wordSet([..."あいうえおかきくけこ"]);
    expect(s.kana.join("")).toBe("あいうえおかきく");
    expect(s.filler).toEqual([]);
    expect(wordSet([..."ばななばなな"], seeded(1)).kana.slice(0, 2)).toEqual(["ば", "な"]);
  });

  it("drops a homophone twin inside the word itself", () => {
    expect(wordSet([..."おを"], seeded(1)).kana.filter((k) => k === "お" || k === "を")).toEqual(["お"]);
  });
});

const row = (setId: string, stars: 1 | 2 | 3, playedAt: string, profileId = "p1"): MatchResult => ({ profileId, setId, stars, hits: stars * 2, playedAt });

describe("results", () => {
  it("best stars and played, per profile and set", () => {
    const rows = [row("class-1", 1, "2026-11-01"), row("class-1", 3, "2026-11-02"), row("class-1", 2, "2026-11-03"), row("class-2", 2, "2026-11-01", "p2")];
    expect(bestStars(rows, "p1", "class-1")).toBe(3);
    expect(bestStars(rows, "p1", "class-2")).toBe(0);
    expect(bestStars(rows, "p2", "class-2")).toBe(2);
    expect(hasPlayed(rows, "p1", "class-1")).toBe(true);
    expect(hasPlayed(rows, "p1", "auto-3")).toBe(false);
  });

  it("past the cap the oldest rows go, but never a set's best", () => {
    let rows: MatchResult[] = [row("class-1", 3, "2000-01-01T00:00:00Z")];
    for (let i = 0; i < MAX_RESULTS + 10; i++) rows = addResult(rows, row("class-1", 1, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()));
    expect(rows).toHaveLength(MAX_RESULTS);
    expect(bestStars(rows, "p1", "class-1")).toBe(3);
  });

  it("merging a backup is safe to repeat and skips junk", () => {
    const mine = [row("class-1", 2, "2026-11-01")];
    const incoming = [row("class-1", 2, "2026-11-01"), row("class-2", 3, "2026-11-02"), { junk: true }, row("x", 0 as 1, "2026-11-03")];
    const once = mergeResults(mine, incoming);
    expect(once.map((r) => r.setId)).toEqual(["class-1", "class-2"]);
    expect(mergeResults(once, incoming)).toEqual(once);
    expect(mergeResults(mine, undefined)).toBe(mine);
  });
});

const tap = (kana: string, target: string): TapLog => ({ round: 0, kana, target, tilesLeft: 8, t: 0 });

describe("mix-ups", () => {
  it("count each wrong tap against the kana that was asked for", () => {
    let p = addMixUps([], "p1", [tap("ち", "し"), tap("ち", "し"), tap("し", "し"), tap("つ", "す")]);
    p = addMixUps(p, "p1", [tap("し", "ち")]);
    expect(p.find((x) => x.kana === "し")!.mixedUpWith).toEqual({ ち: 2 });
    expect(p.find((x) => x.kana === "ち")!.mixedUpWith).toEqual({ し: 1 });
    // し/ち both ways = 3; す/つ once is below the "most often" bar of 2.
    expect(topMixUps(p, "p1")).toEqual([{ heard: "し", tapped: "ち", count: 3 }]);
    expect(topMixUps(p, "p2")).toEqual([]);
  });

  it("merging keeps the larger count, so restoring twice changes nothing", () => {
    const mine = addMixUps([], "p1", [tap("ち", "し")]);
    const backup = addMixUps([], "p1", [tap("ち", "し"), tap("ち", "し"), tap("め", "ぬ")]);
    const once = mergeProgress(mine, backup);
    expect(once.find((x) => x.kana === "し")!.mixedUpWith).toEqual({ ち: 2 });
    expect(once.find((x) => x.kana === "ぬ")!.mixedUpWith).toEqual({ め: 1 });
    expect(mergeProgress(once, backup)).toEqual(once);
  });
});

describe("the set path", () => {
  const ids = ["class-1", "class-2", "auto-3", "auto-4"];
  const bests = (b: Record<string, 0 | 1 | 2 | 3>) => (id: string) => b[id] ?? 0;

  it("opens only the first stone at the start, with the mascot on it", () => {
    const s = pathState(ids, bests({}));
    expect(s.map((x) => x.open)).toEqual([true, false, false, false]);
    expect(currentStone(s)).toBe(0);
  });

  it("opens the next stone only at 3 stars", () => {
    expect(pathState(ids, bests({ "class-1": 2 })).map((x) => x.open)).toEqual([true, false, false, false]);
    const s = pathState(ids, bests({ "class-1": 3, "class-2": 1 }));
    expect(s.map((x) => x.open)).toEqual([true, true, false, false]);
    expect(currentStone(s)).toBe(1);
  });

  it("the grown-ups switch opens every stone; the mascot still waits at the first unfinished one", () => {
    const s = pathState(ids, bests({ "class-1": 3 }), true);
    expect(s.every((x) => x.open)).toBe(true);
    expect(currentStone(s)).toBe(1);
  });

  it("with every stone at 3 stars the mascot rests on the last", () => {
    const s = pathState(ids, () => 3);
    expect(currentStone(s)).toBe(3);
  });
});
