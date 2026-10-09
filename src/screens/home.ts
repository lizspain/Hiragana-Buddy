import type { Nav, Screen } from "../app";
import { romajiOf } from "../data";
import { sayWord, unlockAudio } from "../ui/audio";
import { h, holdButton, html, ICON, kanaSvg, mascot, modal, stars } from "../ui/dom";
import { bestStars, getItems, getSettings, saveSettings } from "../store";

export const INK_COLORS = ["#f28c28", "#e85d9b", "#3e8ede", "#33a167", "#8a5cd6"];

export function homeScreen(nav: Nav): Screen {
  const settings = getSettings();
  const items = getItems();

  const swatches = h(
    "div",
    { class: "swatches", role: "radiogroup", "aria-label": "Ink colour" },
    INK_COLORS.map((c) =>
      h("button", {
        class: `swatch${c === settings.inkColor ? " on" : ""}`,
        style: `--c:${c}`,
        role: "radio",
        "aria-checked": String(c === settings.inkColor),
        "aria-label": "Ink colour",
        onclick: (e: MouseEvent) => {
          void saveSettings({ inkColor: c });
          swatches.querySelectorAll(".swatch").forEach((s) => {
            s.classList.toggle("on", s === e.currentTarget);
            s.setAttribute("aria-checked", String(s === e.currentTarget));
          });
        },
      }),
    ),
  );

  const shelf = items.length
    ? h(
        "section",
        { class: "shelf", "aria-label": "Words you practised" },
        items.slice(0, 30).map((it) => {
          // Words show what the grown-up typed (English or romaji); letters show their sound (shi).
          const label =
            it.kind === "word" ? (it.input && it.input !== it.kana.join("") ? it.input : "") : romajiOf(it.kana[0]) ?? "";
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
              label ? h("span", { class: "shelf-label" }, label) : null,
              stars(bestStars(it), "stars small"),
            ),
            h(
              "button",
              {
                class: "shelf-play",
                "aria-label": "Play it",
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

  const el = h(
    "div",
    { class: "screen home" },
    h(
      "header",
      { class: "home-head" },
      mascot("mascot bob"),
      h("div", { class: "title" }, h("h1", null, "Hiragana Buddy"), h("p", { class: "subtitle", lang: "ja" }, "ひらがな の ともだち")),
      holdButton(ICON.gear, "Grown-ups", 1500, () => nav.parent()),
    ),
    h(
      "nav",
      { class: "big-choices" },
      h(
        "button",
        {
          class: "big-btn word",
          "data-testid": "go-word",
          onclick: () => {
            unlockAudio();
            nav.entry();
          },
        },
        html(`<span class="big-icon">${ICON.wordBubble}</span>`),
        h("span", { class: "big-label" }, "Write a word"),
      ),
      h(
        "button",
        {
          class: "big-btn letter",
          "data-testid": "go-letter",
          onclick: () => {
            unlockAudio();
            nav.chart();
          },
        },
        h("span", { class: "big-icon tile" }, kanaSvg("あ")),
        h("span", { class: "big-label" }, "One letter"),
      ),
    ),
    swatches,
    shelf,
  );

  return {
    el,
    mounted() {
      maybeShowInstallTip();
    },
  };
}

/** One-time "Add to Home Screen" tip for iPhone/iPad Safari (keeps history safe). */
function maybeShowInstallTip() {
  const s = getSettings();
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;
  if (!iOS || standalone || s.iosTipShown) return;
  void saveSettings({ iosTipShown: true });
  const m = modal(
    h(
      "div",
      { class: "tip" },
      h("p", { class: "tip-title" }, "For grown-ups: keep your stars safe"),
      h(
        "div",
        { class: "tip-steps" },
        h("div", { class: "tip-step" }, html(`<span class="tip-icon">${ICON.share}</span>`), h("span", null, "Tap Share")),
        h("div", { class: "tip-arrow", html: ICON.back }),
        h("div", { class: "tip-step" }, html(`<span class="tip-icon">${ICON.addSquare}</span>`), h("span", null, "Add to Home Screen")),
      ),
      h("p", { class: "tip-small" }, "Safari can clear saved progress after a week away. The Home Screen app keeps it."),
      h("button", { class: "pill-btn", onclick: () => m.close() }, "OK"),
    ),
  );
}
