// Private speech input for the word box: on-device recognition only.
//
// Uses the Web Speech API with `processLocally = true`, so audio never leaves
// the device. Browsers that can't promise local processing get no mic button
// at all; we never fall back to a cloud recogniser. English and Japanese
// listen to the same microphone at once where both are available locally.

import type { Heard } from "../engine/heard";

export type ListenLang = "en-US" | "ja-JP";
const LANGS: ListenLang[] = ["en-US", "ja-JP"];
const MAX_MS = 15_000;

type Status = "available" | "downloadable" | "downloading" | "unavailable";

interface Alt {
  transcript: string;
  confidence: number;
}
interface Rec extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally: boolean;
  start(track?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<Alt> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
interface RecClass {
  new (): Rec;
  prototype: object;
  available?(o: { langs: string[]; processLocally: boolean }): Promise<Status>;
  install?(o: { langs: string[]; processLocally: boolean }): Promise<boolean>;
}

const SR: RecClass | undefined =
  (globalThis as unknown as { SpeechRecognition?: RecClass }).SpeechRecognition ??
  (globalThis as unknown as { webkitSpeechRecognition?: RecClass }).webkitSpeechRecognition;

/** Only browsers that implement local processing qualify; others might use a server. */
const supportsLocal = () => !!SR && typeof SR.available === "function" && "processLocally" in SR.prototype;

async function status(lang: ListenLang): Promise<Status> {
  try {
    return (await SR!.available!({ langs: [lang], processLocally: true })) ?? "unavailable";
  } catch {
    return "unavailable";
  }
}

export interface Readiness {
  /** Languages that can be recognised on this device right now. */
  ready: ListenLang[];
  /** Languages whose on-device pack the browser can download. */
  installable: ListenLang[];
}

/** What this device can do privately. Empty `ready` and `installable` → hide the mic. */
export async function readiness(): Promise<Readiness> {
  if (!supportsLocal() || !navigator.mediaDevices?.getUserMedia) return { ready: [], installable: [] };
  const s = await Promise.all(LANGS.map(status));
  return {
    ready: LANGS.filter((_, i) => s[i] === "available"),
    installable: LANGS.filter((_, i) => s[i] === "downloadable" || s[i] === "downloading"),
  };
}

/** Ask the browser to fetch its on-device language packs (a one-time download from the browser maker). */
export async function installLanguages(langs: ListenLang[]): Promise<ListenLang[]> {
  const ok = await Promise.all(
    langs.map((lang) =>
      Promise.race([
        SR!.install!({ langs: [lang], processLocally: true }).catch(() => false),
        new Promise<boolean>((r) => setTimeout(() => r(false), 120_000)),
      ]),
    ),
  );
  return langs.filter((_, i) => ok[i]);
}

/** One recording. `stop()` resolves with everything heard, per language. */
export class Listening {
  private recs: { lang: ListenLang; rec: Rec; ended: Promise<void> }[] = [];
  private stream: MediaStream | null = null;
  private clones: MediaStreamTrack[] = [];
  private heard: Heard = {};
  private timer = 0;
  private stopping: Promise<Heard> | null = null;
  /** Called if listening ends on its own (time limit, silence, error). */
  onAutoStop: (() => void) | null = null;

  static async start(langs: ListenLang[]): Promise<Listening> {
    const l = new Listening();
    await l.begin(langs);
    return l;
  }

  private async begin(langs: ListenLang[]) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const track = this.stream.getAudioTracks()[0];
    for (const lang of langs) {
      const rec = new SR!();
      rec.processLocally = true; // never send audio anywhere
      if (!rec.processLocally) continue; // the browser refused local mode
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = false;
      rec.maxAlternatives = 3;
      const key = lang === "en-US" ? "en" : "ja";
      rec.onresult = (e) => {
        const out: { text: string; confidence: number }[][] = [];
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i];
          if (!r.isFinal) continue;
          out.push(Array.from({ length: r.length }, (_, j) => ({ text: r[j].transcript, confidence: r[j].confidence })));
        }
        // Join phrases: best alternatives together, plus the single-phrase alternatives.
        const best = out.map((alts) => alts[0]?.text ?? "").join(" ").trim();
        const alts = out.length === 1 ? out[0] : [{ text: best, confidence: 0 }];
        this.heard[key] = alts.filter((a) => a.text.trim());
      };
      const ended = new Promise<void>((resolve) => {
        rec.onend = () => resolve();
        rec.onerror = () => resolve();
      });
      const clone = track.clone();
      this.clones.push(clone);
      try {
        rec.start(clone);
      } catch {
        continue;
      }
      this.recs.push({ lang, rec, ended });
    }
    if (!this.recs.length) {
      this.release();
      throw new Error("no-local-recogniser");
    }
    // If every recogniser stops by itself, tell the button.
    void Promise.all(this.recs.map((r) => r.ended)).then(() => {
      if (!this.stopping) this.onAutoStop?.();
    });
    this.timer = window.setTimeout(() => this.onAutoStop?.(), MAX_MS);
  }

  stop(): Promise<Heard> {
    this.stopping ??= (async () => {
      clearTimeout(this.timer);
      for (const { rec } of this.recs) {
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      }
      // Final results arrive just after stop(); don't wait forever for them.
      await Promise.race([Promise.all(this.recs.map((r) => r.ended)), new Promise((r) => setTimeout(r, 4000))]);
      this.release();
      return this.heard;
    })();
    return this.stopping;
  }

  cancel(): void {
    clearTimeout(this.timer);
    this.stopping ??= Promise.resolve({});
    for (const { rec } of this.recs) {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
    this.release();
  }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.clones.forEach((t) => t.stop());
    this.stream = null;
    this.clones = [];
  }
}
