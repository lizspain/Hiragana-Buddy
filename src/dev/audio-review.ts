// Dev-only audio review page. Open tools/audio-review.html on the dev server
// (npm run dev → /tools/audio-review.html), or /#audio-review. Never in the
// production build: Vite only builds index.html, and main.ts imports this
// behind import.meta.env.DEV.
//
// Every kana Listen & Match can ask for (46 basic + 25 voiced), then Make a
// Word's 33 word clips (one per picture), each as a card: play it, read the
// measurements and the "listen for" note, mark Pass / Fix / Replace with a
// note. The clips most likely to be wrong come first. Marks stay in this
// browser (one set per voice); "Export JSON" and "Export CSV" download the
// review sheet.

import { soundOf } from "../audio-lines";
import { charts, romajiOf } from "../data";
import { HIDDEN_KANA } from "../engine/kana";
import { h, kanaSvg } from "../ui/dom";
import { kanaClipBuffer, kanaClipFile, kanaVoiceCredit, sayKana, sayVocab, setSoundEnabled, unlockAudio, vocabClipBuffer, vocabClipFile } from "../ui/audio";
import { VOCAB_WORDS } from "../vocab/stages";
import { clipStats, flagsFor, LISTEN_FOR, median, toCsv, type ClipStats, type ReviewRow, type Verdict } from "./clip-stats";

const ALL_KANA: string[] = [...charts.basic.flat(), ...charts.voiced.flat()].filter((k): k is string => !!k && !HIDDEN_KANA.has(k));
/** Checked first: ふ, the r-row, し/ち/つ, ん, う. */
const FIRST_KANA = [..."ふらりるれろしちつんう"];

/** One card: a kana clip or a word clip. */
interface Entry {
  key: string;
  face: string[];
  title: string;
  sub: string;
  hint?: string;
  file?: string;
  romaji: string;
  playsAs: string;
  word: boolean;
  play: () => Promise<void>;
  buffer: () => Promise<AudioBuffer | null>;
}

const kanaEntry = (k: string): Entry => ({
  key: k,
  face: [k],
  title: romajiOf(k) ?? k,
  sub: (kanaClipFile(k) ?? "no clip") + (soundOf(k) !== k ? ` · plays ${soundOf(k)}` : ""),
  hint: LISTEN_FOR[k],
  file: kanaClipFile(k),
  romaji: romajiOf(k) ?? "",
  playsAs: soundOf(k) === k ? "" : soundOf(k),
  word: false,
  play: () => sayKana(k),
  buffer: () => kanaClipBuffer(k),
});

/** Look and Write: what to listen for beyond the clip itself. */
const WORD_NOTES: Record<string, string> = {
  "ha.mp3": "“ha”, not the particle “wa”.",
  "te.mp3": "Said as the word “hand”, not just the letter.",
  "ki.mp3": "Said as the word “tree”, not just the letter.",
  "me.mp3": "Said as the word “eye”, not just the letter.",
  "ka.mp3": "Said as the word “mosquito”, not just the letter.",
  "kuma.mp3": "Engine's own pitch (high-low): check it.",
  "koma.mp3": "Engine's own pitch (low-high): check it.",
  "shika.mp3": "Engine's own pitch (low-high): check it.",
  "tomato.mp3": "Engine's own pitch (high-low-low): check it.",
};

/** Built when the page opens, after the clip lists have loaded. */
const makeWordEntries = (): Entry[] =>
  VOCAB_WORDS.flatMap((w) =>
    w.senses.map((s) => {
      const meaning = s.meaning ?? w.meaning;
      const pitch = s.pitch ? `Pitch: ${s.pitch}.` : "";
      return {
        key: `word:${s.clip}`,
        face: w.kana,
        title: `${w.kana.join("")} · ${meaning}`,
        sub: `${vocabClipFile(s.clip) ?? "no clip"} · stage ${w.stage}`,
        hint: [pitch, WORD_NOTES[s.clip]].filter(Boolean).join(" ") || undefined,
        file: vocabClipFile(s.clip),
        romaji: w.id,
        playsAs: meaning,
        word: true,
        play: () => sayVocab(s.clip, w.kana),
        buffer: () => vocabClipBuffer(s.clip),
      };
    }),
  );

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
.ar .play { min-width: 64px; height: 64px; border-radius: 14px; padding: 6px; display: flex; gap: 2px; place-items: center; }
.ar .play svg { width: 50px; height: 50px; fill: none; stroke: #3b2f1e; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
.ar .play.word svg { width: 34px; height: 34px; }
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
  const kana = ALL_KANA.map(kanaEntry);
  const wordEntries = makeWordEntries();
  /** Checked first: pitch set by hand (the meaning depends on it), the one-kana words, and the ones the engine pitched alone. */
  const FIRST_WORDS = wordEntries.filter((e) => e.hint);
  const firstKana = FIRST_KANA.map(kanaEntry);
  const restKana = kana.filter((e) => !FIRST_KANA.includes(e.key));
  const restWords = wordEntries.filter((e) => !FIRST_WORDS.includes(e));
  const order = [...firstKana, ...restKana, ...FIRST_WORDS, ...restWords];
  const all = [...kana, ...wordEntries];

  const cards = new Map<string, HTMLElement>();
  const flagEls = new Map<string, HTMLElement>();
  const numEls = new Map<string, HTMLElement>();
  const count = h("span", { class: "count" });

  const persist = () => {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const done = all.filter((e) => saved[e.key]?.verdict).length;
    const pass = all.filter((e) => saved[e.key]?.verdict === "pass").length;
    count.textContent = `${done}/${all.length} reviewed · ${pass} pass`;
    for (const [k, c] of cards) c.className = `card ${saved[k]?.verdict ?? ""}`;
  };

  const play = async (e: Entry) => {
    unlockAudio();
    for (const c of cards.values()) c.classList.remove("playing");
    cards.get(e.key)?.classList.add("playing");
    await e.play();
    cards.get(e.key)?.classList.remove("playing");
  };

  let playingAll = false;
  const playAllBtn: HTMLButtonElement = h(
    "button",
    {
      onclick: async () => {
        if (playingAll) return void (playingAll = false);
        playingAll = true;
        playAllBtn.textContent = "■ Stop";
        for (const e of order) {
          if (!playingAll) break;
          cards.get(e.key)?.scrollIntoView({ block: "center", behavior: "smooth" });
          await play(e);
          await new Promise((r) => setTimeout(r, 500));
        }
        playingAll = false;
        playAllBtn.textContent = "▶ Play all";
      },
    },
    "▶ Play all",
  );

  const sheet = (): ReviewRow[] =>
    order.map((e) => ({
      kana: e.face.join(""),
      romaji: e.romaji,
      playsAs: e.playsAs,
      file: e.file ?? "(no clip: speech only)",
      verdict: saved[e.key]?.verdict ?? "",
      note: saved[e.key]?.note ?? "",
      flags: flagEls.get(e.key)?.dataset.flags ?? "",
    }));

  const download = (name: string, text: string, type: string) => {
    const a = h("a", {
      href: URL.createObjectURL(new Blob([text], { type })),
      download: name,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const today = new Date().toISOString().slice(0, 10);

  const card = (e: Entry) => {
    const k = e.key;
    const v = saved[k]?.verdict ?? "";
    const set = (patch: Partial<Saved>) => {
      saved[k] = {
        verdict: saved[k]?.verdict ?? "",
        note: saved[k]?.note ?? "",
        ...patch,
      };
      persist();
    };
    const nums = h("div", { class: "num" }, "…");
    const flags = h("div", { class: "flags" });
    numEls.set(k, nums);
    flagEls.set(k, flags);
    const el = h(
      "div",
      { class: `card ${v}`, "data-key": k },
      h(
        "div",
        { class: "top" },
        h(
          "button",
          {
            class: e.word ? "play word" : "play",
            "aria-label": `Play ${e.face.join("")}`,
            onclick: () => void play(e),
          },
          e.face.map((x) => kanaSvg(x)),
        ),
        h("div", { class: "name" }, h("b", null, e.title), h("small", null, e.sub)),
      ),
      nums,
      flags,
      e.hint ? h("div", { class: "hint" }, e.hint) : null,
      h(
        "div",
        { class: "seg" },
        (["pass", "fix", "replace"] as const).map((opt) =>
          h(
            "label",
            { "data-v": opt },
            h("input", {
              type: "radio",
              name: `v-${k}`,
              checked: v === opt,
              onchange: () => set({ verdict: opt }),
            }),
            opt[0].toUpperCase() + opt.slice(1),
          ),
        ),
      ),
      h("input", {
        class: "note",
        value: saved[k]?.note ?? "",
        placeholder: "what's wrong?",
        oninput: (ev: Event) => set({ note: (ev.target as HTMLInputElement).value }),
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
      "Dev only. Tap a card to hear it, listen for the blue note, then mark it. ",
      "Numbers are measured from the file: sound length · quiet before/after · peak dBFS · loudness vs the kana clips' median. ",
      "Listen for clipped endings and trailing breaths too.",
    ),
    h(
      "div",
      { class: "bar" },
      playAllBtn,
      h(
        "button",
        {
          onclick: () =>
            download(
              `audio-review-${today}.json`,
              JSON.stringify({ voice, reviewedAt: new Date().toISOString(), clips: sheet() }, null, 2),
              "application/json",
            ),
        },
        "Export JSON",
      ),
      h(
        "button",
        {
          onclick: () => download(`audio-review-${today}.csv`, toCsv(sheet()), "text/csv"),
        },
        "Export CSV",
      ),
      count,
    ),
    h("h2", null, "Kana: listen to these first"),
    h("div", { class: "grid", "data-testid": "review-kana-first" }, firstKana.map(card)),
    h("h2", null, "Kana: everything else"),
    h("div", { class: "grid" }, restKana.map(card)),
    h("h2", null, "Look and Write: listen to these first (pitch and one-kana words)"),
    h("div", { class: "grid", "data-testid": "review-words-first" }, FIRST_WORDS.map(card)),
    h("h2", null, "Look and Write: the other words"),
    h("div", { class: "grid", "data-testid": "review-words" }, restWords.map(card)),
  );

  persist();
  void measure();

  async function measure() {
    const stats = new Map<string, ClipStats>();
    await Promise.all(
      all.map(async (e) => {
        const b = await e.buffer();
        if (b) stats.set(e.key, clipStats(b.getChannelData(0), b.sampleRate));
      }),
    );
    // Words are matched to the kana clips' loudness, so both compare against the kana median.
    const med = median(kana.map((e) => stats.get(e.key)?.loudnessDb ?? NaN));
    for (const e of all) {
      const st = stats.get(e.key);
      const nums = numEls.get(e.key)!;
      const flags = flagEls.get(e.key)!;
      if (!st) {
        nums.textContent = "no clip";
        flags.textContent = flags.dataset.flags = "speech fallback only";
        continue;
      }
      const ms = (x: number) => Math.round(x * 1000);
      const off = st.loudnessDb - med;
      nums.textContent = `${ms(st.sound)} ms · ${ms(st.lead)}/${ms(st.tail)} ms · ${st.peakDb.toFixed(1)} · ${off >= 0 ? "+" : ""}${off.toFixed(1)} dB`;
      const f = flagsFor(st, med, { length: !e.word }).map((x) => x.text);
      flags.textContent = flags.dataset.flags = f.join("; ");
    }
  }

  return el;
}
