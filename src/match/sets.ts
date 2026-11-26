// Listen & Match tile sets. Milestone 2 has the two curated class sets; the
// auto-filled path sets and My word sets arrive in milestone 3.

import { HARD_PAIRS, HOMOPHONES, TILES_PER_GAME } from "./config";

export interface KanaSet {
  id: string;
  kind: "class" | "auto" | "word";
  kana: string[];
}

/** From the class's practice cards, in the order the class practises them. */
export const CLASS_SETS: readonly KanaSet[] = [
  { id: "class-1", kind: "class", kana: [..."かてくみきつため"] },
  { id: "class-2", kind: "class", kana: [..."しまうはあこさと"] },
];

const SMALL_OR_MARK = new Set("ゃゅょぁぃぅぇぉゎっー");

const hasPair = (set: Set<string>, pairs: readonly (readonly [string, string])[]) =>
  pairs.filter(([a, b]) => set.has(a) && set.has(b));

/**
 * Why a set can't be played, or [] if it can. `filler` are the kana that were
 * added to make up the set (not curated, not from the child's word): only those
 * may not form a hard pair.
 */
export function problems(kana: string[], filler: Iterable<string> = []): string[] {
  const out: string[] = [];
  const all = new Set(kana);
  if (kana.length !== TILES_PER_GAME) out.push(`has ${kana.length} tiles, not ${TILES_PER_GAME}`);
  if (all.size !== kana.length) out.push("repeats a kana");
  for (const k of kana) if (SMALL_OR_MARK.has(k)) out.push(`${k} is not a full-size kana`);
  for (const [a, b] of hasPair(all, HOMOPHONES)) out.push(`${a} and ${b} sound the same`);
  const fill = new Set(filler);
  for (const [a, b] of hasPair(all, HARD_PAIRS)) if (fill.has(a) || fill.has(b)) out.push(`filler makes the hard pair ${a}/${b}`);
  return out;
}

export const setById = (id: string): KanaSet | undefined => CLASS_SETS.find((s) => s.id === id);
