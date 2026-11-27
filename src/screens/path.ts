// Listen & Match: the set path (docs/LISTEN-MATCH.md "Getting in").
//
// Stepping stones, one per set, with the mascot standing on the current one
// (the first open stone without 3 stars), centred and bobbing: one tap on it
// starts a game, so a child never chooses from a grid. Each stone shows its
// set's first kana and three star outlines filled with its best result. A
// stone opens when the one before reaches 3 stars. Above the path, a short row
// of My word stones (the 3 most recently practised words) is always open.
//
// Arriving from a game, its new best stars fly onto its stone; if that stone
// just reached 3 stars, the next one flips open and the mascot hops onto it.

import "../match/path.css";
import type { Nav, Screen } from "../app";
import { currentStone, pathState, type StoneState } from "../match/progress";
import { PATH_SETS, wordSetId } from "../match/sets";
import { stepChime, unlockAudio } from "../ui/audio";
import { h, ICON, iconButton, kanaSvg, mascot } from "../ui/dom";
import { getItems, getSettings, matchBestStars } from "../store";

export interface PathArrival {
  setId: string;
  /** The set's best stars before the game just played. */
  before: 0 | 1 | 2 | 3;
}

/** My word stones shown above the path (decided 2026-11-25). */
const WORD_STONES = 3;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function pathScreen(nav: Nav, arrival?: PathArrival): Screen {
  const unlockAll = getSettings().unlockPath;
  const ids = PATH_SETS.map((s) => s.id);
  const real = (id: string) => matchBestStars(id);
  // Draw the path as it was before the game, then animate it to how it is now.
  const shown = (id: string) => (arrival && id === arrival.setId ? Math.min(arrival.before, real(id)) as 0 | 1 | 2 | 3 : real(id));
  const before = pathState(ids, shown, unlockAll);
  const after = pathState(ids, real, unlockAll);
  let alive = true;

  const stoneEls = new Map<string, HTMLButtonElement>();
  const go = (id: string) => () => {
    unlockAudio();
    nav.match(id);
  };

  // Only earned stars show (never empty outlines). Stars this visit has just
  // earned are there but hidden until each flies in; with none, a hidden
  // placeholder keeps the stone's shape.
  const starSlots = (shownBest: number, best: number) =>
    h(
      "span",
      { class: "stone-stars", "aria-hidden": "true" },
      best === 0
        ? h("span", { class: "star ghost", html: ICON.star })
        : Array.from({ length: best }, (_, i) => h("span", { class: `star ${i < shownBest ? "on" : "pending"}`, html: ICON.star })),
    );

  function pathStone(s: StoneState, i: number): HTMLElement {
    const set = PATH_SETS[i];
    const b = h(
      "button",
      {
        class: `stone${s.open ? "" : " locked"}`,
        "data-testid": "stone",
        "data-set": s.id,
        "data-open": String(s.open),
        "data-best": String(s.best),
        "aria-label": s.open ? `Play set ${i + 1}` : `Set ${i + 1}, not open yet`,
        disabled: !s.open,
        onclick: go(s.id),
      },
      h("span", { class: "stone-face" }, kanaSvg(set.kana[0])),
      starSlots(s.best, real(s.id)),
    );
    stoneEls.set(s.id, b);
    return h("li", { class: "stone-spot", style: `--i:${i}` }, b);
  }

  // ---------- My word row ----------

  const words = getItems()
    .filter((it) => it.kind === "word" && it.kana.length > 0)
    .slice(0, WORD_STONES);
  const wordRow = words.length
    ? h(
        "section",
        { class: "word-stones", "aria-label": "My words" },
        words.map((it) => {
          const id = wordSetId(it.kana);
          const best = shown(id);
          const b = h(
            "button",
            { class: "stone word", "data-testid": "word-stone", "data-set": id, "data-open": "true", "data-best": String(best), "aria-label": `Play ${it.input || it.kana.join("")}`, onclick: go(id) },
            h("span", { class: "stone-face" }, it.kana.slice(0, 3).map((k) => kanaSvg(k))),
            starSlots(best, real(id)),
          );
          stoneEls.set(id, b);
          return b;
        }),
      )
    : null;

  // ---------- the path ----------

  const trail = h("ol", { class: "trail" }, before.map(pathStone));
  const buddy = mascot("path-mascot");
  const placeBuddy = (i: number) => stoneEls.get(ids[i])!.parentElement!.appendChild(buddy);
  const markCurrent = (i: number) => {
    for (const [id, el] of stoneEls) el.classList.toggle("current", id === ids[i]);
  };
  const startAt = currentStone(before);
  placeBuddy(startAt);
  markCurrent(startAt);

  const el = h(
    "div",
    { class: "screen path", "data-testid": "path", "data-ready": "false" },
    h("header", { class: "topbar" }, iconButton(ICON.home, "Home", () => nav.home(), "home small")),
    wordRow,
    h("main", { class: "trail-wrap" }, trail),
  );

  // ---------- arrival ----------

  /** A star flies down from where the results showed it into its slot. */
  async function flyStar(slot: HTMLElement, step: number) {
    if (!reducedMotion()) {
      const to = slot.getBoundingClientRect();
      const fly = h("span", { class: "flying-star", html: ICON.star, "aria-hidden": "true" });
      document.body.appendChild(fly);
      const fromX = innerWidth / 2 - to.left - to.width / 2;
      const fromY = innerHeight * 0.3 - to.top - to.height / 2;
      Object.assign(fly.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
      await fly
        .animate(
          [
            { transform: `translate(${fromX}px, ${fromY}px) scale(3)`, opacity: 0 },
            { transform: `translate(${fromX * 0.4}px, ${fromY * 0.4 - 40}px) scale(2)`, opacity: 1, offset: 0.4 },
            { transform: "none", opacity: 1 },
          ],
          { duration: 600, easing: "cubic-bezier(.45,0,.3,1)" },
        )
        .finished.catch(() => undefined);
      fly.remove();
    }
    slot.classList.replace("pending", "on");
    slot.classList.add("landed");
    stepChime(step);
  }

  async function hopTo(i: number) {
    const from = buddy.getBoundingClientRect();
    placeBuddy(i);
    markCurrent(i);
    stoneEls.get(ids[i])!.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    if (reducedMotion()) return;
    const to = buddy.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    await buddy
      .animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: `translate(${dx / 2}px, ${dy / 2 - 70}px)`, offset: 0.5 },
          { transform: "none" },
        ],
        { duration: 650, easing: "ease-in-out" },
      )
      .finished.catch(() => undefined);
  }

  async function arrive() {
    if (!arrival) return;
    const stone = stoneEls.get(arrival.setId);
    const now = real(arrival.setId);
    if (stone && now > arrival.before) {
      stone.scrollIntoView({ block: "center" });
      await wait(350);
      const slots = [...stone.querySelectorAll<HTMLElement>(".stone-stars .star")];
      for (let s = arrival.before; s < now && alive; s++) await flyStar(slots[s], 2 + s * 2);
      stone.dataset.best = String(now);
    }
    // Stones that just opened flip open, then the mascot hops on.
    for (let i = 0; i < ids.length && alive; i++) {
      if (before[i].open || !after[i].open) continue;
      await wait(250);
      const b = stoneEls.get(ids[i])!;
      b.classList.add("opening");
      await wait(reducedMotion() ? 0 : 260);
      b.classList.remove("locked");
      b.disabled = false;
      b.dataset.open = "true";
      b.setAttribute("aria-label", `Play set ${i + 1}`);
      await wait(reducedMotion() ? 0 : 300);
      b.classList.remove("opening");
    }
    const target = currentStone(after);
    if (alive && target !== startAt) {
      await wait(200);
      await hopTo(target);
    }
  }

  return {
    el,
    mounted() {
      stoneEls.get(ids[startAt])!.scrollIntoView({ block: "center" });
      void arrive().finally(() => {
        if (alive) el.dataset.ready = "true";
      });
    },
    destroy() {
      alive = false;
    },
  };
}
