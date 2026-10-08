import { describe, expect, it } from "vitest";
import { expandLongVowel, groupMorae, kataToHira, limitMorae, moraCount, normaliseEnglish, toGlyphs } from "./kana";

const romaji: Record<string, string> = { ぇ: "e", じ: "ji", ゃ: "ya", ふ: "fu", ぁ: "a", ら: "ra" };

describe("kana helpers", () => {
  it("shifts katakana to hiragana and keeps ー", () => {
    expect(kataToHira("シャーロット")).toBe("しゃーろっと");
    expect(kataToHira("ドッグ")).toBe("どっぐ");
  });

  it("normalises English input", () => {
    expect(normaliseEnglish("  Mary   ANN ")).toBe("mary ann");
  });

  it("counts morae: small ya/yu/yo/vowels join, っ and ー count", () => {
    expect(moraCount([..."くりすとふぁー"])).toBe(6);
    expect(moraCount([..."しゃーろっと"])).toBe(5);
    expect(moraCount([..."えま"])).toBe(2);
    expect(groupMorae([..."しゃー"])).toEqual([["し", "ゃ"], ["ー"]]);
  });

  it("limits to 14 morae without splitting a joined pair", () => {
    const long = [..."あいうえおかきくけこさしすせしゃ"];
    const cut = limitMorae(long);
    expect(moraCount(cut)).toBe(14);
    expect(cut.at(-1)).toBe("せ");
    expect(limitMorae([..."あいうえおかきくけこさしすしゃ"]).slice(-2)).toEqual(["し", "ゃ"]);
  });

  it("expands ー to the previous vowel", () => {
    expect(expandLongVowel([..."じぇーむ"], (k) => romaji[k])).toEqual([..."じぇえむ"]);
    expect(expandLongVowel([..."ふぁー"], (k) => romaji[k])).toEqual([..."ふぁあ"]);
    expect(expandLongVowel(["ー"], (k) => romaji[k])).toEqual(["ー"]);
  });

  it("filters to known, non-hidden glyphs", () => {
    expect(toGlyphs("らk ゐー", (k) => k === "ら" || k === "ー" || k === "ゐ")).toEqual(["ら", "ー"]);
  });
});
