// On-device storage (IndexedDB via idb-keyval). Nothing ever leaves the device.

import { createStore, get, set } from "idb-keyval";
import type { Pt } from "./engine/matcher";

export interface Settings {
  expandLongVowel: boolean;
  skipPhase1WhenMastered: boolean;
  sound: boolean;
  inkColor: string;
  iosTipShown: boolean;
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
}

export interface Session {
  at: string;
  score: number;
  stars: 1 | 2 | 3;
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
  inkColor: "#f28c28",
  iosTipShown: false,
};

const store = createStore("hiragana-buddy", "data");

let settings: Settings = { ...DEFAULT_SETTINGS };
let items: Item[] = [];

export async function loadStore(): Promise<void> {
  try {
    const [s, i] = await Promise.all([get<Partial<Settings>>("settings", store), get<Item[]>("items", store)]);
    settings = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
    items = i ?? [];
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

export const bestStars = (item: Item): number => Math.max(1, ...item.sessions.map((s) => s.stars));

/** A kana counts as mastered after a 3-star phase-3 result in any session. */
export function isMastered(kana: string): boolean {
  return items.some((i) => i.sessions.some((s) => s.perKana.some((p) => p.kana === kana && p.score >= 80)));
}

// ---------- backup ----------

interface Backup {
  app: "hiragana-buddy";
  version: 1;
  exportedAt: string;
  profiles: Profile[];
  items: Item[];
  settings: Settings;
}

export function exportBackup(): string {
  const data: Backup = {
    app: "hiragana-buddy",
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: [{ id: DEFAULT_PROFILE, name: "", inkColor: settings.inkColor, createdAt: items[0]?.createdAt ?? new Date().toISOString() }],
    items,
    settings,
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
  await persistItems();
  return data.items.length;
}
