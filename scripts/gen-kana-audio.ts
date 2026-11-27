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
// Never downloads audio: every clip is synthesized locally by the engine.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clipStats, SPEC } from "../src/dev/clip-stats.ts";
import { LINES } from "../src/audio-lines.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = join(ROOT, "audio-src", "kana");
const OUT_DIR = join(ROOT, "public", "audio", "kana");
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
const SPEED = Number(opt("speed", "0.75"));
const PRE = Number(opt("pre", "0.15"));
const POST = Number(opt("post", "0.15"));
/** RMS of the sounding part, dBFS. Clips that would peak over the ceiling at this level are held lower and flagged. */
const TARGET_DB = Number(opt("target", "-20"));

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
 * Japanese lines spoken in the kana voice, so a recorded voice can replace
 * them in the same session as the kana. File name → text (from the app's own
 * line list).
 */
const LINE_CLIPS: Record<string, string> = { "intro-ja.mp3": LINES.matchIntroJa.text };

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
  accent_phrases: { moras: Mora[] }[];
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
  if (first === 0) warn("sound starts at the very start of the engine's output (clipped?)");
  if (last === rms.length - 1) warn("sound runs to the very end of the engine's output (clipped?)");
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

async function main() {
  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const todo = KANA.filter((k) => !ONLY.size || ONLY.has(k));
  const needSynth = todo.filter((k) => FRESH || ONLY.has(k) || !existsSync(join(RAW_DIR, fileOf(k).replace(".mp3", ".wav"))));
  const warnings = new Map<string, string[]>(KANA.map((k) => [k, []]));

  if (needSynth.length) {
    console.log(`VOICEVOX engine ${await ensureEngine()}`);
    const speaker = await styleId();
    console.log(`${VOICE_NAME} ${STYLE_NAME}: style ${speaker}. speed ${SPEED}, pre ${PRE}s, post ${POST}s`);
    for (const k of needSynth) {
      const wav = await synthesize(k, speaker, (w) => warnings.get(k)!.push(w));
      writeFileSync(join(RAW_DIR, fileOf(k).replace(".mp3", ".wav")), wav);
      process.stdout.write(k);
    }
    process.stdout.write("\n");
  }

  // Lines: rebuilt with --fresh or when missing (not touched by --only).
  const lineTodo = ONLY.size ? [] : Object.entries(LINE_CLIPS);
  for (const [file, text] of lineTodo) {
    const raw = join(RAW_DIR, file.replace(".mp3", ".wav"));
    if (FRESH || !existsSync(raw)) {
      await ensureEngine();
      writeFileSync(raw, await synthesize(text, await styleId(), (w) => console.warn(`${file}: ${w}`), true));
    }
    const { pcm } = processClip(decode(raw), (w) => console.warn(`${file}: ${w}`));
    encodeMp3(pcm, join(OUT_DIR, file));
    const st = clipStats(decode(join(OUT_DIR, file)), RATE);
    console.log(`  ${file}: ${Math.round(st.duration * 1000)} ms, peak ${st.peakDb.toFixed(1)} dBFS, loudness ${st.loudnessDb.toFixed(1)} dBFS`);
  }

  for (const k of todo) {
    const raw = join(RAW_DIR, fileOf(k).replace(".mp3", ".wav"));
    if (!existsSync(raw)) throw new Error(`missing ${raw}`);
    const { pcm } = processClip(decode(raw), (w) => warnings.get(k)!.push(w));
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
  for (const [file, text] of Object.entries(LINE_CLIPS)) if (existsSync(join(OUT_DIR, file))) manifest[text] = file;
  manifest.voice = CREDIT;
  manifest.interim = true;
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  writeFileSync(join(RAW_DIR, "report.json"), JSON.stringify({ speed: SPEED, pre: PRE, post: POST, target: TARGET_DB, rows }, null, 1));

  const ms = (x: number) => String(Math.round(x * 1000)).padStart(4);
  console.log("\nkana  file      sound  dur  lead tail  peak   loud   warnings");
  for (const r of rows)
    console.log(
      `${r.kana}    ${r.file.padEnd(9)} ${ms(r.sound)} ${ms(r.duration)} ${ms(r.lead)} ${ms(r.tail)}  ${r.peakDb.toFixed(1).padStart(5)} ${r.loudnessDb.toFixed(1).padStart(6)}   ${r.warnings.join("; ")}`,
    );
  console.log(`\n${rows.length} clips in public/audio/kana/, median loudness ${med.toFixed(1)} dBFS, ${rows.filter((r) => r.warnings.length).length} with warnings.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
