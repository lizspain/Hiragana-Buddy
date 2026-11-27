// On-device storage (IndexedDB via idb-keyval). Nothing ever leaves the device.

import { createStore, get, set } from "idb-keyval";
import type { Pt, Stars } from "./engine/matcher";
import { inkOrDefault } from "./ui/palette";
import type { TapLog } from "./match/game";
import {
  addMixUps,
  addResult,
  bestStars as bestMatchStars,
  hasPlayed,
  mergeProgress,
  mergeResults,
  type KanaProgress,
  type MatchResult,
} from "./match/progress";
import { addVocabResult, bestVocabStars, mergeVocabResults, type VocabResult } from "./vocab/progress";

export interface Settings {
  expandLongVowel: boolean;
  skipPhase1WhenMastered: boolean;
  sound: boolean;
  inkColor: string;
  iosTipShown: boolean;
  /** Grown-ups switch: show Listen & Match on the home screen (until the recorded voice passes review). */
  matchGame: boolean;
  /** Grown-ups switch: every Listen & Match stone open (turning it off closes unearned stones; stars are kept). */
  unlockPath: boolean;
  /** Listen & Match's spoken intro has played (it plays on the very first game only). */
  matchIntroDone: boolean;
  /** Grown-ups switch: show Make a Word on the home screen (while it is being built and reviewed). */
  vocabGame: boolean;
}

export interface Profile {
  id: string;
  name: string;
  inkColor: string;
  createdAt: string;
}

export interface KanaResult {
  kana: string;
  score: number;
  retries: number;
  /** Every stroke was filled in by the app after "Oops" (the child drew none of it). */
  autoTraced?: boolean;
}

export interface Session {
  at: string;
  score: number;
  stars: Stars;
  perKana: KanaResult[];
  /** Per kana: phase-3 strokes, 16 points each, cell units. */
  drawing: Pt[][][];
}

export interface Item {
  id: string;
  profileId: string;
  kind: "word" | "kana";
  input: string;
  mode: "english" | "romaji" | "japanese" | "chart";
  kana: string[];
  createdAt: string;
  lastPracticedAt: string;
  sessions: Session[];
}

export const MAX_SESSIONS = 20;
const DEFAULT_PROFILE = "p1";

export const DEFAULT_SETTINGS: Settings = {
  expandLongVowel: false,
  skipPhase1WhenMastered: true,
  sound: true,
  inkColor: "#d97706",
  iosTipShown: false,
  matchGame: false,
  unlockPath: false,
  matchIntroDone: false,
  vocabGame: false,
};

const store = createStore("hiragana-buddy", "data");

let settings: Settings = { ...DEFAULT_SETTINGS };
let items: Item[] = [];
let matchResults: MatchResult[] = [];
let kanaProgress: KanaProgress[] = [];
let vocabResults: VocabResult[] = [];

export async function loadStore(): Promise<void> {
  try {
    const [s, i, mr, kp, vr] = await Promise.all([
      get<Partial<Settings>>("settings", store),
      get<Item[]>("items", store),
      get<MatchResult[]>("matchResults", store),
      get<KanaProgress[]>("kanaProgress", store),
      get<VocabResult[]>("vocabResults", store),
    ]);
    settings = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
    settings.inkColor = inkOrDefault(settings.inkColor); // older saves used colours no longer offered
    items = i ?? [];
    matchResults = mr ?? [];
    kanaProgress = kp ?? [];
    vocabResults = vr ?? [];
  } catch {
    // Private mode or storage blocked: run with defaults, in memory only.
  }
}

export const getSettings = (): Settings => settings;

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...patch };
  await set("settings", settings, store).catch(() => undefined);
}

/** Newest first. */
export const getItems = (): Item[] => [...items].sort((a, b) => b.lastPracticedAt.localeCompare(a.lastPracticedAt));

const itemId = (kind: Item["kind"], kana: string[]) => `${kind}:${kana.join("")}`;

export function findItem(kind: Item["kind"], kana: string[]): Item | undefined {
  return items.find((i) => i.id === itemId(kind, kana));
}

let persistAsked = false;

export async function recordSession(
  kind: Item["kind"],
  kana: string[],
  input: string,
  mode: Item["mode"],
  session: Session,
): Promise<Item> {
  const id = itemId(kind, kana);
  let item = items.find((i) => i.id === id);
  if (!item) {
    item = { id, profileId: DEFAULT_PROFILE, kind, input, mode, kana, createdAt: session.at, lastPracticedAt: session.at, sessions: [] };
    items.push(item);
  }
  item.input = input || item.input;
  item.lastPracticedAt = session.at;
  item.sessions.push(session);
  if (item.sessions.length > MAX_SESSIONS) item.sessions.splice(0, item.sessions.length - MAX_SESSIONS);
  await persistItems();
  if (!persistAsked) {
    persistAsked = true;
    void navigator.storage?.persist?.().catch(() => false);
  }
  return item;
}

export async function deleteItem(id: string): Promise<void> {
  items = items.filter((i) => i.id !== id);
  await persistItems();
}

async function persistItems() {
  await set("items", items, store).catch(() => undefined);
}

export const bestStars = (item: Item): number => Math.max(0, ...item.sessions.map((s) => s.stars));

/** A kana counts as mastered after a 3-star phase-3 result in any session. */
export function isMastered(kana: string): boolean {
  return items.some((i) => i.sessions.some((s) => s.perKana.some((p) => p.kana === kana && p.score >= 80)));
}

// ---------- Listen & Match ----------

/** v1 has one built-in profile; every match row carries it so siblings can come later. */
export const currentProfile = (): string => DEFAULT_PROFILE;

/** Save a finished game: its result, and which kana were tapped for which. */
export async function recordMatch(setId: string, hits: number, stars: MatchResult["stars"], taps: readonly TapLog[]): Promise<void> {
  const profileId = currentProfile();
  matchResults = addResult(matchResults, { profileId, setId, playedAt: new Date().toISOString(), hits, stars });
  kanaProgress = addMixUps(kanaProgress, profileId, taps);
  await Promise.all([set("matchResults", matchResults, store), set("kanaProgress", kanaProgress, store)]).catch(() => undefined);
  if (!persistAsked) {
    persistAsked = true;
    void navigator.storage?.persist?.().catch(() => false);
  }
}

export const matchBestStars = (setId: string) => bestMatchStars(matchResults, currentProfile(), setId);
export const matchPlayed = (setId: string) => hasPlayed(matchResults, currentProfile(), setId);
export const getMatchResults = (): readonly MatchResult[] => matchResults;
export const getKanaProgress = (): readonly KanaProgress[] => kanaProgress;

/** Grown-ups: forget every Listen & Match game and mix-up for this profile (the path starts over). */
export async function resetMatchProgress(): Promise<void> {
  const p = currentProfile();
  matchResults = matchResults.filter((r) => r.profileId !== p);
  kanaProgress = kanaProgress.filter((r) => r.profileId !== p);
  await Promise.all([set("matchResults", matchResults, store), set("kanaProgress", kanaProgress, store)]).catch(() => undefined);
}

// ---------- Make a Word ----------

/** Save a finished game (a game left unfinished is never saved). */
export async function recordVocab(stageId: string, cleanWords: number, stars: VocabResult["stars"]): Promise<void> {
  vocabResults = addVocabResult(vocabResults, { profileId: currentProfile(), stageId, playedAt: new Date().toISOString(), cleanWords, stars });
  await set("vocabResults", vocabResults, store).catch(() => undefined);
  if (!persistAsked) {
    persistAsked = true;
    void navigator.storage?.persist?.().catch(() => false);
  }
}

export const vocabBestStars = (stageId: string) => bestVocabStars(vocabResults, currentProfile(), stageId);
export const getVocabResults = (): readonly VocabResult[] => vocabResults;

// ---------- backup ----------

interface Backup {
  app: "hiragana-buddy";
  /** 2 added Listen & Match (matchResults, kanaProgress), 3 Make a Word (vocabResults). Older files still restore. */
  version: 1 | 2 | 3;
  exportedAt: string;
  profiles: Profile[];
  items: Item[];
  settings: Settings;
  matchResults?: MatchResult[];
  kanaProgress?: KanaProgress[];
  vocabResults?: VocabResult[];
}

export function exportBackup(): string {
  const data: Backup = {
    app: "hiragana-buddy",
    version: 3,
    exportedAt: new Date().toISOString(),
    profiles: [{ id: DEFAULT_PROFILE, name: "", inkColor: settings.inkColor, createdAt: items[0]?.createdAt ?? new Date().toISOString() }],
    items,
    settings,
    matchResults,
    kanaProgress,
    vocabResults,
  };
  return JSON.stringify(data);
}

/** Merge a backup into what is on the device. Returns the number of items restored. */
export async function importBackup(json: string): Promise<number> {
  const data = JSON.parse(json) as Partial<Backup>;
  if (data.app !== "hiragana-buddy" || !Array.isArray(data.items)) throw new Error("Not a Hiragana Buddy backup");
  for (const incoming of data.items) {
    if (!incoming?.id || !Array.isArray(incoming.sessions)) continue;
    const existing = items.find((i) => i.id === incoming.id);
    if (!existing) {
      items.push(incoming);
      continue;
    }
    const seen = new Set(existing.sessions.map((s) => s.at));
    existing.sessions.push(...incoming.sessions.filter((s) => !seen.has(s.at)));
    existing.sessions.sort((a, b) => a.at.localeCompare(b.at));
    existing.sessions.splice(0, Math.max(0, existing.sessions.length - MAX_SESSIONS));
    if (incoming.lastPracticedAt > existing.lastPracticedAt) existing.lastPracticedAt = incoming.lastPracticedAt;
  }
  if (data.settings) await saveSettings({ ...data.settings, iosTipShown: settings.iosTipShown });
  matchResults = mergeResults(matchResults, data.matchResults);
  kanaProgress = mergeProgress(kanaProgress, data.kanaProgress);
  vocabResults = mergeVocabResults(vocabResults, data.vocabResults);
  await Promise.all([set("matchResults", matchResults, store), set("kanaProgress", kanaProgress, store), set("vocabResults", vocabResults, store)]).catch(() => undefined);
  await persistItems();
  return data.items.length;
}
