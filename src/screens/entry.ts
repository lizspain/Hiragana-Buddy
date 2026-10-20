// Word entry (for the grown-up): English word/name or romaji → editable kana tiles.

import type { Nav, Screen } from "../app";
import { isTeachable, loadDictionary, romajiOf } from "../data";
import { convertInput } from "../engine/convert";
import { pickHeard } from "../engine/heard";
import { expandLongVowel, limitMorae, MAX_MORAE, moraCount, toGlyphs } from "../engine/kana";
import { sayKana, sayWord, unlockAudio } from "../ui/audio";
import { h, ICON, iconButton, kanaSvg, modal } from "../ui/dom";
import { getSettings } from "../store";
import { installLanguages, Listening, readiness, type ListenLang } from "../ui/listen";
import { kanaChart } from "./chart";

export function entryScreen(nav: Nav): Screen {
  let tiles: string[] = [];
  let source: "english" | "romaji" | "japanese" = "english";
  let selected = -1;
  let japanese: string | undefined;
  let soundSpelling = "";
  let seq = 0;

  const input = h("input", {
    class: "word-input",
    type: "text",
    placeholder: "Emma, dinosaur, neko…",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: false,
    enterkeyhint: "done",
    "aria-label": "Word or name",
    "data-testid": "word-input",
  });
  const hint = h("p", { class: "hint", "aria-live": "polite", "data-testid": "hint" });
  const choices = h("div", { class: "choices" });
  const row = h("div", { class: "tile-row", "data-testid": "tiles" });
  const tools = h("div", { class: "tile-tools" });
  const start = h(
    "button",
    {
      class: "start-btn",
      "data-testid": "start",
      "aria-label": "Start",
      onclick: () => {
        if (!tiles.length) return;
        unlockAudio();
        nav.write({ kind: "word", kana: [...tiles], input: input.value.trim() || tiles.join(""), mode: source });
      },
    },
    h("span", { html: ICON.play }),
    "Start",
  );

  /** English dictionary first; anything it doesn't know is spelled by sound. */
  async function convert() {
    const my = ++seq;
    const text = input.value;
    japanese = undefined;
    hint.textContent = "";
    if (!text.trim()) return setTiles([]);
    const [dict, { toHiragana }] = await Promise.all([loadDictionary(), import("wanakana")]);
    if (my !== seq) return;
    const r = convertInput(text, dict, toHiragana);
    soundSpelling = r.hiragana;
    japanese = r.japanese;
    source = r.source;
    setTiles(glyphsOf(r.hiragana));
    if (r.bySound.length && tiles.length) {
      if (r.leftovers) hint.prepend("Spelled by sound. Some letters didn't fit, so check the tiles, or type it how it sounds, like e-mi-ri. ");
    } else if (r.bySound.length) {
      hint.textContent = "Type it how it sounds, like e-mi-ri or ne-ko.";
    }
  }

  function glyphsOf(s: string): string[] {
    let g = toGlyphs(s, isTeachable);
    if (getSettings().expandLongVowel) g = expandLongVowel(g, romajiOf);
    return g;
  }

  function setTiles(next: string[]) {
    const all = next;
    tiles = limitMorae(all);
    if (moraCount(all) > MAX_MORAE) hint.textContent = "That's a long one! Let's pick part of it. You can change the tiles below.";
    selected = -1;
    render();
  }

  function render() {
    renderChoices();
    row.replaceChildren(
      ...tiles.map((k, i) => {
        const t = h("button", { class: `tile${i === selected ? " selected" : ""}`, "aria-label": k, "data-kana": k }, kanaSvg(k));
        dragTile(t, i);
        return t;
      }),
      // At the limit, the add tile gives way to a note saying so.
      moraCount(tiles) >= MAX_MORAE
        ? h("p", { class: "max-reached", "data-testid": "max-reached" }, `Max ${MAX_MORAE} sounds`)
        : h("button", { class: "tile add", "aria-label": "Add a letter", html: ICON.plus, onclick: () => openChart(-1) }),
    );
    renderTools();
    start.disabled = !tiles.length || moraCount(tiles) > MAX_MORAE;
  }

  /** Built once per conversion, then only the "on" chip changes, so it can fade across. */
  let choicesKey = "";
  function renderChoices() {
    const key = japanese ? `${soundSpelling}|${japanese}` : "";
    if (key !== choicesKey) {
      choicesKey = key;
      choices.replaceChildren();
      if (japanese) {
        const sound = glyphsOf(soundSpelling);
        const jp = glyphsOf(japanese);
        choices.append(
          h("span", { class: "choices-label" }, "Write:"),
          h("button", { class: "chip", "data-glyphs": sound.join(""), onclick: () => ((source = "english"), setTilesKeep(sound)) }, "Sounds like ", h("b", { lang: "ja" }, soundSpelling)),
          h("button", { class: "chip", "data-glyphs": jp.join(""), onclick: () => ((source = "japanese"), setTilesKeep(jp)) }, "Japanese word ", h("b", { lang: "ja" }, japanese)),
        );
      }
    }
    choices.querySelectorAll<HTMLElement>(".chip").forEach((c) => c.classList.toggle("on", c.dataset.glyphs === tiles.join("")));
  }

  /** Tap a tile: move the selection ring in place (no rebuild) and update the tools. */
  function select(i: number) {
    selected = i;
    row.querySelectorAll(".tile:not(.add)").forEach((t, j) => t.classList.toggle("selected", j === i));
    renderTools();
  }

  // Tools that have just appeared pop in; ones already showing stay still.
  let hadEdit = false;
  let hadHear = false;
  function renderTools() {
    const edit = selected >= 0;
    const hear = tiles.length > 0;
    const pop = (b: HTMLElement, was: boolean) => (was || b.classList.add("pop-in"), b);
    tools.replaceChildren();
    if (edit) {
      tools.append(
        pop(
          h(
            "button",
            { class: "shelf-play hear-play", "aria-label": "Change", onclick: () => openChart(selected) },
            h("span", { class: "shelf-play-icon", html: ICON.swap }),
          ),
          hadEdit,
        ),
        pop(
          h(
            "button",
            {
              class: "shelf-play hear-play trash-btn",
              "aria-label": "Remove",
              onclick: () => {
                tiles.splice(selected, 1);
                selected = -1;
                render();
              },
            },
            h("span", { class: "shelf-play-icon", html: ICON.trash }),
          ),
          hadEdit,
        ),
      );
    }
    if (hear) {
      tools.append(
        pop(
          h(
            "button",
            { class: "shelf-play hear-play", "aria-label": "Hear it", "data-quiet": "", onclick: () => (unlockAudio(), sayWord(tiles)) },
            h("span", { class: "shelf-play-icon", html: ICON.speaker }),
          ),
          hadHear,
        ),
      );
    }
    hadEdit = edit;
    hadHear = hear;
  }

  function setTilesKeep(next: string[]) {
    tiles = limitMorae(next);
    selected = -1;
    render();
  }

  function openChart(at: number) {
    const m = modal(
      h(
        "div",
        { class: "chart-modal" },
        h("div", { class: "modal-head" }, iconButton(ICON.back, "Close", () => m.close())),
        kanaChart((k) => {
          if (at < 0) {
            if (moraCount([...tiles, k]) > MAX_MORAE) return m.close();
            tiles.push(k);
          } else tiles[at] = k;
          selected = -1;
          m.close();
          render();
        }),
      ),
    );
  }

  /** Tap: hear + select. Drag: reorder. */
  function dragTile(t: HTMLElement, i: number) {
    let sx = 0, sy = 0, id = -1, dragging = false;
    let rects: DOMRect[] = [];
    t.addEventListener("pointerdown", (e) => {
      id = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
      dragging = false;
      t.setPointerCapture(id);
    });
    t.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragging && Math.hypot(dx, dy) > 10) {
        dragging = true;
        rects = [...row.querySelectorAll<HTMLElement>(".tile:not(.add)")].map((x) => x.getBoundingClientRect());
        t.classList.add("dragging");
      }
      if (dragging) t.style.transform = `translate(${dx}px, ${dy}px) scale(1.08)`;
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      if (e.pointerId !== id) return;
      id = -1;
      if (!dragging) {
        if (cancelled) return;
        unlockAudio();
        sayKana(tiles[i]);
        return select(selected === i ? -1 : i);
      }
      let best = i, bestD = Infinity;
      rects.forEach((r, j) => {
        const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
        if (d < bestD) (bestD = d), (best = j);
      });
      const [k] = tiles.splice(i, 1);
      tiles.splice(best, 0, k);
      selected = -1;
      render();
    };
    t.addEventListener("pointerup", (e) => end(e, false));
    t.addEventListener("pointercancel", (e) => end(e, true));
  }

  // ---------- voice input (on-device only) ----------
  // Hold to talk, or tap to start and tap again to stop.
  const HOLD_MS = 400;
  const mic = h("button", { class: "mic-btn", "aria-label": "Say it", title: "Say it", "data-testid": "mic", html: ICON.mic });
  mic.hidden = true;
  let langs: { ready: ListenLang[]; installable: ListenLang[] } = { ready: [], installable: [] };
  let micState: "idle" | "preparing" | "starting" | "listening" | "working" = "idle";
  let listening: Listening | null = null;
  let downAt = 0;
  let swallowUp = false;
  let leaving = false;

  void readiness().then((r) => {
    langs = r;
    mic.hidden = !r.ready.length && !r.installable.length;
  });

  function setMic(s: typeof micState, msg?: string) {
    micState = s;
    mic.dataset.state = s;
    mic.classList.toggle("listening", s === "listening");
    mic.setAttribute("aria-pressed", String(s === "listening"));
    if (msg !== undefined) hint.textContent = msg;
  }

  async function startListening() {
    unlockAudio();
    if (langs.installable.length) {
      setMic("preparing", "Getting voice input ready. Your browser downloads its speech pack once…");
      const got = await installLanguages(langs.installable);
      langs = { ready: [...langs.ready, ...got], installable: [] };
      if (leaving) return;
    }
    if (!langs.ready.length) {
      mic.hidden = true;
      return setMic("idle", "Voice input isn't available on this device. Please type the word instead.");
    }
    setMic("starting");
    try {
      listening = await Listening.start(langs.ready);
    } catch (e) {
      const denied = e instanceof DOMException && /NotAllowed|Security/.test(e.name);
      return setMic("idle", denied ? "To use voice input, allow the microphone for this app." : "Voice input couldn't start. Please type the word instead.");
    }
    if (leaving) return listening.cancel();
    listening.onAutoStop = () => void stopListening();
    setMic("listening", "Listening… say the word, then let go (or tap again).");
  }

  async function stopListening() {
    if (micState !== "listening" || !listening) return;
    const l = listening;
    listening = null;
    setMic("working", "One moment…");
    const [heard, dict, { toRomaji }] = await Promise.all([l.stop(), loadDictionary(), import("wanakana")]);
    if (leaving) return;
    const known = (s: string) => s.split(" ").every((p) => !!(dict.names[p] ?? dict.words[p]));
    const picked = pickHeard(heard, known, toRomaji);
    setMic("idle");
    if (!picked) {
      hint.textContent = "I didn't catch that. Try again, or type the word.";
      return;
    }
    input.value = picked.text;
    await convert();
    hint.prepend(`Heard “${picked.heard}”. `);
  }

  mic.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (micState === "listening") {
      swallowUp = true; // second tap stops
      void stopListening();
      return;
    }
    if (micState !== "idle") return;
    downAt = e.timeStamp; // when the finger went down, not when we got round to handling it
    swallowUp = false;
    void startListening();
  });
  mic.addEventListener("pointerup", (e) => {
    if (swallowUp) return void (swallowUp = false);
    // Held down while listening → let go to stop. A quick tap keeps listening.
    if (micState === "listening" && e.timeStamp - downAt >= HOLD_MS) void stopListening();
  });
  mic.addEventListener("click", (e) => {
    // Keyboard (Enter/Space) toggles.
    if (e.detail !== 0) return;
    if (micState === "listening") void stopListening();
    else if (micState === "idle") {
      downAt = 0;
      void startListening();
    }
  });
  mic.addEventListener("contextmenu", (e) => e.preventDefault());

  input.addEventListener("input", () => void convert());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });

  const el = h(
    "div",
    { class: "screen entry" },
    h("header", { class: "topbar" }, iconButton(ICON.home, "Home", () => nav.home(), "home")),
    h(
      "main",
      { class: "entry-body" },
      // Title inside the content column so it lines up with the text and the input.
      h("h2", { class: "entry-title" }, "Type a word or name"),
      h("p", { class: "for-grownups" }, "Enter a name or word in English or type out how it sounds. Then tap Start."),
      h("div", { class: "input-row" }, input, mic),
      hint,
      choices,
      row,
      tools,
      start,
    ),
  );

  render();
  void loadDictionary();
  void import("wanakana");
  return {
    el,
    mounted() {
      if (matchMedia("(pointer: fine)").matches) input.focus();
    },
    destroy() {
      leaving = true;
      listening?.cancel();
    },
  };
}
