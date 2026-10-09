import { readFileSync } from "node:fs";
import { toRomaji } from "wanakana";
import { describe, expect, it } from "vitest";
import type { DictLike } from "./convert";
import { pickHeard } from "./heard";

const dict = JSON.parse(readFileSync(new URL("../../data/en-names-words.json", import.meta.url), "utf8")) as DictLike;
const inDict = (s: string) => s.split(" ").every((p) => p in dict.names || p in dict.words);
const pick = (h: Parameters<typeof pickHeard>[0]) => pickHeard(h, inDict, toRomaji);

describe("pickHeard", () => {
  it("prefers English that is in the name list", () => {
    expect(pick({ en: [{ text: "Emma." }], ja: [{ text: "エマ" }] })).toEqual({ text: "Emma", lang: "en", heard: "Emma" });
  });

  it("uses Japanese kana as romaji when English isn't a known word", () => {
    expect(pick({ en: [{ text: "Necco" }], ja: [{ text: "ねこ" }] })).toEqual({ text: "neko", lang: "ja", heard: "ねこ" });
    expect(pick({ ja: [{ text: "キョウリュウ" }] })?.text).toBe("kyouryuu");
  });

  it("skips Japanese with kanji, falling back to English", () => {
    expect(pick({ en: [{ text: "Neko" }], ja: [{ text: "猫" }] })).toMatchObject({ text: "Neko", lang: "en" });
  });

  it("looks past the first alternative for a kana one", () => {
    expect(pick({ ja: [{ text: "猫" }, { text: "ねこ" }] })?.text).toBe("neko");
  });

  it("returns null when nothing usable was heard", () => {
    expect(pick({ en: [{ text: "  " }], ja: [{ text: "猫" }] })).toBeNull();
    expect(pick({})).toBeNull();
  });
});
