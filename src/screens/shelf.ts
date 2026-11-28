// The practised-words shelf: one card per saved word, newest first, with its
// best stars. Tapping a card practises it again; its play button only says it.
// Shown on the word entry page (moved from home, Nov 2026). Single letters have
// no card: their stars show on the One kana chart instead.

import type { Nav } from "../app";
import { sayWord, unlockAudio } from "../ui/audio";
import { h, ICON, kanaSvg, stars } from "../ui/dom";
import { bestStars, getItems } from "../store";

export function wordShelf(nav: Nav): { el: HTMLElement | null; mounted: () => void } {
  const items = getItems().filter((it) => it.kind === "word");
  // Word cards built from letters picked one by one (nothing typed, or only the
  // kana themselves) show their romaji instead, filled in once WanaKana loads.
  const romajiLater: { el: HTMLElement; kana: string }[] = [];

  const el = items.length
    ? h(
        "section",
        { class: "shelf", "aria-label": "Words you practised" },
        items.slice(0, 30).map((it) => {
          // What the grown-up typed (English or romaji).
          const label = it.input && it.input !== it.kana.join("") ? it.input : "";
          return h(
            "div",
            { class: "shelf-card", "data-testid": "shelf-card" },
            h(
              "button",
              {
                class: "shelf-main",
                "aria-label": `Practise ${label || it.kana.join("")}`,
                onclick: () => {
                  unlockAudio();
                  nav.write({ kind: it.kind, kana: it.kana, input: it.input, mode: it.mode });
                },
              },
              h("div", { class: "shelf-kana" }, it.kana.map((k) => kanaSvg(k))),
              (() => {
                const span = h("span", { class: "shelf-label" }, label || " ");
                if (!label) romajiLater.push({ el: span, kana: it.kana.join("") });
                return span;
              })(),
              stars(bestStars(it), "stars small"),
            ),
            h(
              "button",
              {
                class: "shelf-play",
                "aria-label": "Play it",
                "data-quiet": "",
                onclick: () => {
                  unlockAudio();
                  sayWord(it.kana);
                },
              },
              h("span", { class: "shelf-play-icon", html: ICON.speaker }),
            ),
          );
        }),
      )
    : null;

  return {
    el,
    mounted() {
      if (romajiLater.length)
        void import("wanakana").then(({ toRomaji }) => romajiLater.forEach(({ el: span, kana }) => (span.textContent = toRomaji(kana))));
    },
  };
}
