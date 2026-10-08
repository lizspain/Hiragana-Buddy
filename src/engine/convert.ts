// English word/name → hiragana via the curated dictionary (Mode A, tier 1).

import { kataToHira, normaliseEnglish } from "./kana";

export interface DictLike {
  names: Record<string, { hiragana: string; katakana: string; display: string; japanese?: string }>;
  words: Record<string, { hiragana: string; katakana: string; display: string; japanese?: string }>;
}

export interface EnglishResult {
  /** Hiragana for the sound of the word, or null if any part is unknown. */
  hiragana: string | null;
  /** The everyday Japanese word, for single dictionary words that have one (dog → いぬ). */
  japanese?: string;
  /** Parts not found in the dictionary. */
  missing: string[];
}

export function lookupEnglish(input: string, dict: DictLike): EnglishResult {
  const key = normaliseEnglish(input);
  if (!key) return { hiragana: "", missing: [] };
  const whole = dict.names[key] ?? dict.words[key];
  if (whole) return { hiragana: kataToHira(whole.hiragana || whole.katakana), japanese: whole.japanese, missing: [] };
  // "Mary Ann", "Big Dog": look up each part.
  const parts = key.split(/[ \-]+/).filter(Boolean);
  const missing: string[] = [];
  let out = "";
  for (const p of parts) {
    const e = dict.names[p] ?? dict.words[p];
    if (e) out += kataToHira(e.hiragana || e.katakana);
    else missing.push(p);
  }
  return { hiragana: missing.length ? null : out, missing };
}
