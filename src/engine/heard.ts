// Picks what to type into the word box from what the speech recognisers heard.
// English and Japanese are recognised side by side; the best match wins:
//   4  English that is in the name/word list ("Emma" → えま via the list)
//   3  Japanese heard as kana only ("エマ", "ねこ") → romaji ("ema", "neko")
//   2  any other English ("Brayden"), spelled by sound later
// Japanese with kanji (猫) is skipped: its reading can't be known without a
// large dictionary.

import { normaliseEnglish } from "./kana";

export interface Heard {
  /** Alternatives per language, best first. */
  en?: { text: string; confidence?: number }[];
  ja?: { text: string; confidence?: number }[];
}

export interface Picked {
  /** What goes into the word box. */
  text: string;
  lang: "en" | "ja";
  /** What was actually heard, for the "Heard: …" hint. */
  heard: string;
}

const KANA_ONLY = /^[ぁ-ゖァ-ヺー\s・]+$/;

export function pickHeard(h: Heard, inDictionary: (english: string) => boolean, toRomaji: (kana: string) => string): Picked | null {
  type C = Picked & { score: number };
  const cands: C[] = [];
  for (const [i, alt] of (h.en ?? []).entries()) {
    const text = alt.text.trim().replace(/[.!?,]+$/, "");
    if (!/[a-z]/i.test(text)) continue;
    const known = inDictionary(normaliseEnglish(text));
    cands.push({ text, lang: "en", heard: text, score: (known ? 4 : 2) - i * 0.1 + (alt.confidence ?? 0) * 0.05 });
  }
  for (const [i, alt] of (h.ja ?? []).entries()) {
    const kana = alt.text.replace(/[。、！？!?.\s]+/g, "");
    if (!kana || !KANA_ONLY.test(kana)) continue;
    cands.push({ text: toRomaji(kana), lang: "ja", heard: kana, score: 3 - i * 0.1 + (alt.confidence ?? 0) * 0.05 });
  }
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  return best ? { text: best.text, lang: best.lang, heard: best.heard } : null;
}
