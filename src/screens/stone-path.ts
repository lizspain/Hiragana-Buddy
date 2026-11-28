// The stepping-stone path, shared by Listen & Match (sets) and Look and Write
// (stages): docs/LISTEN-MATCH.md "Getting in", docs/VOCAB-SPELLING-DESIGN.md
// "Getting in".
//
// One stone per set or stage, with the mascot standing on the current one (the
// first open stone without 3 stars), centred and bobbing: one tap on it starts
// a game, so a child never chooses from a grid. Each stone shows its face (a
// kana, or a picture) and the best stars earned on it (never empty outlines).
// A stone opens when the one before reaches 3 stars, or when a grown-up has
// unlocked the whole path. A stone that isn't open isn't shown at all: the
// path ends at the last open stone (Liz, Nov 2026), so there is never a row of
// closed stones to feel behind on.
//
// Arriving from a game, its new best stars fly onto its stone; if that stone
// just reached 3 stars, the next one appears on the path and the mascot hops
// onto it.

import "../match/path.css";
import type { Screen } from "../app";
import { currentStone, pathState, type StoneState } from "../match/progress";
import { stepChime, unlockAudio } from "../ui/audio";
import { h, ICON, iconButton, mascot } from "../ui/dom";

export interface PathArrival {
  /** The set or stage just played. */
  setId: string;
  /** Its best stars before that game. */
  before: 0 | 1 | 2 | 3;
}

export type Best = (id: string) => 0 | 1 | 2 | 3;

/** What the path is made of: everything that differs between the games. */
export interface PathSpec {
  /** Stones in order. */
  ids: readonly string[];
  /** What a stone shows (the set's first kana, the stage's first picture). */
  face: (id: string, i: number) => Node | Node[];
  best: Best;
  unlockAll: boolean;
  play: (id: string) => void;
  /** A stone's name for screen readers ("set 1", "stage 1A"). */
  name: (id: string, i: number) => string;
  /** The screen's testid ("path", "vocab-path"). */
  testId: string;
  /** Anything above the path (Listen & Match's My word row). Stones it makes get `stone(...)`. */
  top?: (tools: PathTools) => HTMLElement | null;
  home: () => void;
}

export interface PathTools {
  /** Best stars as drawn before the arrival animation. */
  shown: Best;
  best: Best;
  /** The stars on a stone: only those earned, the ones this visit earned hidden until they fly in. */
  starSlots: (shownBest: number, best: number) => HTMLElement;
  /** Register a stone so its stars can fly in on arrival. */
  register: (id: string, b: HTMLButtonElement) => void;
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function stonePath(spec: PathSpec, arrival?: PathArrival): Screen {
  const { ids, unlockAll } = spec;
  const real = spec.best;
  // Draw the path as it was before the game, then animate it to how it is now.
  const shown: Best = (id) => (arrival && id === arrival.setId ? (Math.min(arrival.before, real(id)) as 0 | 1 | 2 | 3) : real(id));
  const before = pathState(ids, shown, unlockAll);
  const after = pathState(ids, real, unlockAll);
  let alive = true;

  const stoneEls = new Map<string, HTMLButtonElement>();
  const go = (id: string) => () => {
    unlockAudio();
    spec.play(id);
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
    const b = h(
      "button",
      {
        class: `stone${s.open ? "" : " locked"}`,
        "data-testid": "stone",
        "data-set": s.id,
        "data-open": String(s.open),
        "data-best": String(s.best),
        "aria-label": s.open ? `Play ${spec.name(s.id, i)}` : `${spec.name(s.id, i)}, not open yet`,
        disabled: !s.open,
        onclick: go(s.id),
      },
      h("span", { class: "stone-face" }, spec.face(s.id, i)),
      starSlots(s.best, real(s.id)),
    );
    stoneEls.set(s.id, b);
    // Not open yet: not shown (it appears when the stone before reaches 3 stars).
    return h("li", { class: s.open ? "stone-spot" : "stone-spot unseen", style: `--i:${i}` }, b);
  }

  const top = spec.top?.({ shown, best: real, starSlots, register: (id, b) => stoneEls.set(id, b) }) ?? null;

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
    { class: "screen path", "data-testid": spec.testId, "data-ready": "false" },
    h("header", { class: "topbar" }, iconButton(ICON.home, "Home", spec.home, "home small")),
    top,
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
    // Stones that just opened appear on the path, then the mascot hops on.
    for (let i = 0; i < ids.length && alive; i++) {
      if (before[i].open || !after[i].open) continue;
      await wait(300);
      const b = stoneEls.get(ids[i])!;
      b.classList.remove("locked");
      b.disabled = false;
      b.dataset.open = "true";
      b.setAttribute("aria-label", `Play ${spec.name(ids[i], i)}`);
      b.parentElement!.classList.remove("unseen");
      b.classList.add("appearing");
      b.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
      await wait(reducedMotion() ? 320 : 620);
      b.classList.remove("appearing");
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
