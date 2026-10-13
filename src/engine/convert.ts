// Word entry → hiragana. One box, no mode switch: each part is looked up in
// the curated English dictionary first, and anything it doesn't know is
// spelled by sound as romaji.

import { kataToHira, normaliseEnglish } from "./kana";

type Entry = { hiragana: string; katakana: string; display: string; japanese?: string };

export interface DictLike {
  names: Record<string, Entry>;
  words: Record<string, Entry>;
}

export interface Converted {
  hiragana: string;
  /** "english" if every part came from the dictionary, else "romaji". */
  source: "english" | "romaji";
  /** The everyday Japanese word, when the whole input is one dictionary word (dog → いぬ). */
  japanese?: string;
  /** Parts spelled by sound because the dictionary didn't know them. */
  bySound: string[];
  /** Latin letters romaji couldn't turn into kana (e.g. the y in "brayden"). */
  leftovers: string;
}

const VOWEL = /[aeiou]/;
/** Second letters that make a valid romaji pair with the consonant before them (sh, ch, ts, ky…). */
const PAIRS = new Set(["sh", "ch", "ts", "ky", "gy", "ny", "hy", "by", "py", "my", "ry", "jy", "dy", "fy", "vy"]);

/**
 * Turn an English-ish spelling into romaji WanaKana can read before spelling by sound.
 * WanaKana reads "l" and "x" as small-kana markers (li → ぃ) and drops what it can't
 * convert, so "wally" became わ and "liz" ぃ. Japanese has no L; names use R
 * (Liz → リズ). Also: a y not before a vowel is the vowel i (lily → riri), and a
 * consonant that ends the word or sits in an English cluster gets a vowel the way
 * loanwords do (brayden → buraiden; t/d take o, as in matto).
 * Plain romaji (shi, tsu, kyou, kitte, n) passes through unchanged.
 */
export function soundSpell(part: string): string {
  let s = part
    .toLowerCase()
    .replace(/ph/g, "f")
    .replace(/th/g, "s") // Ethan → esan (no th in Japanese)
    .replace(/c(?!h)(?=[eiy])/g, "s") // Cecil → sesiru
    .replace(/c(?!h)/g, "k") // Lucas → rukasu
    .replace(/q/g, "k")
    .replace(/x/g, "ks") // WanaKana reads x as its small-kana marker
    .replace(/v/g, "b") // Ava → aba, never ゔ
    .replace(/ll/g, "r")
    .replace(/l/g, "r");
  s = s.replace(/y(?![aeiou])/g, "i");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const next = s[i + 1] ?? "";
    out += c;
    if (!/[a-z]/.test(c) || VOWEL.test(c) || c === "n") continue;
    const ends = next === "" || next === "-";
    const cluster = /[a-z]/.test(next) && !VOWEL.test(next) && next !== c && !PAIRS.has(c + next);
    if (ends || cluster) out += c === "t" || c === "d" ? "o" : "u";
  }
  return out;
}

const lookup = (dict: DictLike, key: string) => dict.names[key] ?? dict.words[key];

export function convertInput(input: string, dict: DictLike, toHiragana: (romaji: string) => string): Converted {
  const key = normaliseEnglish(input);
  const empty: Converted = { hiragana: "", source: "english", bySound: [], leftovers: "" };
  if (!key) return empty;

  const whole = lookup(dict, key);
  if (whole) return { ...empty, hiragana: kataToHira(whole.hiragana || whole.katakana), japanese: whole.japanese };

  // "Mary Ann", "Emma neko": dictionary per part, romaji for the rest.
  let hiragana = "";
  let leftovers = "";
  const bySound: string[] = [];
  for (const part of key.split(" ")) {
    // "mary-ann" is two names; "ra-men" is romaji with a long vowel (らーめん).
    const pieces = part.split("-").filter(Boolean).map((p) => lookup(dict, p));
    if (pieces.length && pieces.every(Boolean)) {
      hiragana += pieces.map((e) => kataToHira(e!.hiragana || e!.katakana)).join("");
      continue;
    }
    bySound.push(part);
    const kana = toHiragana(soundSpell(part));
    hiragana += kana;
    leftovers += kana.replace(/[^a-z]/gi, "");
  }
  return { hiragana, source: bySound.length ? "romaji" : "english", bySound, leftovers };
}
