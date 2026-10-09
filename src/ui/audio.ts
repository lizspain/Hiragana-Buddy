// Voice and sounds. Nothing leaves the device.
//
// Voice: recorded clips first (public/audio/manifest.json maps exact text →
// file), then the browser's speech engine. Many devices (e.g. Windows without
// the Japanese language pack) have no Japanese voice at all, so kana can only
// be heard reliably from clips. Words without their own clip are sounded out
// from mora clips (え・ま).
//
// Sounds: tiny synthesised chimes (Web Audio), no files.

import { allOrderLines, LINES, orderLine, PRAISE, VOWEL_OF, type Line, type LineId } from "../audio-lines";
import { groupMorae } from "../engine/kana";
import { romajiOf, speakText } from "../data";

let enabled = true;
export const setSoundEnabled = (on: boolean) => {
  enabled = on;
  if (!on) stopVoice();
};
export const soundEnabled = () => enabled;

// ---------- audio context ----------

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Call from a user gesture so iOS lets audio play. */
export function unlockAudio(): void {
  const c = audio();
  if (c && c.state === "suspended") void c.resume();
}

// ---------- clips ----------

interface Manifest {
  credit?: string;
  ja: Record<string, string>;
  en: Record<string, string>;
}

let manifest: Manifest = { ja: {}, en: {} };
const buffers = new Map<string, Promise<AudioBuffer | null>>();
const base = new URL("audio/", document.baseURI);

/** Load the clip list (same-origin static file). Missing → speech only. */
export async function loadVoice(): Promise<void> {
  try {
    const r = await fetch(new URL("manifest.json", base));
    if (r.ok && r.headers.get("content-type")?.includes("json")) manifest = { ja: {}, en: {}, ...(await r.json()) };
  } catch {
    /* no clips */
  }
}

export const voiceCredit = () => manifest.credit;
export const clipCount = () => Object.keys(manifest.ja).length + Object.keys(manifest.en).length;

function clipFor(line: Line): string | undefined {
  return manifest[line.lang][line.text];
}

function buffer(file: string): Promise<AudioBuffer | null> {
  let p = buffers.get(file);
  if (!p) {
    p = fetch(new URL(file, base))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((b) => new Promise<AudioBuffer>((res, rej) => audio()!.decodeAudioData(b, res, rej)))
      .catch(() => null);
    buffers.set(file, p);
  }
  return p;
}

let playing: AudioBufferSourceNode[] = [];
/** AudioContext time when the current queue of clips ends. */
let queueEnd = 0;
let generation = 0;

function stopVoice() {
  generation++;
  for (const s of playing) {
    try {
      s.stop();
    } catch {
      /* already stopped */
    }
  }
  playing = [];
  queueEnd = 0;
  synth?.cancel();
}

/** Play clips back to back (null = a short pause). Returns false if any clip is missing. */
async function playClips(files: (string | null)[], interrupt: boolean): Promise<boolean> {
  const c = audio();
  if (!c || files.some((f) => f !== null && !f)) return false;
  if (interrupt) stopVoice();
  const my = generation;
  const bufs = await Promise.all(files.map((f) => (f ? buffer(f) : Promise.resolve(null))));
  if (bufs.some((b, i) => files[i] && !b)) return false;
  if (my !== generation || !enabled) return true; // interrupted while loading
  if (c.state === "suspended") void c.resume();
  let t = Math.max(c.currentTime + 0.02, queueEnd);
  for (const b of bufs) {
    if (!b) {
      t += 0.12; // っ
      continue;
    }
    const src = c.createBufferSource();
    src.buffer = b;
    src.connect(c.destination);
    src.start(t);
    src.onended = () => (playing = playing.filter((s) => s !== src));
    playing.push(src);
    t += b.duration - 0.03; // clips have a little silence at the ends
  }
  queueEnd = t;
  return true;
}

// ---------- speech fallback ----------

const synth: SpeechSynthesis | undefined = typeof speechSynthesis !== "undefined" ? speechSynthesis : undefined;
let voices: SpeechSynthesisVoice[] = [];
const loadVoices = () => (voices = synth?.getVoices() ?? []);
if (synth) {
  loadVoices();
  synth.addEventListener?.("voiceschanged", loadVoices);
}

/** Natural/neural voices sound far friendlier than the old default ones. */
function rank(v: SpeechSynthesisVoice): number {
  const n = v.name.toLowerCase();
  let s = 0;
  if (/natural|neural|enhanced|premium|online/.test(n)) s += 4;
  if (/google|siri/.test(n)) s += 3;
  if (/nanami|kyoko|o-ren|aria|jenny|ava|samantha/.test(n)) s += 2;
  if (/david|mark|zira|ichiro|haruka|ayumi/.test(n)) s -= 1; // older SAPI voices
  if (v.localService) s += 1; // works offline
  return s;
}

function pickVoice(lang: "ja" | "en"): SpeechSynthesisVoice | undefined {
  const want = lang === "ja" ? "ja" : "en";
  const matches = voices.filter((v) => v.lang.toLowerCase().startsWith(want));
  const pref = lang === "en" ? matches.filter((v) => /en[-_]us/i.test(v.lang)) : matches;
  return (pref.length ? pref : matches).sort((a, b) => rank(b) - rank(a))[0];
}

export const hasJapaneseVoice = () => !!pickVoice("ja");

function speak(text: string, lang: "ja" | "en", interrupt: boolean): void {
  if (!synth) return;
  const v = pickVoice(lang);
  // Without a Japanese voice the engine reads kana as silence; don't pretend.
  if (lang === "ja" && !v) return;
  if (interrupt) stopVoice();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === "ja" ? "ja-JP" : "en-US";
  if (v) u.voice = v;
  u.rate = lang === "ja" ? 0.85 : 1;
  u.pitch = 1.2;
  // Chrome can garbage-collect an utterance mid-sentence; keep a reference.
  keep.add(u);
  u.onend = u.onerror = () => keep.delete(u);
  synth.resume();
  synth.speak(u);
}
const keep = new Set<SpeechSynthesisUtterance>();

// ---------- what the app calls ----------

export function sayLine(line: Line, interrupt = true): void {
  if (!enabled) return;
  const f = clipFor(line);
  if (f) void playClips([f], interrupt).then((ok) => ok || speak(line.text, line.lang, interrupt));
  else speak(line.text, line.lang, interrupt);
}

export const line = (id: LineId, interrupt = true) => sayLine(LINES[id], interrupt);
export const sayOrderSlip = (drawn: number, expected: number) => sayLine(orderLine(drawn, expected));

/** One kana's name as shown on a tile ("ちいさい や" for ゃ). */
export function sayKana(k: string, interrupt = true): void {
  sayLine({ text: speakText(k), lang: "ja" }, interrupt);
}

/** A whole word: its own clip, else sounded out from mora clips, else speech. */
export function sayWord(kana: string[], interrupt = true): void {
  if (!enabled || !kana.length) return;
  if (kana.length === 1) return sayKana(kana[0], interrupt);
  const whole = manifest.ja[kana.join("")];
  if (whole) return void playClips([whole], interrupt);
  const files = moraFiles(kana);
  void playClips(files, interrupt).then((ok) => ok || speak(kana.join(""), "ja", interrupt));
}

/** Clip per mora: きゃ as one, っ as a pause, ー as the previous vowel. */
function moraFiles(kana: string[]): (string | null)[] {
  let prevVowel = "";
  return groupMorae(kana).map((g) => {
    const text = g.join("");
    if (text === "っ") return null;
    if (text === "ー") return prevVowel ? manifest.ja[VOWEL_OF[prevVowel]] ?? "" : null;
    const r = g.map((k) => romajiOf(k) ?? "").join("");
    prevVowel = r.match(/[aiueo](?=[^aiueo]*$)/)?.[0] ?? prevVowel;
    return manifest.ja[text] ?? "";
  });
}

/** Fetch a word's clips ahead of time so the first tap plays without delay. */
export function preloadWord(kana: string[]): void {
  const files = [manifest.ja[kana.join("")], ...kana.map((k) => manifest.ja[speakText(k)]), ...moraFiles(kana)];
  for (const f of new Set(files)) if (f) void buffer(f);
}

let lastPraise = -1;
export function praise(): void {
  let i = Math.floor(Math.random() * PRAISE.length);
  if (i === lastPraise) i = (i + 1) % PRAISE.length;
  lastPraise = i;
  sayLine(PRAISE[i], false);
}

/** For the clip-rendering script and the parent screen. */
export const allLines = (): Line[] => [...Object.values(LINES), ...PRAISE, ...allOrderLines()];

// ---------- sounds ----------

function tone(freq: number, start: number, dur: number, gain: number, type: OscillatorType = "sine", endFreq?: number) {
  const c = ctx;
  if (!c) return;
  const t = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// Pentatonic so any chime sounds friendly.
const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];

/** Accepted stroke: a bright two-note chime that climbs with the stroke number. */
export function chime(step = 0): void {
  if (!enabled) return;
  const a = SCALE[step % 5];
  const b = SCALE[(step % 5) + 2];
  tone(a, 0, 0.35, 0.18, "triangle");
  tone(b, 0.08, 0.5, 0.14, "sine");
}

/** Character finished: a little arpeggio. */
export function fanfare(): void {
  if (!enabled) return;
  [0, 2, 4, 5, 7].forEach((n, i) => tone(SCALE[n], i * 0.09, 0.45, 0.15, "triangle"));
}

/** Gentle "boop" for a stroke to try again. Low, soft, never a buzzer. */
export function boop(): void {
  if (!enabled) return;
  tone(440, 0, 0.22, 0.1, "sine", 330);
}

export function pop(): void {
  if (!enabled) return;
  tone(660, 0, 0.12, 0.12, "sine", 990);
}
