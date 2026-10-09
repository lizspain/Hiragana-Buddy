// Lists every Japanese line the app can say, for render_clips.py.
// Uses the app's own sources so the list can't drift: node scripts/voice/lines.mjs
// Writes .voicegen/ja-lines.json: [{ text, kind }]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PRAISE } from "../../src/audio-lines.ts";
import { groupMorae, HIDDEN_KANA, kataToHira } from "../../src/engine/kana.ts";

const root = new URL("../../", import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const table = read("data/kana-table.json");
const strokes = read("data/kana-strokes.json").kana;
const dict = read("data/en-names-words.json");

const lines = new Map(); // text → kind
const add = (text, kind) => text && !lines.has(text) && lines.set(text, kind);

// 1. Tile names: what a kana says when tapped (あ, ちいさい や, のばす ぼう).
for (const [k, info] of Object.entries(table.kana)) add(info.speak, "tile");

// 2. Morae used to sound out any word: plain kana, small-kana combos.
const teachable = Object.keys(strokes).filter((k) => !HIDDEN_KANA.has(k) && k !== "ー");
for (const k of teachable) if (!table.kana[k]?.small) add(k, "mora");
const youonBase = "きぎしじちぢにひびぴみり";
for (const b of youonBase) for (const s of "ゃゅょ") add(b + s, "mora");
const extra = "ふぁ ふぃ ふぇ ふぉ ふゅ てぃ でぃ とぅ どぅ てゅ でゅ うぃ うぇ うぉ いぇ しぇ じぇ ちぇ つぁ つぃ つぇ つぉ くぁ ぐぁ";
for (const m of extra.split(" ")) add(m, "mora");

// 3. Whole dictionary words (names, words and their Japanese words), plus any morae they use.
const words = [...Object.values(dict.names), ...Object.values(dict.words)];
for (const w of words) {
  for (const s of [kataToHira(w.hiragana || w.katakana), w.japanese].filter(Boolean)) {
    add(s, "word");
    for (const g of groupMorae([...s])) if (g.length > 1 || !"っー".includes(g[0])) add(g.join(""), "mora");
  }
}

// 4. Japanese praise.
for (const p of PRAISE) if (p.lang === "ja") add(p.text, "praise");

const out = [...lines].map(([text, kind]) => ({ text, kind }));
mkdirSync(new URL(".voicegen/", root), { recursive: true });
writeFileSync(new URL(".voicegen/ja-lines.json", root), JSON.stringify(out, null, 1));
const count = (k) => out.filter((l) => l.kind === k).length;
console.log(`${out.length} lines: ${count("tile")} tile, ${count("mora")} mora, ${count("word")} word, ${count("praise")} praise`);
