import { readFileSync } from "node:fs";
import { toHiragana } from "wanakana";
import { describe, expect, it } from "vitest";
import { convertInput, type DictLike } from "./convert";

const dict = JSON.parse(readFileSync(new URL("../../data/en-names-words.json", import.meta.url), "utf8")) as DictLike;
const convert = (s: string) => convertInput(s, dict, toHiragana);

describe("convertInput", () => {
  it("uses the dictionary for known names and words, case-insensitively", () => {
    expect(convert("  EMMA ")).toMatchObject({ hiragana: "えま", source: "english", bySound: [] });
    expect(convert("Noah").hiragana).toBe("のあ");
  });

  it("offers the Japanese word for dictionary words", () => {
    expect(convert("dog")).toMatchObject({ hiragana: "どっぐ", japanese: "いぬ", source: "english" });
  });

  it("spells unknown input by sound, with no mode switch", () => {
    expect(convert("neko")).toMatchObject({ hiragana: "ねこ", source: "romaji", bySound: ["neko"], leftovers: "" });
    expect(convert("kyouryuu").hiragana).toBe("きょうりゅう");
    expect(convert("ra-men").hiragana).toBe("らーめん");
  });

  it("mixes: dictionary parts plus sound-spelled parts", () => {
    expect(convert("Emma neko")).toMatchObject({ hiragana: "えまねこ", source: "romaji", bySound: ["neko"] });
    expect(convert("Emma Noah")).toMatchObject({ hiragana: "えまのあ", source: "english" });
  });

  it("reports letters that could not become kana", () => {
    expect(convert("Brayden").leftovers).not.toBe("");
  });
});
