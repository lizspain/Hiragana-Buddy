// Word entry (for the grown-up): English word/name or romaji → editable kana tiles.

import type { Nav, Screen } from "../app";
import { isTeachable, loadDictionary, romajiOf } from "../data";
import { convertInput } from "../engine/convert";
import { expandLongVowel, limitMorae, MAX_MORAE, moraCount, toGlyphs } from "../engine/kana";
import { sayKana, sayWord, unlockAudio } from "../ui/audio";
import { h, ICON, iconButton, kanaSvg, modal } from "../ui/dom";
import { getSettings } from "../store";
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
  const count = h("p", { class: "mora-count" });
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
      hint.prepend(
        r.leftovers
          ? "Spelled by sound. Some letters didn't fit, so check the tiles, or type it how it sounds, like e-mi-ri. "
          : "Spelled by sound. Check the tiles below. ",
      );
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
    choices.replaceChildren();
    if (japanese) {
      const sound = glyphsOf(soundSpelling);
      const jp = glyphsOf(japanese);
      const same = (a: string[]) => a.join("") === tiles.join("");
      choices.append(
        h("span", { class: "choices-label" }, "Write:"),
        h("button", { class: `chip${same(sound) ? " on" : ""}`, onclick: () => ((source = "english"), setTilesKeep(sound)) }, "Sounds like ", h("b", { lang: "ja" }, soundSpelling)),
        h("button", { class: `chip${same(jp) ? " on" : ""}`, onclick: () => ((source = "japanese"), setTilesKeep(jp)) }, "Japanese word ", h("b", { lang: "ja" }, japanese)),
      );
    }

    row.replaceChildren(
      ...tiles.map((k, i) => {
        const t = h("button", { class: `tile${i === selected ? " selected" : ""}`, "aria-label": k, "data-kana": k }, kanaSvg(k));
        dragTile(t, i);
        return t;
      }),
      h("button", { class: "tile add", "aria-label": "Add a letter", html: ICON.plus, onclick: () => openChart(-1) }),
    );

    tools.replaceChildren();
    if (selected >= 0) {
      tools.append(
        h("button", { class: "pill-btn", onclick: () => openChart(selected) }, h("span", { html: ICON.swap }), "Change"),
        h(
          "button",
          {
            class: "pill-btn soft",
            onclick: () => {
              tiles.splice(selected, 1);
              selected = -1;
              render();
            },
          },
          h("span", { html: ICON.trash }),
          "Remove",
        ),
      );
    }
    if (tiles.length) {
      tools.append(h("button", { class: "pill-btn soft", onclick: () => (unlockAudio(), sayWord(tiles)) }, h("span", { html: ICON.speaker }), "Hear it"));
    }

    const m = moraCount(tiles);
    count.textContent = tiles.length ? `${m} / ${MAX_MORAE} sounds` : "";
    start.disabled = !tiles.length || m > MAX_MORAE;
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
        selected = selected === i ? -1 : i;
        return render();
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

  input.addEventListener("input", () => void convert());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });

  const el = h(
    "div",
    { class: "screen entry" },
    h("header", { class: "topbar" }, iconButton(ICON.back, "Back", () => nav.home(), "home"), h("h2", null, "Type a word or name")),
    h(
      "main",
      { class: "entry-body" },
      h("p", { class: "for-grownups" }, "For grown-ups: type a name or word in English, or how it sounds (ne-ko). Check the letters, then hand over."),
      input,
      hint,
      choices,
      row,
      tools,
      count,
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
  };
}
