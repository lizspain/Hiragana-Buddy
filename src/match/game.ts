// One game of Listen & Match: eight rounds, one per tile. DOM-free; the screen
// drives it and plays the sounds.
//
//   prompt (locked) → await → tap ─ wrong → (replay, locked) → await …
//                                  └ right → found (locked) → next round … → done
//
// Input is locked whenever a kana voice is playing (the screen calls lock() /
// unlock() around every sayKana), and a tap during the lock is ignored and
// not counted. Only a round's first tap decides its first-pick hit.

import { HINT_AFTER_WRONG, TILES_PER_GAME } from "./config";
import { starsFor } from "./scoring";

export interface TapLog {
  round: number;
  /** The kana tapped and the one being asked for. */
  kana: string;
  target: string;
  /** Tiles still on the board when it was tapped. */
  tilesLeft: number;
  /** ms since the game started */
  t: number;
}

export type TapResult =
  | { kind: "ignored" }
  | { kind: "wrong"; wrongs: number; hint: boolean }
  | { kind: "found"; firstTry: boolean; last: boolean };

/** Fisher–Yates with an injectable random source (tests pass a seeded one). */
export function shuffle<T>(xs: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class MatchGame {
  /** Board positions, left to right, top to bottom. */
  readonly tiles: readonly string[];
  /** The order the kana are asked for (shuffled separately from the board). */
  readonly prompts: readonly string[];
  round = 0;
  readonly found: string[] = [];
  readonly firstPickHit: boolean[];
  readonly wrongTaps: number[];
  readonly taps: TapLog[] = [];
  private locked = true;
  private tappedThisRound = false;
  private readonly t0: number;
  private readonly now: () => number;

  constructor(kana: readonly string[], rand: () => number = Math.random, now: () => number = () => performance.now()) {
    if (kana.length !== TILES_PER_GAME || new Set(kana).size !== kana.length) throw new Error(`A game needs ${TILES_PER_GAME} different kana`);
    this.tiles = shuffle(kana, rand);
    this.prompts = shuffle(kana, rand);
    this.firstPickHit = kana.map(() => false);
    this.wrongTaps = kana.map(() => 0);
    this.now = now;
    this.t0 = now();
  }

  get target(): string | undefined {
    return this.done ? undefined : this.prompts[this.round];
  }
  get done(): boolean {
    return this.round >= this.prompts.length;
  }
  get tilesLeft(): number {
    return this.tiles.length - this.found.length;
  }
  get isLocked(): boolean {
    return this.locked || this.done;
  }
  get hits(): number {
    return this.firstPickHit.filter(Boolean).length;
  }
  get stars() {
    return starsFor(this.hits);
  }
  /** Whether the hint glow is on this round. */
  get hinting(): boolean {
    return !this.done && this.wrongTaps[this.round] >= HINT_AFTER_WRONG;
  }

  lock(): void {
    this.locked = true;
  }
  unlock(): void {
    this.locked = false;
  }

  tap(kana: string): TapResult {
    const target = this.target;
    if (this.isLocked || !target || !this.tiles.includes(kana) || this.found.includes(kana)) return { kind: "ignored" };
    this.taps.push({ round: this.round, kana, target, tilesLeft: this.tilesLeft, t: Math.round(this.now() - this.t0) });
    const first = !this.tappedThisRound;
    this.tappedThisRound = true;
    if (kana !== target) {
      const wrongs = ++this.wrongTaps[this.round];
      return { kind: "wrong", wrongs, hint: wrongs >= HINT_AFTER_WRONG };
    }
    this.firstPickHit[this.round] = first;
    this.found.push(kana);
    this.locked = true; // the found kana is said again; the next prompt unlocks
    return { kind: "found", firstTry: first, last: this.found.length === this.tiles.length };
  }

  /** Move to the next round (after the found tile has landed). */
  next(): void {
    if (this.done || !this.found.includes(this.prompts[this.round])) return; // a round ends only on the right tile
    this.round++;
    this.tappedThisRound = false;
    this.locked = true;
  }
}
