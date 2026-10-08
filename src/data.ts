// Loads the resource-pack data. Stroke data and the name dictionary are
// separate chunks (cached by the service worker) so they stay out of the
// first-load JS budget.

import type { GlyphData } from "./engine/matcher";
import { HIDDEN_KANA } from "./engine/kana";
import table from "../data/kana-table.json";

export interface KanaInfo {
  romaji: string;
  group: string;
  small: boolean;
  speak: string;
}

export interface DictEntry {
  display: string;
  katakana: string;
  hiragana: string;
  mora: number;
  glyphs: number;
  japanese?: string;
}

export const charts = table.charts as Record<"basic" | "voiced" | "small", (string | null)[][]>;
const kanaInfo = table.kana as Record<string, KanaInfo>;

let glyphs: Record<string, GlyphData> = {};

export async function loadStrokes(): Promise<void> {
  const mod = await import("../data/kana-strokes.json");
  glyphs = (mod.default as unknown as { kana: Record<string, GlyphData> }).kana;
}

export const glyph = (k: string): GlyphData => glyphs[k];
export const isTeachable = (k: string): boolean => k in glyphs && !HIDDEN_KANA.has(k);
export const info = (k: string): KanaInfo | undefined => kanaInfo[k];
export const romajiOf = (k: string): string | undefined => {
  if (k === "ゎ") return "wa";
  const r = kanaInfo[k]?.romaji;
  return r && !r.startsWith("(") ? r : undefined;
};
/** What the speech engine should say for one glyph. */
export const speakText = (k: string): string => kanaInfo[k]?.speak ?? k;

let dict: Promise<{ names: Record<string, DictEntry>; words: Record<string, DictEntry> }> | null = null;
export function loadDictionary() {
  dict ??= import("../data/en-names-words.json").then((m) => m.default as never);
  return dict;
}
