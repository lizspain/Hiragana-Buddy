// Listen & Match tile sets (docs/LISTEN-MATCH.md "Tile sets").
//
//  - Class sets: curated, from the class's practice cards.
//  - Auto sets: until class sets 3+ are curated, the path goes on with the
//    remaining basic kana (decided 2026-11-25; plans/sound-match.md). They are
//    fixed data, not computed at run time, so a stone never changes under a
//    child's saved stars.
//  - My word sets: a saved word's kana, padded with random basic kana.

import { charts } from "../data";
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

/**
 * The rest of the basic kana in gojūon order, no hard pair inside a set (る
 * and り swap stones to keep る/ろ apart), を left out as お's twin, and the
 * last stone padded with あ か さ from the class sets.
 */
export const AUTO_SETS: readonly KanaSet[] = [
  { id: "auto-3", kind: "auto", kana: [..."いえおけすせそち"] },
  { id: "auto-4", kind: "auto", kana: [..."なにぬねのひふへ"] },
  { id: "auto-5", kind: "auto", kana: [..."ほむもやゆよらる"] },
  { id: "auto-6", kind: "auto", kana: [..."りれろわんあかさ"] },
];

/** The stones along the path, in order. */
export const PATH_SETS: readonly KanaSet[] = [...CLASS_SETS, ...AUTO_SETS];

/** The 46 basic kana (the chart's first page). */
export const BASIC_KANA: readonly string[] = charts.basic.flat().filter((k): k is string => !!k);

const SMALL_OR_MARK = new Set("ゃゅょぁぃぅぇぉゎっー");
const isFullSize = (k: string) => !SMALL_OR_MARK.has(k);

const pairsIn = (set: ReadonlySet<string>, pairs: readonly (readonly [string, string])[]) =>
  pairs.filter(([a, b]) => set.has(a) && set.has(b));

/** Whether `k` sounds the same as, or is a hard pair with, any kana in `set`. */
function clashes(k: string, set: ReadonlySet<string>): boolean {
  return [...HOMOPHONES, ...HARD_PAIRS].some(([a, b]) => (a === k && set.has(b)) || (b === k && set.has(a)));
}

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
  for (const k of kana) if (!isFullSize(k)) out.push(`${k} is not a full-size kana`);
  for (const [a, b] of pairsIn(all, HOMOPHONES)) out.push(`${a} and ${b} sound the same`);
  const fill = new Set(filler);
  for (const [a, b] of pairsIn(all, HARD_PAIRS)) if (fill.has(a) || fill.has(b)) out.push(`filler makes the hard pair ${a}/${b}`);
  return out;
}

export const wordSetId = (kana: readonly string[]) => `word:${kana.join("")}`;

/**
 * A My word set: the word's first 8 different full-size kana (small kana and
 * ー skipped; a homophone twin of one already taken is skipped too), padded
 * with random basic kana that neither sound the same as nor make a hard pair
 * with anything already in the set. Hard pairs inside the word itself stay.
 */
export function wordSet(word: readonly string[], rand: () => number = Math.random): KanaSet & { filler: string[] } {
  const own: string[] = [];
  for (const k of word) {
    if (own.length === TILES_PER_GAME) break;
    if (!isFullSize(k) || own.includes(k)) continue;
    if ([...HOMOPHONES].some(([a, b]) => (a === k && own.includes(b)) || (b === k && own.includes(a)))) continue;
    own.push(k);
  }
  const set = new Set(own);
  const pool = BASIC_KANA.filter((k) => !set.has(k));
  const filler: string[] = [];
  while (set.size < TILES_PER_GAME && pool.length) {
    const k = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    if (clashes(k, set)) continue;
    set.add(k);
    filler.push(k);
  }
  return { id: wordSetId(word), kind: "word", kana: [...own, ...filler], filler };
}

export const pathSetById = (id: string): KanaSet | undefined => PATH_SETS.find((s) => s.id === id);
