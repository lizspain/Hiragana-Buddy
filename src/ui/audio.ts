// Voice and sounds. Nothing leaves the device.
//
// Voice: recorded clips first (public/audio/manifest.json maps exact text →
// file), then the browser's speech engine. Many devices (e.g. Windows without
// the Japanese language pack) have no Japanese voice at all, so kana can only
// be heard reliably from clips. Words without their own clip are sounded out
// from mora clips (え・ま).
//
// Sounds: tiny synthesised chimes (Web Audio), no files.

import { allOrderLines, LINES, orderLine, PRAISE, soundOf, VOWEL_OF, type Line, type LineId } from "../audio-lines";
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

/**
 * Create the audio context (and fetch the praise clips) while the app is idle
 * after loading, so the first tap doesn't pay for it (about 190 ms on one frame at 4× CPU throttling). It
 * starts suspended, which browsers allow without a gesture; unlockAudio()
 * resumes it on the first tap.
 */
export function primeAudio(): void {
  const go = () => {
    audio();
    // The Japanese praise clips play at the end of every game but aren't
    // precached; loading them now puts them in the service worker's cache on
    // the first visit, so the cheer isn't silent offline.
    for (const p of PRAISE) {
      const f = clipFor(p);
      if (f) void buffer(f);
    }
  };
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(go, { timeout: 2000 });
  else setTimeout(go, 500);
}

/** Call from a user gesture so iOS lets audio play. */
export function unlockAudio(): void {
  const c = audio();
  if (c && c.state === "suspended") void c.resume();
}

// ---------- trouble signal ----------
//
// Fired when a voice line could not be heard: the audio context stayed
// suspended (iOS before a tap, Low Power Mode), or the clip failed to load and
// there is no Japanese speech voice to fall back on. Screens that depend on
// hearing (Listen & Match) show a picture "sound on?" hint.

const troubleListeners = new Set<() => void>();
export function onVoiceTrouble(cb: () => void): () => void {
  troubleListeners.add(cb);
  return () => troubleListeners.delete(cb);
}
function trouble() {
  for (const cb of troubleListeners) cb();
}

/** Resume the context, but don't wait forever: iOS leaves the promise pending until a tap. */
async function resumed(c: AudioContext): Promise<boolean> {
  if (c.state === "running") return true;
  await Promise.race([c.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 300))]);
  return (c.state as AudioContextState) === "running";
}

// ---------- sound-effect bus ----------
//
// Every synthesised sound goes through one gain so the effects always sit
// under the voice (the kana must be the loudest thing a child hears). Voice
// clips go straight to the output at full level.

/** Level of all sound effects relative to their tuned values. */
const SFX_LEVEL = 1;
let sfxBus: GainNode | null = null;
function sfxOut(c: AudioContext): AudioNode {
  if (!sfxBus || sfxBus.context !== c) {
    sfxBus = c.createGain();
    sfxBus.gain.value = SFX_LEVEL;
    sfxBus.connect(c.destination);
  }
  return sfxBus;
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

/**
 * The kana voice (public/audio/kana/manifest.json): one clip per kana, made
 * by scripts/gen-kana-audio.ts with VOICEVOX:四国めたん for now. A recorded
 * voice will replace the files under the same names. Single kana play from
 * here first; the older Kokoro clips (manifest.json) stay for words, small
 * kana names and praise.
 */
interface KanaManifest {
  voice?: string;
  interim?: boolean;
  [kana: string]: string | boolean | undefined;
}
let kanaVoice: { files: Record<string, string>; voice?: string; interim: boolean } = { files: {}, interim: false };

async function loadJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(new URL(path, base));
    return r.ok && r.headers.get("content-type")?.includes("json") ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Load the clip lists (same-origin static files). Missing → speech only. */
export async function loadVoice(): Promise<void> {
  const [m, k] = await Promise.all([loadJson<Manifest>("manifest.json"), loadJson<KanaManifest>("kana/manifest.json")]);
  if (m) manifest = { ...m, ja: m.ja ?? {}, en: m.en ?? {} };
  if (k) {
    const files: Record<string, string> = {};
    for (const [kana, f] of Object.entries(k)) if (typeof f === "string" && kana !== "voice") files[kana] = `kana/${f}`;
    kanaVoice = { files, voice: k.voice, interim: !!k.interim };
  }
}

export const voiceCredit = () => manifest.credit;
/** "VOICEVOX:四国めたん" while the interim kana clips ship (the voice's terms require it shown). */
export const kanaVoiceCredit = () => kanaVoice.voice;
export const clipCount = () => Object.keys(manifest.ja).length + Object.keys(manifest.en).length + Object.keys(kanaVoice.files).length;

function clipFor(line: Line): string | undefined {
  // Lines recorded in the kana voice (the Listen & Match intro) sit in its manifest; a
  // recorded voice's clip wins over the older ones.
  return kanaVoice.files[line.text] ?? manifest[line.lang][line.text];
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

// ---------- turn-taking ----------
//
// Every voice line (clip or speech) goes through one queue: each waits for the
// one before it to finish, then a short pause. `interrupt` (taps, corrections)
// clears the queue and cuts in at once.

const GAP_MS = 280;
/** How much of one mora's sound runs under the next one's when a word is sounded out, s. */
const OVERLAP_S = 0.05;
/**
 * The kana voice (VOICEVOX) sounds a word out with space between letters
 * instead: its clips are short and trimmed tight (30 ms of silence each side),
 * so overlapping them ran the sounds together. Played back to back plus this
 * gap, about 120 ms of quiet sits between two sounds.
 */
const MORA_GAP_S = 0.06;

/** Where a clip's sound really starts and stops (seconds), past its quiet lead-in and tail. */
const edgesOf = new WeakMap<AudioBuffer, { on: number; off: number }>();
function edges(b: AudioBuffer): { on: number; off: number } {
  let e = edgesOf.get(b);
  if (!e) {
    const d = b.getChannelData(0);
    const w = Math.max(1, Math.floor(b.sampleRate * 0.005)); // 5 ms windows
    const rms: number[] = [];
    for (let i = 0; i + w <= d.length; i += w) {
      let sum = 0;
      for (let j = i; j < i + w; j++) sum += d[j] * d[j];
      rms.push(Math.sqrt(sum / w));
    }
    const floor = Math.max(...rms) * 0.06;
    const first = rms.findIndex((v) => v > floor);
    let last = rms.length - 1;
    while (last > 0 && rms[last] <= floor) last--;
    e = first < 0 ? { on: 0, off: b.duration } : { on: (first * w) / b.sampleRate, off: Math.min(b.duration, ((last + 1) * w) / b.sampleRate) };
    edgesOf.set(b, e);
  }
  return e;
}

interface Job {
  run(): Promise<void>;
  cancel(): void;
  /** Speech jobs: whether this device can actually say it. */
  canSpeak?(): boolean;
}

const queue: Job[] = [];
let current: Job | null = null;
let generation = 0;

/**
 * Queue a line. The promise resolves when it has finished playing, or when it
 * is dropped (sound off, interrupted, failed), never rejects, so a caller can
 * hold input until the voice is done without risking a stuck game.
 */
function enqueue(job: Job, interrupt: boolean): Promise<void> {
  if (!enabled) return Promise.resolve();
  if (interrupt) stopVoice();
  return new Promise<void>((settle) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        settle();
      }
    };
    queue.push({
      run: () => job.run().finally(finish),
      cancel() {
        job.cancel();
        finish();
      },
    });
    void pump();
  });
}

async function pump() {
  if (current) return;
  const job = queue.shift();
  if (!job) return;
  current = job;
  const my = generation;
  try {
    await job.run();
  } catch {
    /* a failed line must not block the rest */
  }
  if (my !== generation) return; // stopped meanwhile; stopVoice reset the queue
  await new Promise((r) => setTimeout(r, GAP_MS));
  if (my !== generation) return;
  current = null;
  void pump();
}

function stopVoice() {
  generation++;
  for (const j of queue.splice(0)) j.cancel(); // settles their promises
  current?.cancel();
  current = null;
  synth?.cancel();
}

/**
 * Clips back to back (null = the short pause of っ); falls back to `fallback`
 * if any is missing. Without `gap`, each clip's sound runs OVERLAP_S into the
 * next (Kokoro words); with it, each clip plays whole, then `gap` s of quiet.
 */
function clipJob(files: (string | null)[], fallback?: Job, gap?: number): Job {
  let sources: AudioBufferSourceNode[] = [];
  let done: () => void = () => {};
  let cancelled = false;
  return {
    async run() {
      const c = audio();
      const bufs = c && !files.some((f) => f === "") ? await Promise.all(files.map((f) => (f ? buffer(f) : Promise.resolve(null)))) : null;
      if (cancelled) return;
      if (!c || !bufs || bufs.some((b, i) => files[i] && !b)) {
        if (!fallback?.canSpeak?.()) trouble();
        return fallback?.run();
      }
      if (!(await resumed(c))) {
        if (!cancelled) trouble();
        return;
      }
      if (cancelled) return;
      let t = c.currentTime + 0.02;
      let prev: { gain: GainNode; end: number; heardUntil: number } | null = null;
      for (const b of bufs) {
        if (!b) {
          t += 0.12;
          prev = null;
          continue;
        }
        const src = c.createBufferSource();
        src.buffer = b;
        const gain = c.createGain();
        src.connect(gain).connect(c.destination);
        const e = edges(b);
        if (prev && gap !== undefined) {
          t = Math.max(c.currentTime + 0.01, prev.end + gap);
        } else if (prev) {
          // Sounded-out words (ち・く): each clip has quiet at both ends, so line
          // up the sound itself. The next mora's sound starts OVERLAP_S before the
          // last one's sound ends, and the last one fades out across that overlap,
          // so there is no gap ("chi ... ku") between them.
          const nextHeard = prev.heardUntil - OVERLAP_S;
          t = Math.max(c.currentTime + 0.01, nextHeard - e.on);
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(1, t + Math.min(0.015, e.on + 0.005));
          prev.gain.gain.setValueAtTime(1, nextHeard);
          prev.gain.gain.linearRampToValueAtTime(0, prev.heardUntil + 0.02);
        }
        src.start(t);
        sources.push(src);
        prev = { gain, end: t + b.duration, heardUntil: t + e.off };
        t += gap !== undefined ? b.duration : b.duration - 0.03; // clips carry a little silence at each end
      }
      const ms = (t - c.currentTime) * 1000;
      await new Promise<void>((resolve) => {
        done = resolve;
        setTimeout(resolve, ms + 30);
      });
    },
    cancel() {
      cancelled = true;
      fallback?.cancel();
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          /* not started */
        }
      }
      sources = [];
      done();
    },
  };
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

function speechJob(text: string, lang: "ja" | "en"): Job {
  let done: () => void = () => {};
  return {
    canSpeak: () => !!synth && (lang !== "ja" || !!pickVoice("ja")),
    run() {
      const v = pickVoice(lang);
      // Without a Japanese voice the engine reads kana as silence; don't pretend.
      if (!synth || (lang === "ja" && !v)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        done = resolve;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang === "ja" ? "ja-JP" : "en-US";
        if (v) u.voice = v;
        u.rate = lang === "ja" ? 0.85 : 1;
        u.pitch = 1.2;
        // Chrome can garbage-collect an utterance mid-sentence; keep a reference.
        keep.add(u);
        u.onend = u.onerror = () => {
          keep.delete(u);
          resolve();
        };
        synth.resume();
        synth.speak(u);
        // Some engines never fire onend; don't let the queue stall.
        setTimeout(resolve, 1500 + text.length * 120);
      });
    },
    cancel() {
      done();
    },
  };
}
const keep = new Set<SpeechSynthesisUtterance>();

// ---------- what the app calls ----------

/** Say a line. Resolves when it has been heard (or dropped). */
export function sayLine(line: Line, interrupt = true): Promise<void> {
  const f = clipFor(line);
  const speech = speechJob(line.text, line.lang);
  if (enabled && !f && !speech.canSpeak!()) trouble();
  return enqueue(f ? clipJob([f], speech) : speech, interrupt);
}

export const line = (id: LineId, interrupt = true) => sayLine(LINES[id], interrupt);
export const sayOrderSlip = (drawn: number, expected: number) => sayLine(orderLine(drawn, expected));

/** What is said for one kana: its tile name ("ちいさい や" for ゃ), homophones as their twin (を → お). */
const kanaText = (k: string) => speakText(soundOf(k));

/** The clip file that plays for one kana, if there is one. */
export const kanaClipFile = (k: string): string | undefined => kanaVoice.files[soundOf(k)] ?? manifest.ja[kanaText(k)];

/** One kana's sound: the kana voice's clip, else an older clip, else speech. Resolves when it has finished (or was dropped). */
export function sayKana(k: string, interrupt = true): Promise<void> {
  const f = kanaVoice.files[soundOf(k)];
  if (!f) return sayLine({ text: kanaText(k), lang: "ja" }, interrupt);
  return enqueue(clipJob([f], speechJob(kanaText(k), "ja")), interrupt);
}

/** Fetch and decode these kana's clips ahead of time so each plays the instant it's asked for. */
export function preloadKana(kana: Iterable<string>): void {
  for (const k of kana) {
    const f = kanaClipFile(k);
    if (f) void buffer(f);
  }
}

/** The decoded clip for one kana (for the dev audio review page). */
export function kanaClipBuffer(k: string): Promise<AudioBuffer | null> {
  const f = kanaClipFile(k);
  return f && audio() ? buffer(f) : Promise.resolve(null);
}

/** A whole word: its own clip, else sounded out from mora clips, else speech. */
export function sayWord(kana: string[], interrupt = true): Promise<void> {
  if (!kana.length) return Promise.resolve();
  if (kana.length === 1) return sayKana(kana[0], interrupt);
  const speech = speechJob(kana.join(""), "ja");
  const whole = manifest.ja[kana.join("")];
  if (whole) return enqueue(clipJob([whole], speech), interrupt);
  const m = moraFiles(kana);
  return enqueue(clipJob(m.files, speech, m.kanaVoice ? MORA_GAP_S : undefined), interrupt);
}

/**
 * Clip per mora: きゃ as one, っ as a pause, ー as the previous vowel. One voice
 * per word: the kana voice when it has every mora (plain kana only), else the
 * older clips, so a sounded-out word never switches voice halfway.
 */
function moraFiles(kana: string[]): { files: (string | null)[]; kanaVoice: boolean } {
  const sounded = (lookup: (text: string) => string | undefined) => {
    let prevVowel = "";
    return groupMorae(kana).map((g) => {
      const text = g.join("");
      if (text === "っ") return null;
      if (text === "ー") return prevVowel ? lookup(VOWEL_OF[prevVowel]) ?? "" : null;
      const r = g.map((k) => romajiOf(k) ?? "").join("");
      prevVowel = r.match(/[aiueo](?=[^aiueo]*$)/)?.[0] ?? prevVowel;
      return lookup(soundOf(text)) ?? "";
    });
  };
  const own = sounded((t) => kanaVoice.files[t]);
  return own.every((f) => f !== "") ? { files: own, kanaVoice: true } : { files: sounded((t) => manifest.ja[t]), kanaVoice: false };
}

/** Fetch a word's clips ahead of time so the first tap plays without delay. */
export function preloadWord(kana: string[]): void {
  const files = [manifest.ja[kana.join("")], ...kana.map(kanaClipFile), ...moraFiles(kana).files];
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
  o.connect(g).connect(sfxOut(c));
  o.start(t);
  o.stop(t + dur + 0.05);
}

// ---------- sand swoosh while drawing ----------
//
// A finger drawing through soft sand: looping noise, band-passed and softened,
// whose volume and brightness follow how fast the finger moves. Built once;
// each stroke only moves two parameters, so it costs nothing per frame.

let sand: { gain: GainNode; band: BiquadFilterNode } | null = null;
const SAND_MAX_GAIN = 0.055;
/** Everything 10% higher than first tuned: the grains, the filters. */
const SAND_PITCH = 1.1;

function sandNodes() {
  const c = audio();
  if (!c) return null;
  if (sand) return sand;
  // 2 s of brown-ish noise (smoothed white noise): grainy, not hissy.
  const len = c.sampleRate * 2;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = last * 0.97 + (Math.random() * 2 - 1) * 0.3;
    // occasional grains catching
    d[i] = last + (Math.random() < 0.002 ? (Math.random() - 0.5) * 0.6 : 0);
  }
  // Fade the loop's ends together so the repeat has no click.
  const fade = Math.floor(c.sampleRate * 0.05);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] *= k;
    d[len - 1 - i] *= k;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = SAND_PITCH;
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 900 * SAND_PITCH;
  band.Q.value = 0.6;
  const soft = c.createBiquadFilter();
  soft.type = "lowpass";
  soft.frequency.value = 3200 * SAND_PITCH;
  const gain = c.createGain();
  gain.gain.value = 0;
  src.connect(band).connect(soft).connect(gain).connect(sfxOut(c));
  src.start();
  sand = { gain, band };
  return sand;
}

/**
 * Finger speed while drawing, in cell sizes per second (0 = still).
 * Call on every move; call with 0 when the stroke ends.
 */
export function sandSwoosh(speed: number): void {
  const s = enabled ? sandNodes() : sand;
  if (!s || !ctx) return;
  const t = ctx.currentTime;
  const v = enabled ? Math.min(1, speed / 2.2) : 0;
  // Quick to start, gentle to fade: like sand settling.
  s.gain.gain.setTargetAtTime(SAND_MAX_GAIN * Math.sqrt(v), t, v > 0 ? 0.03 : 0.09);
  s.band.frequency.setTargetAtTime((650 + 900 * v) * SAND_PITCH, t, 0.05);
}

// ---------- button thunk ----------
//
// A finger tapping a small plastic beach bucket: a soft, hollow "tok". Three
// short layers through one gentle low-pass: a low knock that drops in pitch
// (the bucket's body), a filtered click (the plastic shell) and a brief
// resonance. Each tap is pitched a few percent differently so repeats don't
// sound mechanical.

let clickNoise: AudioBuffer | null = null;
/** 30% quieter than first tuned. */
const THUNK_VOLUME = 0.7;

export function thunk(): void {
  if (!enabled) return;
  const c = audio();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  const t = c.currentTime + 0.005;
  const v = 0.95 + Math.random() * 0.1;
  const soft = c.createBiquadFilter();
  soft.type = "lowpass";
  soft.frequency.value = 2600;
  soft.connect(sfxOut(c));

  const env = (peak: number, attack: number, decay: number) => {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(soft);
    return g;
  };

  // Body: a hollow knock, 230 → 140 Hz.
  const body = c.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(230 * v, t);
  body.frequency.exponentialRampToValueAtTime(140 * v, t + 0.08);
  body.connect(env(0.17 * THUNK_VOLUME, 0.004, 0.1));
  body.start(t);
  body.stop(t + 0.13);

  // Shell: a short burst of noise through a band-pass, the plastic "t" of "tok".
  if (!clickNoise) {
    clickNoise = c.createBuffer(1, Math.floor(c.sampleRate * 0.04), c.sampleRate);
    const d = clickNoise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  }
  const click = c.createBufferSource();
  click.buffer = clickNoise;
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1150 * v;
  band.Q.value = 2.5;
  click.connect(band).connect(env(0.09 * THUNK_VOLUME, 0.002, 0.035));
  click.start(t);

  // Resonance: the bucket's wall ringing for an instant.
  const ring = c.createOscillator();
  ring.type = "triangle";
  ring.frequency.setValueAtTime(540 * v, t);
  ring.connect(env(0.035 * THUNK_VOLUME, 0.003, 0.06));
  ring.start(t);
  ring.stop(t + 0.08);
}

// ---------- colour splash ----------
//
// Picking an ink colour: a tiny, cute splash. A soft swish of water (noise
// through a band-pass sweeping down) and two droplets that "plip" upward,
// the second a touch higher and later. Quiet, like the button thunk.

let splashNoise: AudioBuffer | null = null;

export function splash(): void {
  if (!enabled) return;
  const c = audio();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  const t = c.currentTime + 0.005;
  const v = 0.95 + Math.random() * 0.1;
  const out = c.createGain();
  out.gain.value = 0.7; // same overall level as the thunk
  out.connect(sfxOut(c));

  // Swish: 120 ms of decaying noise, band-pass sweeping 2.4 kHz → 900 Hz.
  if (!splashNoise) {
    splashNoise = c.createBuffer(1, Math.floor(c.sampleRate * 0.14), c.sampleRate);
    const d = splashNoise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  }
  const swish = c.createBufferSource();
  swish.buffer = splashNoise;
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1.4;
  band.frequency.setValueAtTime(2400 * v, t);
  band.frequency.exponentialRampToValueAtTime(900 * v, t + 0.12);
  const sg = c.createGain();
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.exponentialRampToValueAtTime(0.09, t + 0.008);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  swish.connect(band).connect(sg).connect(out);
  swish.start(t);

  // Droplets: quick sine "plips" gliding upward.
  const plip = (at: number, from: number, to: number, peak: number) => {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(from * v, t + at);
    o.frequency.exponentialRampToValueAtTime(to * v, t + at + 0.05);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.exponentialRampToValueAtTime(peak, t + at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.07);
    o.connect(g).connect(out);
    o.start(t + at);
    o.stop(t + at + 0.09);
  };
  plip(0.03, 700, 1300, 0.07);
  plip(0.085, 950, 1700, 0.045);
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

// One octave of the major scale: eight steps up from C5, so the eighth lands
// back home on C6 and the climb sounds finished.
const OCTAVE = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5];

/** Listen & Match: each find one note higher than the last (step 0–7). */
export function stepChime(step: number): void {
  if (!enabled) return;
  const f = OCTAVE[Math.max(0, Math.min(OCTAVE.length - 1, step))];
  tone(f, 0, 0.4, 0.16, "triangle");
  tone(f * 2, 0.03, 0.3, 0.05, "sine");
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
