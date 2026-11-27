import { describe, expect, it } from "vitest";
import { MAX_RESULTS } from "../match/progress";
import { VocabGame } from "./game";
import { addVocabResult, bestVocabStars, mergeVocabResults, type VocabResult } from "./progress";
import { VOCAB_STAGES } from "./stages";

const row = (stageId: string, stars: 1 | 2 | 3, at: string, cleanWords = stars === 3 ? 8 : stars === 2 ? 5 : 2): VocabResult => ({
  profileId: "p1",
  stageId,
  playedAt: `2026-11-${at}T00:00:00.000Z`,
  cleanWords,
  stars,
});

describe("vocab results", () => {
  it("best stars per stage; a worse replay never lowers it", () => {
    let rows: VocabResult[] = [];
    rows = addVocabResult(rows, row("1A", 3, "20"));
    rows = addVocabResult(rows, row("1A", 1, "21"));
    rows = addVocabResult(rows, row("1B", 2, "21"));
    expect(bestVocabStars(rows, "p1", "1A")).toBe(3);
    expect(bestVocabStars(rows, "p1", "1B")).toBe(2);
    expect(bestVocabStars(rows, "p1", "2A")).toBe(0);
    expect(bestVocabStars(rows, "p2", "1A")).toBe(0);
  });

  it("restoring a backup merges, and restoring it twice changes nothing", () => {
    const mine = [row("1A", 2, "20")];
    const backup = [row("1A", 3, "19"), row("2A", 1, "22"), { junk: true }, row("1A", 2, "20")];
    const once = mergeVocabResults(mine, backup);
    expect(once.map((r) => `${r.stageId}:${r.stars}`)).toEqual(["1A:3", "1A:2", "2A:1"]);
    expect(mergeVocabResults(once, backup)).toEqual(once);
    expect(mergeVocabResults(mine, "not a list")).toBe(mine);
  });

  it("past the cap, old rows go but never a stage's best", () => {
    let rows: VocabResult[] = [row("2B", 3, "01")];
    for (let i = 0; i < MAX_RESULTS + 5; i++) rows = addVocabResult(rows, { ...row("1A", 1, "02"), playedAt: new Date(Date.UTC(2026, 10, 2, 0, 0, i)).toISOString() });
    expect(rows).toHaveLength(MAX_RESULTS);
    expect(bestVocabStars(rows, "p1", "2B")).toBe(3);
  });
});

describe("every stage plays through", () => {
  it.each(VOCAB_STAGES.map((s) => [s.id, s] as const))("stage %s: 8 clean words by taps make 3 stars", (_, stage) => {
    const g = new VocabGame(stage);
    while (!g.done) {
      g.unlock();
      for (let i = 0; i < g.word!.kana.length; i++) {
        const t = g.tiles.find((x) => x.slot === null && x.kana === g.word!.kana[i])!;
        expect(g.tap(t.id).kind).toBe("placed");
      }
      g.next();
    }
    expect(g.cleanWords).toBe(8);
    expect(g.stars).toBe(3);
  });
});
