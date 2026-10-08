import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lookupEnglish, type DictLike } from "./convert";

const dict = JSON.parse(readFileSync(new URL("../../data/en-names-words.json", import.meta.url), "utf8")) as DictLike;

describe("lookupEnglish", () => {
  it("finds names case-insensitively", () => {
    expect(lookupEnglish("  EMMA ", dict)).toEqual({ hiragana: "えま", japanese: undefined, missing: [] });
    expect(lookupEnglish("Noah", dict).hiragana).toBe("のあ");
  });

  it("offers the Japanese word for words", () => {
    expect(lookupEnglish("dog", dict)).toMatchObject({ hiragana: "どっぐ", japanese: "いぬ" });
  });

  it("joins multi-part names and reports missing parts", () => {
    expect(lookupEnglish("Emma Noah", dict).hiragana).toBe("えまのあ");
    expect(lookupEnglish("Emma Zxqv", dict)).toEqual({ hiragana: null, missing: ["zxqv"] });
  });
});
