// Measurements for the audio review page: how long a clip's sound really is,
// how much quiet surrounds it, how hot it peaks and how loud it is. DOM-free so
// it can be unit-tested. The thresholds come from the recording spec in
// docs/LISTEN-MATCH.md ("Audio refinement").

export interface ClipStats {
  /** Whole file, s. */
  duration: number;
  /** Quiet before / after the sound, s. */
  lead: number;
  tail: number;
  /** The sound itself, s. */
  sound: number;
  /** Highest sample, dBFS. */
  peakDb: number;
  /** RMS of the sounding part, dBFS. A stand-in for perceived loudness. */
  loudnessDb: number;
}

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** Same 5 ms windows and 6%-of-max floor that ui/audio.ts uses to line clips up. */
export function clipStats(d: Float32Array, rate: number): ClipStats {
  const w = Math.max(1, Math.floor(rate * 0.005));
  const rms: number[] = [];
  let peak = 0;
  for (let i = 0; i + w <= d.length; i += w) {
    let sum = 0;
    for (let j = i; j < i + w; j++) {
      sum += d[j] * d[j];
      const a = Math.abs(d[j]);
      if (a > peak) peak = a;
    }
    rms.push(Math.sqrt(sum / w));
  }
  const duration = d.length / rate;
  const max = Math.max(0, ...rms);
  const first = rms.findIndex((v) => v > max * 0.06);
  if (first < 0 || max === 0) return { duration, lead: duration, tail: 0, sound: 0, peakDb: -Infinity, loudnessDb: -Infinity };
  let last = rms.length - 1;
  while (last > first && rms[last] <= max * 0.06) last--;
  const on = (first * w) / rate;
  const off = Math.min(duration, ((last + 1) * w) / rate);
  let sum = 0;
  for (let k = first; k <= last; k++) sum += rms[k] * rms[k];
  return {
    duration,
    lead: on,
    tail: duration - off,
    sound: off - on,
    peakDb: db(peak),
    loudnessDb: db(Math.sqrt(sum / (last - first + 1))),
  };
}

export const SPEC = {
  /** "Most clips should run about 0.4–0.8 s." */
  sound: [0.4, 0.8] as const,
  /** Trim to about 30 ms each side; flag well past that. */
  maxQuiet: 0.12,
  /** Less than this and the sound probably runs into the file's edge (clipped start/end). */
  minQuiet: 0.004,
  /** "Keep peaks below −1 dBFS." */
  maxPeakDb: -1,
  /** "None noticeably louder or quieter": more than this from the set's median. */
  loudnessSpreadDb: 3,
};

export interface Flag {
  id: "short" | "long" | "lead" | "tail" | "cut-start" | "cut-end" | "hot" | "loud" | "quiet" | "silent";
  text: string;
}

const s = (x: number) => `${Math.round(x * 1000)} ms`;

/** What a reviewer should listen for in this clip. `medianLoudness` is across the whole set (the kana clips, for words too). */
export function flagsFor(st: ClipStats, medianLoudness: number, opts: { length?: boolean } = {}): Flag[] {
  if (st.sound === 0) return [{ id: "silent", text: "no sound found" }];
  const f: Flag[] = [];
  // Word clips (Look & Write) are whole words: the one-sound length window doesn't apply.
  if (opts.length !== false && st.sound < SPEC.sound[0]) f.push({ id: "short", text: `sound only ${s(st.sound)}` });
  if (opts.length !== false && st.sound > SPEC.sound[1]) f.push({ id: "long", text: `sound runs ${s(st.sound)}` });
  if (st.lead > SPEC.maxQuiet) f.push({ id: "lead", text: `${s(st.lead)} quiet before` });
  if (st.tail > SPEC.maxQuiet) f.push({ id: "tail", text: `${s(st.tail)} quiet after` });
  if (st.lead < SPEC.minQuiet) f.push({ id: "cut-start", text: "starts at the very edge (clipped?)" });
  if (st.tail < SPEC.minQuiet) f.push({ id: "cut-end", text: "ends at the very edge (clipped?)" });
  if (st.peakDb > SPEC.maxPeakDb) f.push({ id: "hot", text: `peaks at ${st.peakDb.toFixed(1)} dBFS` });
  const off = st.loudnessDb - medianLoudness;
  if (off > SPEC.loudnessSpreadDb) f.push({ id: "loud", text: `${off.toFixed(1)} dB louder than most` });
  if (off < -SPEC.loudnessSpreadDb) f.push({ id: "quiet", text: `${(-off).toFixed(1)} dB quieter than most` });
  return f;
}

export function median(xs: number[]): number {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** The doc's "sounds commonly done wrong, check first" list, per kana. */
export const LISTEN_FOR: Readonly<Record<string, string>> = {
  ふ: "No English “f”: lips barely touch, no teeth.",
  ら: "Light tapped r/l, not English r or l.",
  り: "Light tapped r/l, not English r or l.",
  る: "Light tapped r/l, not English r or l.",
  れ: "Light tapped r/l, not English r or l.",
  ろ: "Light tapped r/l, not English r or l.",
  し: "shi, not si.",
  ち: "chi, not ti.",
  つ: "tsu, not tu.",
  ん: "A plain hum, not “nu”.",
  う: "Short and lightly rounded, not English “oo”.",
};

export type Verdict = "" | "pass" | "fix" | "replace";

export interface ReviewRow {
  kana: string;
  romaji: string;
  playsAs: string;
  file: string;
  verdict: Verdict;
  note: string;
  flags: string;
}

/** The review sheet as CSV (opens in Sheets/Excel). */
export function toCsv(rows: ReviewRow[]): string {
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const head = ["kana", "romaji", "plays as", "file", "verdict", "note", "auto flags"];
  return [head, ...rows.map((r) => [r.kana, r.romaji, r.playsAs, r.file, r.verdict, r.note, r.flags])].map((r) => r.map(q).join(",")).join("\n") + "\n";
}
