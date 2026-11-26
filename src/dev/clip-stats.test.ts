import { describe, expect, it } from "vitest";
import { soundOf, SOUNDS_LIKE } from "../audio-lines";
import { clipStats, flagsFor, median, toCsv } from "./clip-stats";

const RATE = 48000;

/** quiet · tone · quiet, seconds; tone amplitude `amp`. */
function clip(lead: number, sound: number, tail: number, amp = 0.5): Float32Array {
  const n = (s: number) => Math.round(s * RATE);
  const d = new Float32Array(n(lead) + n(sound) + n(tail));
  for (let i = 0; i < n(sound); i++) d[n(lead) + i] = amp * Math.sin((2 * Math.PI * 220 * i) / RATE);
  return d;
}

const ids = (lead: number, sound: number, tail: number, amp = 0.5, med?: number) => {
  const st = clipStats(clip(lead, sound, tail, amp), RATE);
  return flagsFor(st, med ?? st.loudnessDb).map((f) => f.id);
};

describe("clip stats", () => {
  it("measures the sound and the quiet around it", () => {
    const st = clipStats(clip(0.03, 0.6, 0.03), RATE);
    expect(st.duration).toBeCloseTo(0.66, 2);
    expect(st.lead).toBeCloseTo(0.03, 2);
    expect(st.tail).toBeCloseTo(0.03, 2);
    expect(st.sound).toBeCloseTo(0.6, 2);
    expect(st.peakDb).toBeCloseTo(20 * Math.log10(0.5), 1);
    expect(st.loudnessDb).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 0);
  });

  it("passes a clip cut to spec", () => {
    expect(ids(0.03, 0.6, 0.03)).toEqual([]);
  });

  it("flags short, long, padded, clipped and hot clips", () => {
    expect(ids(0.03, 0.2, 0.03)).toContain("short");
    expect(ids(0.03, 1.2, 0.03)).toContain("long");
    expect(ids(0.4, 0.6, 0.03)).toContain("lead");
    expect(ids(0.03, 0.6, 0.5)).toContain("tail");
    expect(ids(0, 0.6, 0.03)).toContain("cut-start");
    expect(ids(0.03, 0.6, 0)).toContain("cut-end");
    expect(ids(0.03, 0.6, 0.03, 0.99)).toContain("hot");
  });

  it("flags clips far from the set's median loudness", () => {
    const med = clipStats(clip(0.03, 0.6, 0.03, 0.3), RATE).loudnessDb;
    expect(ids(0.03, 0.6, 0.03, 0.8, med)).toContain("loud");
    expect(ids(0.03, 0.6, 0.03, 0.08, med)).toContain("quiet");
  });

  it("reports silence", () => {
    expect(flagsFor(clipStats(new Float32Array(RATE), RATE), 0).map((f) => f.id)).toEqual(["silent"]);
  });

  it("takes medians and writes CSV", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3, -Infinity])).toBe(2.5);
    const csv = toCsv([{ kana: "ふ", romaji: "fu", playsAs: "", file: "ja/x.mp3", verdict: "fix", note: 'teeth, "f"', flags: "" }]);
    expect(csv.split("\n")[1]).toBe('ふ,fu,,ja/x.mp3,fix,"teeth, ""f""",');
  });
});

describe("homophones", () => {
  it("plays を, ぢ, づ with their twins' clips and nothing else", () => {
    expect(soundOf("を")).toBe("お");
    expect(soundOf("ぢ")).toBe("じ");
    expect(soundOf("づ")).toBe("ず");
    expect(soundOf("お")).toBe("お");
    expect(soundOf("か")).toBe("か");
    expect(Object.keys(SOUNDS_LIKE).sort()).toEqual(["ぢ", "づ", "を"].sort());
  });
});
