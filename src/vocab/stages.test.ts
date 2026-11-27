import { describe, expect, it } from "vitest";
import { buildStages, setKana, validateWords, VOCAB_STAGES, VOCAB_WORDS, type VocabWord } from "./stages";

const word = (over: Partial<VocabWord>): VocabWord => ({
  id: "x",
  kana: ["か"],
  meaning: "x",
  set: 1,
  stage: "1A",
  order: 1,
  senses: [{ picture: "x.svg", clip: "x.mp3" }],
  ...over,
});

describe("the word list", () => {
  it("passes the validator", () => {
    expect(validateWords(VOCAB_WORDS)).toEqual([]);
  });

  it("has four stages of 8 in path order, in worksheet order", () => {
    expect(VOCAB_STAGES.map((s) => s.id)).toEqual(["1A", "1B", "2A", "2B"]);
    expect(VOCAB_STAGES.map((s) => s.words.length)).toEqual([8, 8, 8, 8]);
    expect(VOCAB_STAGES[0].words.map((w) => w.kana.join(""))).toEqual(["て", "き", "め", "か", "くつ", "つき", "かた", "たつ"]);
    expect(VOCAB_STAGES[1].words.map((w) => w.kana.join(""))).toEqual(["みみ", "つみき", "かみ", "かき", "かめ", "みて", "つきみ", "つめ"]);
    expect(VOCAB_STAGES[2].words.map((w) => w.kana.join(""))).toEqual(["は", "あし", "さめ", "うし", "うま", "くま", "うた", "あめ"]);
    expect(VOCAB_STAGES[3].words.map((w) => w.kana.join(""))).toEqual(["うみ", "しか", "とまと", "こま", "はし", "はさみ", "かさ", "した"]);
  });

  it("gives はし two pictures and every other word one: 33 clips in all", () => {
    const hashi = VOCAB_WORDS.find((w) => w.id === "hashi")!;
    expect(hashi.senses.map((s) => s.picture)).toEqual(["hashi-bridge.svg", "hashi-chopsticks.svg"]);
    expect(VOCAB_WORDS.filter((w) => w.id !== "hashi").every((w) => w.senses.length === 1)).toBe(true);
    expect(VOCAB_WORDS.flatMap((w) => w.senses).length).toBe(33);
  });

  it("sets the pitch by hand for the words whose meaning depends on it", () => {
    const accent = (id: string) => VOCAB_WORDS.find((w) => w.id === id)!.senses.map((s) => s.accent);
    expect(accent("hashi")).toEqual([2, 1]); // bridge low-high, chopsticks high-low
    expect(accent("ame")).toEqual([1]); // rain high-low
    expect(accent("kaki")).toEqual([2]); // persimmon low-high
    expect(accent("shita")).toEqual([2]); // down low-high
  });

  it("uses each stage's own class set for the extra tile", () => {
    expect(VOCAB_STAGES.map((s) => s.setKana.join(""))).toEqual(["かてくみきつため", "かてくみきつため", "しまうはあこさと", "しまうはあこさと"]);
  });
});

describe("the validator", () => {
  const stage = (ws: VocabWord[]) => ws.map((w, i) => ({ ...w, id: `${w.id}${i}`, order: i + 1, senses: [{ picture: `${i}.svg`, clip: `${i}.mp3` }] }));
  const eight = (w: Partial<VocabWord>) => stage(Array.from({ length: 8 }, () => word(w)));

  it("wants 8 words per stage", () => {
    expect(validateWords(eight({}).slice(0, 7))).toEqual(["stage 1A: 7 words (8 needed)"]);
  });

  it("wants 1 to 3 kana per word", () => {
    expect(validateWords(eight({ kana: [] }))).toContain("x0: 0 kana (1 to 3 allowed)");
    expect(validateWords(eight({ kana: [..."かかかか"] }))).toContain("x0: 4 kana (1 to 3 allowed)");
  });

  it("allows kana from sets 1..n only", () => {
    expect(validateWords(eight({ kana: ["し"] }))).toContain("x0: し is not in class sets 1 to 1");
    expect(validateWords(eight({ kana: ["く", "ま"], set: 2, stage: "2A" }))).toEqual([]); // set 2 may use set 1 kana
    expect(validateWords(eight({ kana: ["ね"], set: 2, stage: "2A" }))).toContain("x0: ね is not in class sets 1 to 2");
  });

  it("wants full-size, single kana", () => {
    expect(validateWords(eight({ kana: ["きゃ"] }))).toContain('x0: tile "きゃ" is not one kana');
  });

  it("catches repeated ids and files, and a stage in the wrong set", () => {
    const ws = eight({});
    ws[1] = { ...ws[1], id: ws[0].id, senses: ws[0].senses };
    const bad = validateWords(ws);
    expect(bad).toContain("x0: id used twice");
    expect(bad).toContain("x0: file 0.svg used twice");
    expect(validateWords(eight({ stage: "2A" }))).toContain("x0: stage 2A doesn't belong to set 1");
  });

  it("builds stages sorted by id with words in order", () => {
    const ws = eight({}).reverse();
    expect(buildStages(ws)[0].words.map((w) => w.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(setKana(3)).toEqual([]);
  });
});
