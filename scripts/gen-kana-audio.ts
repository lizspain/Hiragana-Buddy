// Interim kana clips with VOICEVOX (四国めたん, ノーマル), processed to the
// recording spec in docs/LISTEN-MATCH.md ("Audio refinement"). Dev-time only:
// the engine and ffmpeg live in the git-ignored .voicegen/ folder, raw WAVs in
// the git-ignored audio-src/kana/. Only the finished MP3s and the manifest go
// into public/audio/kana/. A native-speaker recording will replace these
// clips later under the same file names.
//
//   node scripts/gen-kana-audio.ts              # synthesize what's missing, process all
//   node scripts/gen-kana-audio.ts --fresh      # rebuild every clip from scratch
//   node scripts/gen-kana-audio.ts --only し,ち,つ
//   options: --speed 0.75 --pre 0.15 --post 0.15 --target -20 --engine http://127.0.0.1:50021
//
//   node scripts/gen-kana-audio.ts --source recorded --voice "a parent at our school"
//     imports a native speaker's takes from audio-src/recorded/ instead (docs/RECORDING.md):
//     <file>-<take>.wav, picks in takes.json, same processing, same file names.
//     --allow-missing keeps the current clip for any kana not recorded; --out <dir> writes elsewhere.
//
//   node scripts/gen-kana-audio.ts --words     # Make a Word's word clips (data/vocab-words.json)
//     → public/audio/words/, one per picture (はし has two), the pitch set by hand
//     where the list gives an accent. Same processing; --only takes word ids
//     (--only hashi,ame). Default speed for words is 0.85.
//
// Never downloads audio: every clip is synthesized locally or recorded by us.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clipStats, SPEC } from "../src/dev/clip-stats.ts";
import { LINES } from "../src/audio-lines.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = join(ROOT, "audio-src", "kana");
const REC_DIR = join(ROOT, "audio-src", "recorded");
const VOICEGEN = join(ROOT, ".voicegen");

const VOICE_NAME = "四国めたん";
const STYLE_NAME = "ノーマル";
const CREDIT = `VOICEVOX:${VOICE_NAME}`;
const RATE = 48000;
const PAD_S = 0.03; // quiet kept before and after the sound
const FADE_S = 0.012;
const PEAK_CEILING_DB = -1.5; // headroom under the −1 dBFS spec for MP3 overshoot
const MP3_KBPS = 64;

// ---------- options ----------

function opt(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const FRESH = process.argv.includes("--fresh");
const ONLY = new Set(opt("only", "").split(/[,\s]+/).filter(Boolean));
const ENGINE = opt("engine", "http://127.0.0.1:50021");
const SPEED = Number(opt("speed", process.argv.includes("--words") ? "0.85" : "0.75"));
const PRE = Number(opt("pre", "0.15"));
const POST = Number(opt("post", "0.15"));
/** RMS of the sounding part, dBFS. Clips that would peak over the ceiling at this level are held lower and flagged. */
const TARGET_DB = Number(opt("target", "-20"));
const SOURCE = opt("source", "voicevox");
if (SOURCE !== "voicevox" && SOURCE !== "recorded") throw new Error(`--source must be voicevox or recorded, not ${SOURCE}`);
/** The About screen's credit for a recorded voice. */
const VOICE = opt("voice", "");
const ALLOW_MISSING = process.argv.includes("--allow-missing");
const WORDS = process.argv.includes("--words");
const OUT_DIR = resolve(ROOT, opt("out", join("public", "audio", WORDS ? "words" : "kana")));

// ---------- the kana list, from the app's own table ----------

const table = JSON.parse(readFileSync(join(ROOT, "data", "kana-table.json"), "utf8")) as {
  charts: Record<string, (string | null)[][]>;
  kana: Record<string, { romaji: string }>;
};
/** Romaji the table shares with another kana: file names must be unique. */
const FILE_NAME: Record<string, string> = { ぢ: "di", づ: "du", を: "wo" };
const KANA = [...table.charts.basic.flat(), ...table.charts.voiced.flat()].filter((k): k is string => !!k);
const fileOf = (k: string) => `${FILE_NAME[k] ?? table.kana[k].romaji}.mp3`;
{
  const names = KANA.map(fileOf);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (KANA.length !== 71 || dup.length) throw new Error(`Expected 71 kana with unique names; got ${KANA.length}, duplicates ${dup}`);
}

/**
 * Lines spoken in the kana voice, so a recorded voice can replace them in the
 * same session as the kana. File name → line (from the app's own line list).
 * VOICEVOX renders only the Japanese ones; a recording session does both.
 */
const LINE_CLIPS: Record<string, { text: string; lang: string }> = { "intro-ja.mp3": LINES.matchIntroJa, "intro-en.mp3": LINES.matchIntroEn };
/** Kana that sound exactly like another: if not recorded, they use the twin's take. */
const TWIN: Record<string, string> = { ぢ: "じ", づ: "ず", を: "お" };

const toKata = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

// ---------- tools ----------

function findFile(dir: string, name: string, depth = 4): string | null {
  if (!existsSync(dir) || depth < 0) return null;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e.toLowerCase() === name) return p;
    if (statSync(p).isDirectory()) {
      const f = findFile(p, name, depth - 1);
      if (f) return f;
    }
  }
  return null;
}

const FFMPEG = findFile(join(VOICEGEN, "ffmpeg"), "ffmpeg.exe") ?? "ffmpeg";

function ffmpeg(args: string[], input?: Buffer): Buffer {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", ...args], { input, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")}: ${r.stderr?.toString()}`);
  return r.stdout;
}

/** Any audio file → mono 48 kHz float samples. */
function decode(file: string): Float32Array {
  const b = ffmpeg(["-i", file, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"]);
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice();
}

// ---------- engine ----------

async function engineUp(): Promise<string | null> {
  try {
    const r = await fetch(`${ENGINE}/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

async function ensureEngine(): Promise<string> {
  let v = await engineUp();
  if (v) return v;
  const run = findFile(join(VOICEGEN, "voicevox"), "run.exe");
  if (!run) throw new Error(`No VOICEVOX engine at ${ENGINE} and no run.exe under .voicegen/voicevox/. See scripts/voice/README.md.`);
  console.log(`Starting ${run} …`);
  spawn(run, ["--host", "127.0.0.1", "--port", new URL(ENGINE).port || "50021"], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 120 && !v; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    v = await engineUp();
  }
  if (!v) throw new Error("VOICEVOX engine did not start within 2 minutes");
  return v;
}

async function styleId(): Promise<number> {
  const speakers = (await (await fetch(`${ENGINE}/speakers`)).json()) as { name: string; styles: { name: string; id: number }[] }[];
  const s = speakers.find((x) => x.name === VOICE_NAME)?.styles.find((x) => x.name === STYLE_NAME);
  if (!s) throw new Error(`${VOICE_NAME} (${STYLE_NAME}) not found. Speakers: ${speakers.map((x) => x.name).join(", ")}`);
  return s.id;
}

interface Mora {
  text: string;
  consonant: string | null;
  vowel: string;
}
interface Query {
  accent_phrases: { moras: Mora[]; accent: number }[];
  kana: string;
  speedScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  outputSamplingRate: number;
  outputStereo: boolean;
}

/** What each kana should come out as, alone (the letter, not a particle). */
const EXPECT: Record<string, string> = { は: "h a", へ: "h e", を: "o", ぢ: "j i", づ: "z u" };

// Asked for as katakana: alone, hiragana は and へ are read as the particles
// "wa" and "e"; ハ and ヘ have no particle reading.
async function synthesize(k: string, speaker: number, warn: (w: string) => void, sentence = false): Promise<Buffer> {
  const q = (await (await fetch(`${ENGINE}/audio_query?text=${encodeURIComponent(sentence ? k : toKata(k))}&speaker=${speaker}`, { method: "POST" })).json()) as Query;
  if (sentence) console.log(`  ${k} → ${q.kana}`);
  const moras = sentence ? [] : q.accent_phrases.flatMap((p) => p.moras);
  const said = moras.map((m) => [m.consonant, m.vowel].filter(Boolean).join(" ")).join(" | ");
  if (sentence) {
    /* a whole line: no single-mora checks */
  } else if (moras.length !== 1) warn(`engine read it as ${moras.length} morae: ${said} (kana ${q.kana})`);
  else if (EXPECT[k] && said !== EXPECT[k]) warn(`engine says "${said}", expected "${EXPECT[k]}"`);
  else if (!EXPECT[k] && moras[0].text !== toKata(k)) warn(`engine mora ${moras[0].text} (${said}) for ${k}`);
  Object.assign(q, { speedScale: SPEED, prePhonemeLength: PRE, postPhonemeLength: POST, outputSamplingRate: RATE, outputStereo: false });
  const r = await fetch(`${ENGINE}/synthesis?speaker=${speaker}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q) });
  if (!r.ok) throw new Error(`synthesis ${k}: ${r.status} ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

// ---------- processing ----------

const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

/** The sound's body: windows within this many dB of the clip's peak (as the review page measures it). */
const BODY_DB = -24;
/** Soft edges kept around the body (fricative onsets, a nasal's tail) down to this level … */
const EDGE_DB = -32;
/** … but no further than this. Past it is the engine's inhale or trailing breath, which the spec cuts. */
const MAX_LEAD_S = 0.15;
const MAX_TAIL_S = 0.06;

/**
 * Cut the sound out of the engine's output, fade its edges, put exactly
 * PAD_S of silence each side, then set its loudness.
 */
function processClip(d: Float32Array, warn: (w: string) => void): { pcm: Float32Array; gainDb: number } {
  const w = Math.floor(RATE * 0.005);
  const rms: number[] = [];
  let peak = 0;
  for (let i = 0; i + w <= d.length; i += w) {
    let s = 0;
    for (let j = i; j < i + w; j++) {
      s += d[j] * d[j];
      peak = Math.max(peak, Math.abs(d[j]));
    }
    rms.push(Math.sqrt(s / w));
  }
  const body = peak * 10 ** (BODY_DB / 20);
  const edge = peak * 10 ** (EDGE_DB / 20);
  let first = rms.findIndex((v) => v > body);
  let last = rms.length - 1 - [...rms].reverse().findIndex((v) => v > body);
  if (first < 0) throw new Error("no sound in the engine's output");
  if (first === 0) warn("sound starts at the very start of the input (clipped?)");
  if (last === rms.length - 1) warn("sound runs to the very end of the input (clipped?)");
  const maxLead = Math.round(MAX_LEAD_S / 0.005);
  const maxTail = Math.round(MAX_TAIL_S / 0.005);
  for (let n = 0; first > 0 && rms[first - 1] > edge && n < maxLead; n++) first--;
  for (let n = 0; last < rms.length - 1 && rms[last + 1] > edge && n < maxTail; n++) last++;

  const sound = d.slice(first * w, (last + 1) * w);
  const fade = Math.round(FADE_S * RATE);
  for (let i = 0; i < fade && i < sound.length; i++) {
    sound[i] *= i / fade;
    sound[sound.length - 1 - i] *= i / fade;
  }
  const pad = Math.round(PAD_S * RATE);
  const pcm = new Float32Array(pad + sound.length + pad);
  pcm.set(sound, pad);

  const st = clipStats(pcm, RATE);
  let gainDb = TARGET_DB - st.loudnessDb;
  const ceiling = PEAK_CEILING_DB - st.peakDb;
  if (gainDb > ceiling) {
    warn(`held ${(gainDb - ceiling).toFixed(1)} dB under the loudness target to keep peaks ≤ ${PEAK_CEILING_DB} dBFS`);
    gainDb = ceiling;
  }
  const g = 10 ** (gainDb / 20);
  for (let i = 0; i < pcm.length; i++) pcm[i] *= g;
  return { pcm, gainDb };
}

function encodeMp3(pcm: Float32Array, out: string) {
  const buf = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  ffmpeg(["-y", "-f", "f32le", "-ar", String(RATE), "-ac", "1", "-i", "-", "-c:a", "libmp3lame", "-b:a", `${MP3_KBPS}k`, "-ar", String(RATE), out], buf);
}

// ---------- Make a Word: word clips ----------

interface VocabSense {
  meaning?: string;
  clip: string;
  accent?: number;
  pitch?: string;
}
interface VocabWord {
  id: string;
  kana: string[];
  meaning: string;
  senses: VocabSense[];
}

/** Low/high per mora for a VOICEVOX accent position (1..n), the word said alone (Tokyo pattern). */
function pitchOf(n: number, accent: number): string {
  return Array.from({ length: n }, (_, i) => {
    if (accent === 1) return i === 0 ? "H" : "L";
    if (n === 1) return "H";
    if (i === 0) return "L";
    return i < accent ? "H" : "L";
  }).join("");
}

/** One word, one picture: the whole word as one accent phrase, its accent set by hand when given. */
async function synthesizeWord(w: VocabWord, sense: VocabSense, speaker: number, warn: (m: string) => void): Promise<{ wav: Buffer; accent: number }> {
  const text = toKata(w.kana.join(""));
  const q = (await (await fetch(`${ENGINE}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`, { method: "POST" })).json()) as Query;
  if (q.accent_phrases.length !== 1) {
    // One phrase, so the hand-set accent covers the whole word.
    warn(`engine split it into ${q.accent_phrases.length} phrases (${q.kana}); merged`);
    q.accent_phrases = [{ ...q.accent_phrases[0], moras: q.accent_phrases.flatMap((p) => p.moras) }];
  }
  const phrase = q.accent_phrases[0];
  const said = phrase.moras.map((m) => m.text).join("");
  if (said !== text) warn(`engine reads it as ${said}, expected ${text}`);
  if (w.kana[0] === "は" && phrase.moras[0].consonant !== "h") warn(`は read as "${phrase.moras[0].consonant ?? ""}${phrase.moras[0].vowel}", not "ha"`);
  if (sense.accent !== undefined) {
    if (sense.accent < 1 || sense.accent > phrase.moras.length) throw new Error(`${w.id}: accent ${sense.accent} is outside 1..${phrase.moras.length}`);
    phrase.accent = sense.accent;
    // The engine voices the pitch stored on each mora: work it out again for the new accent.
    const m = await fetch(`${ENGINE}/mora_data?speaker=${speaker}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q.accent_phrases) });
    if (!m.ok) throw new Error(`mora_data ${w.id}: ${m.status} ${await m.text()}`);
    q.accent_phrases = (await m.json()) as Query["accent_phrases"];
  }
  Object.assign(q, { speedScale: SPEED, prePhonemeLength: PRE, postPhonemeLength: POST, outputSamplingRate: RATE, outputStereo: false });
  const r = await fetch(`${ENGINE}/synthesis?speaker=${speaker}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q) });
  if (!r.ok) throw new Error(`synthesis ${w.id}: ${r.status} ${await r.text()}`);
  return { wav: Buffer.from(await r.arrayBuffer()), accent: q.accent_phrases[0].accent };
}

async function wordsMain() {
  const words = (JSON.parse(readFileSync(join(ROOT, "data", "vocab-words.json"), "utf8")) as { words: VocabWord[] }).words;
  const rawDir = join(ROOT, "audio-src", "words");
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const raw = (clip: string) => join(rawDir, clip.replace(".mp3", ".wav"));
  const accentFile = join(rawDir, "accents.json");
  const accents: Record<string, number> = existsSync(accentFile) ? JSON.parse(readFileSync(accentFile, "utf8")) : {};
  const warnings = new Map<string, string[]>();
  let speaker = -1;
  for (const w of words.filter((x) => !ONLY.size || ONLY.has(x.id))) {
    for (const s of w.senses) {
      const warn = (m: string) => warnings.set(s.clip, [...(warnings.get(s.clip) ?? []), m]);
      if (FRESH || ONLY.size || !existsSync(raw(s.clip))) {
        if (speaker < 0) {
          console.log(`VOICEVOX engine ${await ensureEngine()}`);
          speaker = await styleId();
          console.log(`${VOICE_NAME} ${STYLE_NAME}: style ${speaker}. speed ${SPEED}, pre ${PRE}s, post ${POST}s`);
        }
        const { wav, accent } = await synthesizeWord(w, s, speaker, warn);
        writeFileSync(raw(s.clip), wav);
        accents[s.clip] = accent;
        process.stdout.write(w.kana.join("") + " ");
      }
      const { pcm } = processClip(decode(raw(s.clip)), warn);
      encodeMp3(pcm, join(OUT_DIR, s.clip));
    }
  }
  process.stdout.write("\n");
  writeFileSync(accentFile, JSON.stringify(accents, null, 1));

  // What ships, measured from the MP3s; loudness against the kana clips' median.
  const kanaRows = (JSON.parse(readFileSync(join(RAW_DIR, "report.json"), "utf8")) as { rows: Row[] }).rows;
  const kanaMed = kanaRows.map((r) => r.loudnessDb).sort((a, b) => a - b)[kanaRows.length >> 1];
  const manifest: Record<string, string | boolean> = {};
  const rows: (Row & { id: string; meaning: string; pitch: string; handSet: boolean })[] = [];
  for (const w of words)
    for (const s of w.senses) {
      const out = join(OUT_DIR, s.clip);
      if (!existsSync(out)) continue;
      manifest[s.clip.replace(".mp3", "")] = s.clip;
      const st = clipStats(decode(out), RATE);
      const ws = warnings.get(s.clip) ?? [];
      if (st.peakDb > SPEC.maxPeakDb) ws.push(`peaks at ${st.peakDb.toFixed(1)} dBFS`);
      if (Math.abs(st.loudnessDb - kanaMed) > SPEC.loudnessSpreadDb) ws.push(`${(st.loudnessDb - kanaMed).toFixed(1)} dB from the kana clips' median`);
      const accent = accents[s.clip];
      rows.push({ kana: w.kana.join(""), file: s.clip, id: w.id, meaning: s.meaning ?? w.meaning, pitch: accent === undefined ? "?" : pitchOf(w.kana.length, accent), handSet: s.accent !== undefined, ...st, warnings: ws });
    }
  manifest.voice = CREDIT;
  manifest.interim = true;
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  writeFileSync(join(rawDir, "report.json"), JSON.stringify({ voice: CREDIT, speed: SPEED, pre: PRE, post: POST, target: TARGET_DB, kanaMedian: kanaMed, rows }, null, 1));
  // For the review page: the pitch each clip was made with.
  writeFileSync(join(OUT_DIR, "pitch.json"), JSON.stringify(Object.fromEntries(rows.map((r) => [r.file, { pitch: r.pitch, handSet: r.handSet }])), null, 1) + "\n");

  const ms = (x: number) => String(Math.round(x * 1000)).padStart(4);
  console.log("\nword  file                   pitch  sound  dur  peak   loud   warnings");
  for (const r of rows)
    console.log(`${r.kana.padEnd(3, "　")}  ${r.file.padEnd(22)} ${(r.pitch + (r.handSet ? "*" : "")).padEnd(5)} ${ms(r.sound)} ${ms(r.duration)}  ${r.peakDb.toFixed(1).padStart(5)} ${r.loudnessDb.toFixed(1).padStart(6)}   ${r.warnings.join("; ")}`);
  console.log(`\n${rows.length} clips in ${OUT_DIR} (* = pitch set by hand), kana median loudness ${kanaMed.toFixed(1)} dBFS.`);
}

// ---------- main ----------

interface Row {
  kana: string;
  file: string;
  duration: number;
  sound: number;
  lead: number;
  tail: number;
  peakDb: number;
  loudnessDb: number;
  warnings: string[];
}

/** Where each kana's and line's unprocessed audio comes from. */
interface Sources {
  kana: Map<string, string>;
  lines: Map<string, string>;
}

async function fromVoicevox(warnings: Map<string, string[]>): Promise<Sources> {
  mkdirSync(RAW_DIR, { recursive: true });
  const todo = KANA.filter((k) => !ONLY.size || ONLY.has(k));
  const raw = (k: string) => join(RAW_DIR, fileOf(k).replace(".mp3", ".wav"));
  const needSynth = todo.filter((k) => FRESH || ONLY.has(k) || !existsSync(raw(k)));
  if (needSynth.length) {
    console.log(`VOICEVOX engine ${await ensureEngine()}`);
    const speaker = await styleId();
    console.log(`${VOICE_NAME} ${STYLE_NAME}: style ${speaker}. speed ${SPEED}, pre ${PRE}s, post ${POST}s`);
    for (const k of needSynth) {
      writeFileSync(raw(k), await synthesize(k, speaker, (w) => warnings.get(k)!.push(w)));
      process.stdout.write(k);
    }
    process.stdout.write("\n");
  }
  const lines = new Map<string, string>();
  // Japanese lines: rebuilt with --fresh or when missing (not touched by --only).
  for (const [file, line] of ONLY.size ? [] : Object.entries(LINE_CLIPS)) {
    if (line.lang !== "ja") continue;
    const r = join(RAW_DIR, file.replace(".mp3", ".wav"));
    if (FRESH || !existsSync(r)) {
      await ensureEngine();
      writeFileSync(r, await synthesize(line.text, await styleId(), (w) => console.warn(`${file}: ${w}`), true));
    }
    lines.set(file, r);
  }
  return { kana: new Map(todo.map((k) => [k, raw(k)])), lines };
}

/** A take on disk: <name>-<take>.<ext>, or <name>.<ext> for a single take. */
function findTake(name: string, take: number): string | null {
  if (!existsSync(REC_DIR)) return null;
  const files = readdirSync(REC_DIR);
  const pick = (stem: string) => files.find((f) => f.slice(0, f.lastIndexOf(".")) === stem && /\.(wav|flac|m4a|mp3|ogg|aiff?)$/i.test(f));
  const f = pick(`${name}-${take}`) ?? (take === 1 ? pick(name) : undefined);
  return f ? join(REC_DIR, f) : null;
}

function fromRecordings(warnings: Map<string, string[]>): Sources {
  if (!VOICE) throw new Error('Pass the credit for the About screen: --voice "a parent at our school"');
  const takesFile = join(REC_DIR, "takes.json");
  const takes = existsSync(takesFile) ? (JSON.parse(readFileSync(takesFile, "utf8")) as Record<string, number>) : {};
  const base = (k: string) => fileOf(k).replace(".mp3", "");
  const kana = new Map<string, string>();
  const missing: string[] = [];
  for (const k of KANA.filter((k) => !ONLY.size || ONLY.has(k))) {
    let f = findTake(base(k), takes[base(k)] ?? 1);
    if (!f && TWIN[k]) {
      f = findTake(base(TWIN[k]), takes[base(TWIN[k])] ?? 1);
      if (f) warnings.get(k)!.push(`no own take: uses ${TWIN[k]}'s`);
    }
    if (f) kana.set(k, f);
    else missing.push(`${k} (${base(k)})`);
  }
  const lines = new Map<string, string>();
  for (const file of ONLY.size ? [] : Object.keys(LINE_CLIPS)) {
    const name = file.replace(".mp3", "");
    const f = findTake(name, takes[name] ?? 1);
    if (f) lines.set(file, f);
    else missing.push(name);
  }
  if (missing.length) {
    const msg = `No recording for: ${missing.join(", ")} (looked in audio-src/recorded/)`;
    if (!ALLOW_MISSING) throw new Error(`${msg}. Nothing was changed. Add --allow-missing to keep their current clips.`);
    console.warn(`${msg}. Keeping their current clips.`);
  }
  console.log(`Importing ${kana.size} kana and ${lines.size} lines recorded by ${VOICE}.`);
  return { kana, lines };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const warnings = new Map<string, string[]>(KANA.map((k) => [k, []]));
  const src = SOURCE === "recorded" ? fromRecordings(warnings) : await fromVoicevox(warnings);

  for (const [file, input] of src.lines) {
    const { pcm } = processClip(decode(input), (w) => console.warn(`${file}: ${w}`));
    encodeMp3(pcm, join(OUT_DIR, file));
    const st = clipStats(decode(join(OUT_DIR, file)), RATE);
    console.log(`  ${file}: ${Math.round(st.duration * 1000)} ms, peak ${st.peakDb.toFixed(1)} dBFS, loudness ${st.loudnessDb.toFixed(1)} dBFS`);
  }
  for (const [k, input] of src.kana) {
    const { pcm } = processClip(decode(input), (w) => warnings.get(k)!.push(w));
    encodeMp3(pcm, join(OUT_DIR, fileOf(k)));
  }

  // Measure what ships (decoded back from the MP3s), against the spec.
  const rows: Row[] = KANA.filter((k) => existsSync(join(OUT_DIR, fileOf(k)))).map((k) => {
    const st = clipStats(decode(join(OUT_DIR, fileOf(k))), RATE);
    const w = warnings.get(k)!;
    if (st.sound < SPEC.sound[0] || st.sound > SPEC.sound[1]) w.push(`sound ${Math.round(st.sound * 1000)} ms, outside ${SPEC.sound.join("–")} s`);
    if (st.peakDb > SPEC.maxPeakDb) w.push(`peaks at ${st.peakDb.toFixed(1)} dBFS`);
    return { kana: k, file: fileOf(k), ...st, warnings: w };
  });
  const loud = rows.map((r) => r.loudnessDb).sort((a, b) => a - b);
  const med = loud[loud.length >> 1];
  for (const r of rows) if (Math.abs(r.loudnessDb - med) > SPEC.loudnessSpreadDb) r.warnings.push(`${(r.loudnessDb - med).toFixed(1)} dB from the median loudness`);

  const manifest: Record<string, string | boolean> = {};
  for (const k of KANA) if (existsSync(join(OUT_DIR, fileOf(k)))) manifest[k] = fileOf(k);
  for (const [file, line] of Object.entries(LINE_CLIPS)) if (existsSync(join(OUT_DIR, file))) manifest[line.text] = file;
  manifest.voice = SOURCE === "recorded" ? VOICE : CREDIT;
  manifest.interim = SOURCE !== "recorded";
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(join(RAW_DIR, "report.json"), JSON.stringify({ source: SOURCE, voice: manifest.voice, speed: SPEED, pre: PRE, post: POST, target: TARGET_DB, rows }, null, 1));

  const ms = (x: number) => String(Math.round(x * 1000)).padStart(4);
  console.log("\nkana  file      sound  dur  lead tail  peak   loud   warnings");
  for (const r of rows)
    console.log(
      `${r.kana}    ${r.file.padEnd(9)} ${ms(r.sound)} ${ms(r.duration)} ${ms(r.lead)} ${ms(r.tail)}  ${r.peakDb.toFixed(1).padStart(5)} ${r.loudnessDb.toFixed(1).padStart(6)}   ${r.warnings.join("; ")}`,
    );
  console.log(`\n${rows.length} clips in ${OUT_DIR}, median loudness ${med.toFixed(1)} dBFS, ${rows.filter((r) => r.warnings.length).length} with warnings.`);
}

(WORDS ? wordsMain() : main()).catch((e) => {
  console.error(e);
  process.exit(1);
});
