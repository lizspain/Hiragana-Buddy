// What Listen & Match remembers, as plain data: one row per finished game,
// and per kana which other kana a child tapped when it was asked for. Pure
// functions over arrays; store.ts persists them. Nothing leaves the device.

import type { TapLog } from "./game";

export interface MatchResult {
  profileId: string;
  setId: string;
  /** ISO time the game finished. */
  playedAt: string;
  /** First-pick hits, 0–8 (the last round is always one, so in practice 1–8). */
  hits: number;
  stars: 1 | 2 | 3;
}

export interface KanaProgress {
  profileId: string;
  /** The kana that was asked for. */
  kana: string;
  /** Kana tapped instead of it, with how often. */
  mixedUpWith: Record<string, number>;
}

// ---------- finished games, for any mini game ----------
//
// Listen & Match rows are per set, Look & Write rows per stage: the same
// helpers serve both, given which field names the stone.

/** One finished game. `K` is the field naming its stone (setId, stageId). */
export type GameResult<K extends string> = { profileId: string; playedAt: string; stars: 1 | 2 | 3 } & Record<K, string>;

/** Keep the store small: past this many rows the oldest go, but never a stone's best. */
export const MAX_RESULTS = 2000;

export function addGameResult<K extends string, R extends GameResult<K>>(rows: R[], r: R, key: K): R[] {
  const out = [...rows, r];
  if (out.length <= MAX_RESULTS) return out;
  const keep = new Set(bestRows(out, key));
  const drop = out.filter((x) => !keep.has(x)).sort((a, b) => a.playedAt.localeCompare(b.playedAt));
  const gone = new Set(drop.slice(0, out.length - MAX_RESULTS));
  return out.filter((x) => !gone.has(x));
}

/** The best (then latest) row for each profile + stone. */
function bestRows<K extends string, R extends GameResult<K>>(rows: R[], key: K): R[] {
  const best = new Map<string, R>();
  for (const r of rows) {
    const k = `${r.profileId}|${r[key]}`;
    const b = best.get(k);
    if (!b || r.stars > b.stars || (r.stars === b.stars && r.playedAt > b.playedAt)) best.set(k, r);
  }
  return [...best.values()];
}

/** Best stars on a stone, 0 if never finished. A replay with fewer stars never lowers it. */
export function bestGameStars<K extends string>(rows: readonly GameResult<K>[], key: K, profileId: string, id: string): 0 | 1 | 2 | 3 {
  let best: 0 | 1 | 2 | 3 = 0;
  for (const r of rows) if (r.profileId === profileId && r[key] === id && r.stars > best) best = r.stars;
  return best;
}

/** Restoring must be safe to repeat: the same backup twice changes nothing. */
export function mergeGameResults<K extends string, R extends GameResult<K>>(mine: R[], incoming: unknown, key: K): R[] {
  if (!Array.isArray(incoming)) return mine;
  const seen = new Set(mine.map((r) => `${r.profileId}|${r[key]}|${r.playedAt}`));
  let out = mine;
  for (const r of incoming as R[]) {
    if (!r || typeof r[key] !== "string" || typeof r.playedAt !== "string" || ![1, 2, 3].includes(r.stars)) continue;
    const k = `${r.profileId}|${r[key]}|${r.playedAt}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out = addGameResult(out, r, key);
  }
  return out.sort((a, b) => a.playedAt.localeCompare(b.playedAt));
}

// ---------- Listen & Match ----------

export const addResult = (rows: MatchResult[], r: MatchResult): MatchResult[] => addGameResult(rows, r, "setId");

/** Best stars for a set, 0 if never finished. */
export const bestStars = (rows: MatchResult[], profileId: string, setId: string) => bestGameStars(rows, "setId", profileId, setId);

export const hasPlayed = (rows: MatchResult[], profileId: string, setId: string) =>
  rows.some((r) => r.profileId === profileId && r.setId === setId);

/** Count every wrong tap: the kana tapped while another was asked for. */
export function addMixUps(progress: KanaProgress[], profileId: string, taps: readonly TapLog[]): KanaProgress[] {
  const out = progress.map((p) => ({ ...p, mixedUpWith: { ...p.mixedUpWith } }));
  for (const t of taps) {
    if (t.kana === t.target) continue;
    let p = out.find((x) => x.profileId === profileId && x.kana === t.target);
    if (!p) out.push((p = { profileId, kana: t.target, mixedUpWith: {} }));
    p.mixedUpWith[t.kana] = (p.mixedUpWith[t.kana] ?? 0) + 1;
  }
  return out;
}

export interface MixUp {
  /** Asked for, and what was tapped instead. */
  heard: string;
  tapped: string;
  count: number;
}

/** The sounds a child mixes up most, for the grown-ups view (pairs counted both ways). */
export function topMixUps(progress: KanaProgress[], profileId: string, n = 6): MixUp[] {
  const pairs = new Map<string, MixUp>();
  for (const p of progress) {
    if (p.profileId !== profileId) continue;
    for (const [tapped, count] of Object.entries(p.mixedUpWith)) {
      const [a, b] = [p.kana, tapped].sort();
      const key = a + b;
      const m = pairs.get(key) ?? { heard: p.kana, tapped, count: 0 };
      m.count += count;
      pairs.set(key, m);
    }
  }
  return [...pairs.values()].filter((m) => m.count >= 2).sort((a, b) => b.count - a.count).slice(0, n);
}

// ---------- backup merge ----------
//
// Restoring must be safe to repeat: the same backup twice changes nothing.

export const mergeResults = (mine: MatchResult[], incoming: unknown): MatchResult[] => mergeGameResults(mine, incoming, "setId");

/** Per kana pair, keep the larger count (counts only grow, so this never loses taps). */
export function mergeProgress(mine: KanaProgress[], incoming: unknown): KanaProgress[] {
  if (!Array.isArray(incoming)) return mine;
  const out = mine.map((p) => ({ ...p, mixedUpWith: { ...p.mixedUpWith } }));
  for (const p of incoming as KanaProgress[]) {
    if (!p || typeof p.kana !== "string" || typeof p.mixedUpWith !== "object") continue;
    let q = out.find((x) => x.profileId === p.profileId && x.kana === p.kana);
    if (!q) out.push((q = { profileId: p.profileId, kana: p.kana, mixedUpWith: {} }));
    for (const [k, n] of Object.entries(p.mixedUpWith)) if (typeof n === "number") q.mixedUpWith[k] = Math.max(q.mixedUpWith[k] ?? 0, n);
  }
  return out;
}

// ---------- the set path ----------

/** Best stars a set needs before the next stone opens (decided 2026-11-25). */
export const UNLOCK_STARS = 3;

export interface StoneState {
  id: string;
  best: 0 | 1 | 2 | 3;
  open: boolean;
}

/**
 * Each stone along the path: its best stars and whether it's open. The first
 * is always open; each next one opens when the one before reaches
 * UNLOCK_STARS, or when a grown-up has unlocked the whole path. Opening is
 * one-way: stars are never taken away, so an open stone stays open.
 */
export function pathState(ids: readonly string[], best: (id: string) => 0 | 1 | 2 | 3, unlockAll = false): StoneState[] {
  return ids.map((id, i) => ({ id, best: best(id), open: unlockAll || i === 0 || best(ids[i - 1]) >= UNLOCK_STARS }));
}

/** The stone the mascot stands on: the first open one without full stars (else the last open one). */
export function currentStone(stones: readonly StoneState[]): number {
  const i = stones.findIndex((s) => s.open && s.best < UNLOCK_STARS);
  if (i >= 0) return i;
  for (let j = stones.length - 1; j >= 0; j--) if (stones[j].open) return j;
  return 0;
}
