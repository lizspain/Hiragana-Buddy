// Pure kana helpers: katakana → hiragana, mora counting, long-vowel expansion,
// and English lookup normalisation. No DOM, no data loading.

export const MAX_MORAE = 14;

/** Small kana that join the kana before them into one mora. っ and ー do not. */
const JOINING_SMALL = new Set("ゃゅょぁぃぅぇぉゎ");

/** Glyphs present in the stroke data but never offered to children. */
export const HIDDEN_KANA = new Set("ゐゑゔゕゖ");

/** Katakana → hiragana by code-point shift (U+30A1–U+30F6 → −0x60). ー and others pass through. */
export function kataToHira(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += c >= 0x30a1 && c <= 0x30f6 ? String.fromCodePoint(c - 0x60) : ch;
  }
  return out;
}

/** Lower-case, trim, collapse internal whitespace. */
export function normaliseEnglish(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

export function moraCount(kana: string[]): number {
  let n = 0;
  kana.forEach((k, i) => {
    if (!(JOINING_SMALL.has(k) && i > 0)) n++;
  });
  return n;
}

/** Keep only the leading glyphs that fit in `max` morae (a joining small kana stays with its partner). */
export function limitMorae(kana: string[], max = MAX_MORAE): string[] {
  const out: string[] = [];
  let n = 0;
  for (let i = 0; i < kana.length; i++) {
    const joins = JOINING_SMALL.has(kana[i]) && i > 0;
    if (!joins) {
      if (n === max) break;
      n++;
    }
    out.push(kana[i]);
  }
  return out;
}

/** Group glyphs into morae, e.g. ["し","ゃ","ー"] → [["し","ゃ"],["ー"]]. */
export function groupMorae(kana: string[]): string[][] {
  const out: string[][] = [];
  kana.forEach((k, i) => {
    if (JOINING_SMALL.has(k) && i > 0) out[out.length - 1].push(k);
    else out.push([k]);
  });
  return out;
}

const VOWEL_KANA: Record<string, string> = { a: "あ", i: "い", u: "う", e: "え", o: "お" };

/**
 * Replace each ー with the vowel kana of the glyph before it (じぇーむず → じぇえむず).
 * `romajiOf` returns the romaji of a glyph (from kana-table.json).
 */
export function expandLongVowel(kana: string[], romajiOf: (k: string) => string | undefined): string[] {
  const out: string[] = [];
  for (const k of kana) {
    if (k === "ー" && out.length) {
      const r = romajiOf(out[out.length - 1]) ?? "";
      const v = r.match(/[aiueo](?=[^aiueo]*$)/)?.[0];
      out.push(v ? VOWEL_KANA[v] : k);
    } else out.push(k);
  }
  return out;
}

/** Split a string of kana into glyphs, keeping only ones we can teach. */
export function toGlyphs(s: string, known: (k: string) => boolean): string[] {
  return [...kataToHira(s)].filter((ch) => known(ch) && !HIDDEN_KANA.has(ch));
}
