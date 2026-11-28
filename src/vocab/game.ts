// Look & Write: one game's rules, no DOM (docs/VOCAB-SPELLING-DESIGN.md "How a
// game plays", "Tile rules", "Game logic").
//
// A game is a stage's 8 words in a shuffled order. Each word shows one tile
// per letter (みみ shows two み) plus one extra tile from the stage's own class
// set that is never in the word, shuffled. A tap sends a tile to the leftmost
// empty slot; a drag offers it to the slot it was dropped on. Either way it
// stays only if its kana is that slot's kana, and same-kana tiles are
// interchangeable. A wrong tile counts against the word (never the game); at
// three, the tile for the leftmost empty slot glows. A clean word has no wrong
// tiles. Input is locked while the word is said or the finish plays; a touch
// then is ignored and not counted.

import { HINT_AFTER_WRONG } from "../match/config";
import { shuffle } from "../match/game";
import { starsFor } from "../match/scoring";
import type { VocabStage, VocabWord } from "./stages";

export interface VocabTile {
  /** Stable within a word: the screen's tile buttons carry it. */
  id: number;
  kana: string;
  extra: boolean;
  /** The slot it sits in, or null while it waits below. */
  slot: number | null;
}

export type PlaceResult =
  | { kind: "ignored" }
  | { kind: "wrong"; wrongs: number; hint: boolean }
  | { kind: "placed"; slot: number; wordDone: boolean };

/** The extra tile for a word: from the stage's set kana, never one in the word. */
export function extraKana(word: readonly string[], setKana: readonly string[], rand: () => number = Math.random): string {
  const pool = setKana.filter((k) => !word.includes(k));
  if (!pool.length) throw new Error(`No extra tile for ${word.join("")}: every set kana is in the word`);
  return pool[Math.floor(rand() * pool.length)];
}

/** A word's tiles: one per letter plus the extra, in a shuffled order. */
export function tilesFor(word: readonly string[], setKana: readonly string[], rand: () => number = Math.random): VocabTile[] {
  const kana = [...word, extraKana(word, setKana, rand)];
  return shuffle(
    kana.map((k, i) => ({ k, extra: i === word.length })),
    rand,
  ).map(({ k, extra }, id) => ({ id, kana: k, extra, slot: null }));
}

export class VocabGame {
  readonly stage: VocabStage;
  /** The stage's words in this game's order. */
  readonly words: readonly VocabWord[];
  index = 0;
  tiles: VocabTile[] = [];
  /** Per word in this game's order. */
  readonly wrongTiles: number[];
  private locked = true;
  private readonly rand: () => number;

  constructor(stage: VocabStage, rand: () => number = Math.random) {
    this.stage = stage;
    this.rand = rand;
    this.words = shuffle(stage.words, rand);
    this.wrongTiles = this.words.map(() => 0);
    this.deal();
  }

  get word(): VocabWord | undefined {
    return this.words[this.index];
  }
  get done(): boolean {
    return this.index >= this.words.length;
  }
  get isLocked(): boolean {
    return this.locked || this.done;
  }
  /** What sits in each slot (tile id), left to right. */
  get slots(): (number | null)[] {
    const out: (number | null)[] = this.word ? this.word.kana.map(() => null) : [];
    for (const t of this.tiles) if (t.slot !== null) out[t.slot] = t.id;
    return out;
  }
  get leftmostEmpty(): number {
    return this.slots.indexOf(null);
  }
  get wordDone(): boolean {
    return !!this.word && this.leftmostEmpty < 0;
  }
  /** Clean words so far: finished with no wrong tile. */
  get clean(): boolean[] {
    return this.words.slice(0, this.index).map((_, i) => this.wrongTiles[i] === 0);
  }
  get cleanWords(): number {
    return this.clean.filter(Boolean).length;
  }
  get stars() {
    return starsFor(this.cleanWords);
  }
  /** The tile that glows after the third wrong tile: one that fits the leftmost empty slot. */
  get hintTile(): number | null {
    if (this.done || this.wrongTiles[this.index] < HINT_AFTER_WRONG) return null;
    const slot = this.leftmostEmpty;
    if (slot < 0) return null;
    return this.tiles.find((t) => t.slot === null && t.kana === this.word!.kana[slot])?.id ?? null;
  }

  lock(): void {
    this.locked = true;
  }
  unlock(): void {
    this.locked = false;
  }

  /** A tap: the tile goes to the leftmost empty slot if it fits there. */
  tap(tileId: number): PlaceResult {
    return this.place(tileId, this.leftmostEmpty);
  }

  /** A drag released over a slot. Over no slot at all, the screen just slides it back (call nothing). */
  drop(tileId: number, slot: number): PlaceResult {
    if (this.slots[slot] !== null && this.slots[slot] !== undefined) return { kind: "ignored" }; // a filled slot is not a target
    return this.place(tileId, slot);
  }

  private place(tileId: number, slot: number): PlaceResult {
    const t = this.tiles.find((x) => x.id === tileId);
    if (this.isLocked || !t || t.slot !== null || slot < 0 || slot >= this.word!.kana.length) return { kind: "ignored" };
    if (t.kana !== this.word!.kana[slot]) {
      const wrongs = ++this.wrongTiles[this.index];
      return { kind: "wrong", wrongs, hint: wrongs >= HINT_AFTER_WRONG };
    }
    t.slot = slot;
    const wordDone = this.wordDone;
    if (wordDone) this.locked = true; // the finish plays; the next word unlocks
    return { kind: "placed", slot, wordDone };
  }

  /** On to the next word (after the finish has played). Returns false at the end of the game. */
  next(): boolean {
    if (!this.wordDone) return !this.done;
    this.index++;
    this.locked = true;
    this.deal();
    return !this.done;
  }

  private deal() {
    this.tiles = this.word ? tilesFor(this.word.kana, this.stage.setKana, this.rand) : [];
  }
}
