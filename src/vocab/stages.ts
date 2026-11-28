// Look and Write: the word list and its stages (docs/VOCAB-SPELLING-DESIGN.md
// "Words and stages"). Each class set's 16 words become two stages of 8, in
// worksheet order. The list is checked when the module loads in development
// and by the unit tests.

import raw from "../../data/vocab-words.json";
import { CLASS_SETS } from "../match/sets";

export interface VocabSense {
  /** Only on words with more than one picture (はし): what this picture is. */
  meaning?: string;
  /** File in public/vocab/. */
  picture: string;
  /** File in public/audio/words/. */
  clip: string;
  /** VOICEVOX accent position (1 = high-low; the kana count = low-high), set by hand where pitch decides the meaning. */
  accent?: number;
  pitch?: string;
}

export interface VocabWord {
  id: string;
  kana: string[];
  meaning: string;
  set: number;
  stage: string;
  order: number;
  senses: VocabSense[];
}

export interface VocabStage {
  id: string;
  set: number;
  /** In worksheet order. */
  words: VocabWord[];
  /** The stage's own class-set kana: where the extra tile comes from. */
  setKana: string[];
}

export const WORDS_PER_STAGE = 8;
export const MAX_WORD_KANA = 3;

/** Class set n's kana (1-based), from the same cards Listen & Match uses. */
export const setKana = (n: number): string[] => [...(CLASS_SETS[n - 1]?.kana ?? [])];

/** Every way the list breaks the rules; empty when it's good. */
export function validateWords(words: readonly VocabWord[]): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  const files = new Set<string>();
  const byStage = new Map<string, VocabWord[]>();
  for (const w of words) {
    if (ids.has(w.id)) out.push(`${w.id}: id used twice`);
    ids.add(w.id);
    if (w.kana.length < 1 || w.kana.length > MAX_WORD_KANA) out.push(`${w.id}: ${w.kana.length} kana (1 to ${MAX_WORD_KANA} allowed)`);
    // Sets 1..n: a set 2 word may use set 1 kana, never later ones.
    const allowed = new Set(Array.from({ length: w.set }, (_, i) => setKana(i + 1)).flat());
    for (const k of w.kana) {
      if (k.length !== 1) out.push(`${w.id}: tile "${k}" is not one kana`);
      else if (!allowed.has(k)) out.push(`${w.id}: ${k} is not in class sets 1 to ${w.set}`);
    }
    if (!w.senses.length) out.push(`${w.id}: no picture`);
    if (w.senses.length > 1 && w.senses.some((s) => !s.meaning)) out.push(`${w.id}: each of its pictures needs a meaning`);
    for (const s of w.senses) {
      if (s.accent !== undefined && !(Number.isInteger(s.accent) && s.accent >= 1 && s.accent <= w.kana.length))
        out.push(`${w.id}: accent ${s.accent} is outside 1 to ${w.kana.length}`);
      for (const f of [s.picture, s.clip]) {
        if (files.has(f)) out.push(`${w.id}: file ${f} used twice`);
        files.add(f);
      }
    }
    if (!/^\d[A-Z]$/.test(w.stage) || Number(w.stage[0]) !== w.set) out.push(`${w.id}: stage ${w.stage} doesn't belong to set ${w.set}`);
    byStage.set(w.stage, [...(byStage.get(w.stage) ?? []), w]);
  }
  for (const [stage, ws] of byStage) {
    if (ws.length !== WORDS_PER_STAGE) out.push(`stage ${stage}: ${ws.length} words (${WORDS_PER_STAGE} needed)`);
    const orders = ws.map((w) => w.order).sort((a, b) => a - b);
    if (orders.some((o, i) => o !== i + 1)) out.push(`stage ${stage}: order should run 1 to ${ws.length}, got ${orders}`);
  }
  return out;
}

/** Stages in path order (1A, 1B, 2A, 2B …), each with its words in worksheet order. */
export function buildStages(words: readonly VocabWord[]): VocabStage[] {
  const ids = [...new Set(words.map((w) => w.stage))].sort();
  return ids.map((id) => {
    const ws = words.filter((w) => w.stage === id).sort((a, b) => a.order - b.order);
    return { id, set: ws[0].set, words: ws, setKana: setKana(ws[0].set) };
  });
}

export const VOCAB_WORDS: readonly VocabWord[] = (raw as { words: VocabWord[] }).words;

if (import.meta.env?.DEV) {
  const bad = validateWords(VOCAB_WORDS);
  if (bad.length) console.error("data/vocab-words.json:\n" + bad.join("\n"));
}

export const VOCAB_STAGES: readonly VocabStage[] = buildStages(VOCAB_WORDS);

export const stageById = (id: string): VocabStage | undefined => VOCAB_STAGES.find((s) => s.id === id);
