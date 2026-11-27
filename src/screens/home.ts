import type { Nav, Screen } from "../app";
import { setSoundEnabled, unlockAudio } from "../ui/audio";
import { h, holdButton, html, ICON, kanaSvg, mascot, modal, stars } from "../ui/dom";
import { getSettings, matchBestStars, saveSettings } from "../store";
import { currentStone, pathState } from "../match/progress";
import { PATH_SETS } from "../match/sets";

export function homeScreen(nav: Nav): Screen {
  const el = h(
    "div",
    { class: "screen home" },
    h(
      "header",
      { class: "home-head" },
      h(
        "div",
        { class: "brand-lockup" },
        mascot("mascot"),
        h(
          "div",
          { class: "title" },
          h("h1", null, h("span", null, "Hiragana"), " ", h("span", null, "Buddy")),
          h("p", { class: "subtitle", lang: "ja" }, "ひらがな の ともだち"),
        ),
      ),
      holdButton(ICON.gear, "Settings", 1500, () => nav.parent()),
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
      getSettings().matchGame ? listenButton(nav) : null,
    ),
  );

  return {
    el,
    mounted() {
      maybeShowInstallTip();
    },
  };
}

/**
 * Listen & Match can't be played silent: with sound off the button wears a
 * crossed-out speaker, and tapping it turns sound back on before the game opens.
 */
function listenButton(nav: Nav): HTMLButtonElement {
  const muted = !getSettings().sound;
  return h(
    "button",
    {
      class: "big-btn listen",
      "data-testid": "go-listen",
      onclick: () => {
        if (!getSettings().sound) {
          setSoundEnabled(true);
          void saveSettings({ sound: true });
        }
        unlockAudio();
        nav.path();
      },
    },
    html(`<span class="big-icon">${ICON.ear}</span>`),
    h("span", { class: "big-label" }, "Listen & Match", h("small", { lang: "ja" }, "きいて えらぼう")),
    listenStars(),
    muted ? html(`<span class="muted-badge" aria-label="Sound is off">${ICON.soundOff}</span>`) : null,
  );
}

/** The stone the child is on, with its best stars (same style as the word cards). */
function listenStars(): HTMLElement {
  const stones = pathState(PATH_SETS.map((s) => s.id), matchBestStars, getSettings().unlockPath);
  const i = currentStone(stones);
  return h("span", { class: "listen-progress", "data-testid": "listen-progress" }, h("span", { class: "listen-stone" }, kanaSvg(PATH_SETS[i].kana[0])), stars(stones[i].best, "stars small"));
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
