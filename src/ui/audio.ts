// Speech (Web Speech API) and tiny synthesised sounds (Web Audio). No files,
// no network. Everything respects the parent's sound setting.

let enabled = true;
export const setSoundEnabled = (on: boolean) => {
  enabled = on;
  if (!on) speechSynthesis?.cancel();
};
export const soundEnabled = () => enabled;

// ---------- speech ----------

const synth: SpeechSynthesis | undefined = typeof speechSynthesis !== "undefined" ? speechSynthesis : undefined;
let voices: SpeechSynthesisVoice[] = [];
const loadVoices = () => (voices = synth?.getVoices() ?? []);
if (synth) {
  loadVoices();
  synth.addEventListener?.("voiceschanged", loadVoices);
}

function pickVoice(lang: "ja-JP" | "en-US"): SpeechSynthesisVoice | undefined {
  const base = lang.slice(0, 2);
  const matches = voices.filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith(base));
  return matches.find((v) => v.lang.replace("_", "-") === lang && v.localService) ?? matches.find((v) => v.localService) ?? matches[0];
}

/** Speak text. Japanese by default; `interrupt` stops anything already queued. */
export function say(text: string, lang: "ja-JP" | "en-US" = "ja-JP", interrupt = true): void {
  if (!enabled || !synth || !text) return;
  if (interrupt) synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const v = pickVoice(lang);
  if (v) u.voice = v;
  u.rate = lang === "ja-JP" ? 0.8 : 0.95;
  u.pitch = 1.15;
  synth.speak(u);
}

export const sayEn = (text: string, interrupt = true) => say(text, "en-US", interrupt);

const PRAISE: [string, "ja-JP" | "en-US"][] = [
  ["じょうず！", "ja-JP"],
  ["すごい！", "ja-JP"],
  ["できた！", "ja-JP"],
  ["Great job!", "en-US"],
  ["Wonderful!", "en-US"],
  ["You did it!", "en-US"],
  ["いいね！", "ja-JP"],
];
let lastPraise = -1;
export function praise(): void {
  let i = Math.floor(Math.random() * PRAISE.length);
  if (i === lastPraise) i = (i + 1) % PRAISE.length;
  lastPraise = i;
  say(PRAISE[i][0], PRAISE[i][1], false);
}

// ---------- sounds ----------

let ctx: AudioContext | null = null;

/** Call from a user gesture so iOS lets audio play. */
export function unlockAudio(): void {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
}

function tone(freq: number, start: number, dur: number, gain: number, type: OscillatorType = "sine", endFreq?: number) {
  if (!ctx) return;
  const t = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
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
