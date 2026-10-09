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
    const kana = toHiragana(part);
    hiragana += kana;
    leftovers += kana.replace(/[^a-z]/gi, "");
  }
  return { hiragana, source: bySound.length ? "romaji" : "english", bySound, leftovers };
}
