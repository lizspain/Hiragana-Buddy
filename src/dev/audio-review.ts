// Dev-only audio review page. Open tools/audio-review.html on the dev server
// (npm run dev → /tools/audio-review.html), or /#audio-review. Never in the
// production build: Vite only builds index.html, and main.ts imports this
// behind import.meta.env.DEV.
//
// Every kana Listen & Match can ask for (46 basic + 25 voiced) as a tile:
// play it, read the measurements and the "listen for" note, mark Pass / Fix /
// Replace with a note. The sounds synthetic voices most often get wrong come
// first. Marks stay in this browser (one set per voice); "Export JSON" and
// "Export CSV" download the review sheet.

import { soundOf } from "../audio-lines";
import { charts, romajiOf } from "../data";
import { HIDDEN_KANA } from "../engine/kana";
import { h, kanaSvg } from "../ui/dom";
import { kanaClipBuffer, kanaClipFile, kanaVoiceCredit, sayKana, setSoundEnabled, unlockAudio } from "../ui/audio";
import { clipStats, flagsFor, LISTEN_FOR, median, toCsv, type ClipStats, type ReviewRow, type Verdict } from "./clip-stats";

const ALL: string[] = [...charts.basic.flat(), ...charts.voiced.flat()].filter((k): k is string => !!k && !HIDDEN_KANA.has(k));
/** Checked first: ふ, the r-row, し/ち/つ, ん, う. */
const FIRST = [..."ふらりるれろしちつんう"];
const ORDER = [...FIRST, ...ALL.filter((k) => !FIRST.includes(k))];

interface Saved {
  verdict: Verdict;
  note: string;
}

const CSS = `
html, body { height: auto; overflow: auto; }
.ar { min-height: 100vh; background: #fff8e8; color: #3b2f1e; font: 15px/1.4 Nunito, system-ui, sans-serif; padding: 16px 20px 60px; user-select: text; -webkit-user-select: text; }
.ar h1 { font-size: 22px; margin: 0 0 4px; }
.ar h2 { font-size: 16px; margin: 22px 0 10px; }
.ar .sub { margin: 0 0 12px; opacity: .8; max-width: 860px; }
.ar .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; position: sticky; top: 0; background: #fff8e8; padding: 8px 0; z-index: 1; }
.ar button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid #c9b48a; background: #fff; cursor: pointer; color: inherit; }
.ar button:hover { background: #fdf1d6; }
.ar .count { margin-left: auto; font-weight: 700; }
.ar .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.ar .card { background: #fffdf5; border: 2px solid #e2cfa6; border-radius: 14px; padding: 10px; display: grid; gap: 6px; }
.ar .card.pass { border-color: #8cc47a; } .ar .card.fix { border-color: #e7b84a; } .ar .card.replace { border-color: #e08a5b; }
.ar .card.playing { box-shadow: 0 0 0 4px #f7d77a; }
.ar .top { display: flex; align-items: center; gap: 10px; }
.ar .play { width: 64px; height: 64px; border-radius: 14px; padding: 6px; display: grid; place-items: center; }
.ar .play svg { width: 100%; height: 100%; fill: none; stroke: #3b2f1e; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
.ar .name b { font-size: 18px; } .ar .name small { display: block; opacity: .7; font-size: 12px; }
.ar .num { font-variant-numeric: tabular-nums; font-size: 12px; opacity: .8; }
.ar .flags { font-size: 12px; color: #8a5a00; min-height: 1em; }
.ar .hint { font-size: 13px; color: #2f6390; }
.ar .seg { display: flex; border: 1px solid #c9b48a; border-radius: 8px; overflow: hidden; }
.ar .seg label { flex: 1; text-align: center; padding: 5px 0; cursor: pointer; font-size: 13px; }
.ar .seg input { display: none; }
.ar .seg label:has(input:checked)[data-v=pass] { background: #cfe9c4; }
.ar .seg label:has(input:checked)[data-v=fix] { background: #f7e0a3; }
.ar .seg label:has(input:checked)[data-v=replace] { background: #f3c9a8; }
.ar input.note { width: 100%; font: inherit; font-size: 13px; padding: 4px 6px; border: 1px solid #ead9b5; border-radius: 6px; box-sizing: border-box; }
`;

export function audioReviewScreen(): HTMLElement {
  setSoundEnabled(true);
  const voice = kanaVoiceCredit() ?? "clips";
  const KEY = `hb-audio-review:${voice}`;
  const saved: Record<string, Saved> = (() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "{}");
    } catch {
      return {};
    }
  })();
  const cards = new Map<string, HTMLElement>();
  const flagEls = new Map<string, HTMLElement>();
  const numEls = new Map<string, HTMLElement>();
  const count = h("span", { class: "count" });

  const persist = () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const done = ALL.filter((k) => saved[k]?.verdict).length;
    const pass = ALL.filter((k) => saved[k]?.verdict === "pass").length;
    count.textContent = `${done}/${ALL.length} reviewed · ${pass} pass`;
    for (const [k, c] of cards) c.className = `card ${saved[k]?.verdict ?? ""}`;
  };

  const play = async (k: string) => {
    unlockAudio();
    for (const c of cards.values()) c.classList.remove("playing");
    cards.get(k)?.classList.add("playing");
    await sayKana(k);
    cards.get(k)?.classList.remove("playing");
  };

  let playingAll = false;
  const playAllBtn: HTMLButtonElement = h(
    "button",
    {
      onclick: async () => {
        if (playingAll) return void (playingAll = false);
        playingAll = true;
        playAllBtn.textContent = "■ Stop";
        for (const k of ORDER) {
          if (!playingAll) break;
          cards.get(k)?.scrollIntoView({ block: "center", behavior: "smooth" });
          await play(k);
          await new Promise((r) => setTimeout(r, 500));
        }
        playingAll = false;
        playAllBtn.textContent = "▶ Play all";
      },
    },
    "▶ Play all",
  );

  const sheet = (): ReviewRow[] =>
    ORDER.map((k) => ({
      kana: k,
      romaji: romajiOf(k) ?? "",
      playsAs: soundOf(k) === k ? "" : soundOf(k),
      file: kanaClipFile(k) ?? "(no clip: speech only)",
      verdict: saved[k]?.verdict ?? "",
      note: saved[k]?.note ?? "",
      flags: flagEls.get(k)?.dataset.flags ?? "",
    }));

  const download = (name: string, text: string, type: string) => {
    const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const today = new Date().toISOString().slice(0, 10);

  const card = (k: string) => {
    const v = saved[k]?.verdict ?? "";
    const set = (patch: Partial<Saved>) => {
      saved[k] = { verdict: saved[k]?.verdict ?? "", note: saved[k]?.note ?? "", ...patch };
      persist();
    };
    const nums = h("div", { class: "num" }, "…");
    const flags = h("div", { class: "flags" });
    numEls.set(k, nums);
    flagEls.set(k, flags);
    const twin = soundOf(k) !== k ? ` · plays ${soundOf(k)}` : "";
    const el = h(
      "div",
      { class: `card ${v}`, "data-kana": k },
      h(
        "div",
        { class: "top" },
        h("button", { class: "play", "aria-label": `Play ${k}`, onclick: () => void play(k) }, kanaSvg(k)),
        h("div", { class: "name" }, h("b", null, romajiOf(k) ?? k), h("small", null, (kanaClipFile(k) ?? "no clip") + twin)),
      ),
      nums,
      flags,
      LISTEN_FOR[k] ? h("div", { class: "hint" }, LISTEN_FOR[k]) : null,
      h(
        "div",
        { class: "seg" },
        (["pass", "fix", "replace"] as const).map((opt) =>
          h(
            "label",
            { "data-v": opt },
            h("input", { type: "radio", name: `v-${k}`, checked: v === opt, onchange: () => set({ verdict: opt }) }),
            opt[0].toUpperCase() + opt.slice(1),
          ),
        ),
      ),
      h("input", {
        class: "note",
        value: saved[k]?.note ?? "",
        placeholder: "what's wrong?",
        oninput: (e: Event) => set({ note: (e.target as HTMLInputElement).value }),
      }),
    );
    cards.set(k, el);
    return el;
  };

  const el = h(
    "div",
    { class: "ar" },
    h("style", null, CSS),
    h("h1", null, `Audio review: ${voice}`),
    h(
      "p",
      { class: "sub" },
      "Dev only. Tap a letter to hear it, listen for the blue note, then mark it. ",
      "Numbers are measured from the file: sound length · quiet before/after · peak dBFS · loudness vs the median. ",
      "Listen for clipped endings and trailing breaths too.",
    ),
    h(
      "div",
      { class: "bar" },
      playAllBtn,
      h("button", { onclick: () => download(`audio-review-${today}.json`, JSON.stringify({ voice, reviewedAt: new Date().toISOString(), clips: sheet() }, null, 2), "application/json") }, "Export JSON"),
      h("button", { onclick: () => download(`audio-review-${today}.csv`, toCsv(sheet()), "text/csv") }, "Export CSV"),
      count,
    ),
    h("h2", null, "Listen to these first"),
    h("div", { class: "grid" }, FIRST.map(card)),
    h("h2", null, "Everything else"),
    h("div", { class: "grid" }, ORDER.slice(FIRST.length).map(card)),
  );

  persist();
  void measure();

  async function measure() {
    const stats = new Map<string, ClipStats>();
    await Promise.all(
      ALL.map(async (k) => {
        const b = await kanaClipBuffer(k);
        if (b) stats.set(k, clipStats(b.getChannelData(0), b.sampleRate));
      }),
    );
    const med = median([...stats.values()].map((s) => s.loudnessDb));
    for (const k of ALL) {
      const st = stats.get(k);
      const nums = numEls.get(k)!;
      const flags = flagEls.get(k)!;
      if (!st) {
        nums.textContent = "no clip";
        flags.textContent = flags.dataset.flags = "speech fallback only";
        continue;
      }
      const ms = (x: number) => Math.round(x * 1000);
      const off = st.loudnessDb - med;
      nums.textContent = `${ms(st.sound)} ms · ${ms(st.lead)}/${ms(st.tail)} ms · ${st.peakDb.toFixed(1)} · ${off >= 0 ? "+" : ""}${off.toFixed(1)} dB`;
      const f = flagsFor(st, med).map((x) => x.text);
      flags.textContent = flags.dataset.flags = f.join("; ");
    }
  }

  return el;
}
