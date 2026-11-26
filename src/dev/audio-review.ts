// Dev-only audio review page (npm run dev, then open #audio-review). Never in
// the production build: main.ts only imports it behind import.meta.env.DEV.
//
// Lists every kana Listen & Match can ask for (46 basic + 25 voiced), plays
// its clip, measures it against the recording spec, and records a Pass / Fix /
// Replace verdict with a note. Verdicts stay in this browser's localStorage;
// "Export sheet" downloads the review sheet as CSV.

import { soundOf } from "../audio-lines";
import { charts, romajiOf } from "../data";
import { HIDDEN_KANA } from "../engine/kana";
import { h, kanaSvg } from "../ui/dom";
import { kanaClipBuffer, kanaClipFile, sayKana, setSoundEnabled, unlockAudio } from "../ui/audio";
import { clipStats, flagsFor, LISTEN_FOR, median, toCsv, type ClipStats, type ReviewRow, type Verdict } from "./clip-stats";

const KEY = "hb-audio-review";

interface Saved {
  verdict: Verdict;
  note: string;
}

const REVIEW_KANA: string[] = [...charts.basic.flat(), ...charts.voiced.flat()].filter((k): k is string => !!k && !HIDDEN_KANA.has(k));

function load(): Record<string, Saved> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

const CSS = `
.ar { position: fixed; inset: 0; overflow: auto; background: #fff8e8; color: #3b2f1e; font: 15px/1.4 Nunito, system-ui, sans-serif; padding: 16px 20px 60px; user-select: text; -webkit-user-select: text; }
.ar h1 { font-size: 22px; margin: 0 0 4px; }
.ar .sub { margin: 0 0 12px; opacity: .75; }
.ar .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; position: sticky; top: -16px; background: #fff8e8; padding: 8px 0; z-index: 1; }
.ar button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid #c9b48a; background: #fff; cursor: pointer; }
.ar button:hover { background: #fdf1d6; }
.ar .count { margin-left: auto; font-weight: 700; }
.ar table { border-collapse: collapse; width: 100%; }
.ar th, .ar td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ead9b5; vertical-align: middle; }
.ar th { font-size: 13px; opacity: .7; }
.ar tr.playing { background: #fdeec6; }
.ar .k svg { width: 40px; height: 40px; fill: none; stroke: #3b2f1e; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
.ar .alias { font-size: 12px; opacity: .7; }
.ar .num { font-variant-numeric: tabular-nums; font-size: 13px; white-space: nowrap; }
.ar .flags { font-size: 13px; color: #8a5a00; }
.ar .hint { font-size: 13px; color: #3d6b8f; }
.ar .seg { display: inline-flex; border: 1px solid #c9b48a; border-radius: 8px; overflow: hidden; }
.ar .seg label { padding: 4px 10px; cursor: pointer; font-size: 13px; }
.ar .seg input { display: none; }
.ar .seg label:has(input:checked)[data-v=pass] { background: #cfe9c4; }
.ar .seg label:has(input:checked)[data-v=fix] { background: #f7e0a3; }
.ar .seg label:has(input:checked)[data-v=replace] { background: #f3c9a8; }
.ar input.note { width: 100%; min-width: 160px; font: inherit; font-size: 13px; padding: 4px 6px; border: 1px solid #ead9b5; border-radius: 6px; }
`;

export function audioReviewScreen(): HTMLElement {
  setSoundEnabled(true);
  const saved = load();
  const stats = new Map<string, ClipStats>();
  const flagCells = new Map<string, HTMLElement>();
  const numCells = new Map<string, HTMLElement>();
  const rows = new Map<string, HTMLTableRowElement>();
  const count = h("span", { class: "count" });

  const persist = () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const done = REVIEW_KANA.filter((k) => saved[k]?.verdict).length;
    const pass = REVIEW_KANA.filter((k) => saved[k]?.verdict === "pass").length;
    count.textContent = `${done}/${REVIEW_KANA.length} reviewed · ${pass} pass`;
  };

  const play = async (k: string) => {
    unlockAudio();
    for (const r of rows.values()) r.classList.remove("playing");
    rows.get(k)?.classList.add("playing");
    await sayKana(k);
    rows.get(k)?.classList.remove("playing");
  };

  let playingAll = false;
  const playAll = async (btn: HTMLButtonElement) => {
    if (playingAll) {
      playingAll = false;
      return;
    }
    playingAll = true;
    btn.textContent = "■ Stop";
    for (const k of REVIEW_KANA) {
      if (!playingAll) break;
      rows.get(k)?.scrollIntoView({ block: "center", behavior: "smooth" });
      await play(k);
      await new Promise((r) => setTimeout(r, 450));
    }
    playingAll = false;
    btn.textContent = "▶ Play all";
  };

  const sheet = (): ReviewRow[] =>
    REVIEW_KANA.map((k) => ({
      kana: k,
      romaji: romajiOf(k) ?? "",
      playsAs: soundOf(k) === k ? "" : soundOf(k),
      file: kanaClipFile(k) ?? "(no clip: speech only)",
      verdict: saved[k]?.verdict ?? "",
      note: saved[k]?.note ?? "",
      flags: flagCells.get(k)?.dataset.flags ?? "",
    }));

  const download = (name: string, text: string, type: string) => {
    const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const today = new Date().toISOString().slice(0, 10);
  const playAllBtn: HTMLButtonElement = h("button", { onclick: () => void playAll(playAllBtn) }, "▶ Play all");

  const body = h(
    "tbody",
    null,
    REVIEW_KANA.map((k) => {
      const v = saved[k]?.verdict ?? "";
      const seg = h(
        "span",
        { class: "seg" },
        (["pass", "fix", "replace"] as const).map((opt) =>
          h(
            "label",
            { "data-v": opt },
            h("input", {
              type: "radio",
              name: `v-${k}`,
              checked: v === opt,
              onchange: () => {
                saved[k] = { note: saved[k]?.note ?? "", verdict: opt };
                persist();
              },
            }),
            opt[0].toUpperCase() + opt.slice(1),
          ),
        ),
      );
      const note = h("input", {
        class: "note",
        value: saved[k]?.note ?? "",
        placeholder: "what's wrong?",
        oninput: (e: Event) => {
          saved[k] = { verdict: saved[k]?.verdict ?? "", note: (e.target as HTMLInputElement).value };
          persist();
        },
      });
      const nums = h("td", { class: "num" }, "…");
      const flags = h("td", { class: "flags" });
      numCells.set(k, nums);
      flagCells.set(k, flags);
      const alias = soundOf(k) !== k ? h("div", { class: "alias" }, `plays ${soundOf(k)}`) : null;
      const row = h(
        "tr",
        null,
        h("td", { class: "k" }, kanaSvg(k)),
        h("td", null, romajiOf(k) ?? "", alias),
        h("td", null, h("button", { onclick: () => void play(k), "aria-label": `Play ${k}` }, "▶")),
        nums,
        flags,
        h("td", { class: "hint" }, LISTEN_FOR[k] ?? ""),
        h("td", null, seg),
        h("td", null, note),
      );
      rows.set(k, row);
      return row;
    }),
  );

  const el = h(
    "div",
    { class: "ar" },
    h("style", null, CSS),
    h("h1", null, "Audio review: kana clips"),
    h(
      "p",
      { class: "sub" },
      "Dev only. Play each clip, listen for the note in blue, and mark it. Numbers are measured from the file: ",
      "sound length (spec 0.4–0.8 s), quiet before/after (spec ≈30 ms), peak (spec < −1 dBFS), loudness vs the median.",
    ),
    h(
      "div",
      { class: "bar" },
      playAllBtn,
      h("button", { onclick: () => download(`audio-review-${today}.csv`, toCsv(sheet()), "text/csv") }, "Export sheet (CSV)"),
      h("button", { onclick: () => download(`audio-review-${today}.json`, JSON.stringify(sheet(), null, 2), "application/json") }, "Export JSON"),
      count,
    ),
    h(
      "table",
      null,
      h("thead", null, h("tr", null, ...["", "romaji", "", "sound · quiet · peak · loud", "auto flags", "listen for", "verdict", "note"].map((t) => h("th", null, t)))),
      body,
    ),
  );

  persist();
  void measure();

  async function measure() {
    await Promise.all(
      REVIEW_KANA.map(async (k) => {
        const b = await kanaClipBuffer(k);
        if (b) stats.set(k, clipStats(b.getChannelData(0), b.sampleRate));
      }),
    );
    const med = median([...stats.values()].map((s) => s.loudnessDb));
    for (const k of REVIEW_KANA) {
      const st = stats.get(k);
      const nums = numCells.get(k)!;
      const flags = flagCells.get(k)!;
      if (!st) {
        nums.textContent = "no clip";
        flags.textContent = "speech fallback only";
        flags.dataset.flags = "no clip";
        continue;
      }
      const ms = (x: number) => Math.round(x * 1000);
      nums.textContent = `${ms(st.sound)} · ${ms(st.lead)}/${ms(st.tail)} ms · ${st.peakDb.toFixed(1)} · ${(st.loudnessDb - med >= 0 ? "+" : "") + (st.loudnessDb - med).toFixed(1)} dB`;
      const f = flagsFor(st, med).map((x) => x.text);
      flags.textContent = f.join("; ");
      flags.dataset.flags = f.join("; ");
    }
  }

  return el;
}
