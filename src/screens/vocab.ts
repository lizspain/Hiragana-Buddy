// Make a Word: see a picture, hear its word, spell it with kana tiles
// (docs/VOCAB-SPELLING-DESIGN.md). The rules live in vocab/game.ts; this
// screen draws them and handles taps and drags.
//
// Per word: the picture arrives and its word is said (taps wait). A tap sends
// a tile to the leftmost empty slot; a drag can drop it on any empty slot. A
// right tile lands and says its sound, leaving its gap; a wrong one wiggles
// with a soft boop, slides back, and the word is said again. After the third
// wrong tile the tile for the leftmost empty slot glows. A finished word says
// each letter, then the word, bounces, sprays stars, drops a pebble in the
// tray (gold when no tile was wrong) and the next word starts by itself.

import "../match/match.css";
import "../vocab/vocab.css";
import type { Nav, Screen } from "../app";
import { showResults } from "../match/results";
import { boop, onVoiceTrouble, pop, preloadKana, preloadVocab, sayKana, sayVocab, stepChime, unlockAudio } from "../ui/audio";
import { pageBurst } from "../ui/burst";
import { preloadDance } from "../ui/dance";
import { h, ICON, iconButton, kanaSvg, mascot, modal } from "../ui/dom";
import { isPalmContact } from "../ui/pen";
import { VocabGame, type PlaceResult } from "../vocab/game";
import { stageById, VOCAB_STAGES, type VocabSense, type VocabWord } from "../vocab/stages";

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const UNDER_TEST = typeof navigator !== "undefined" && navigator.webdriver;
/** A press that moves this far (px) is a drag, not a tap. */
const DRAG_PX = 10;
/** A drop this close to a slot (fraction of its size) still counts as on it: generous for small fingers. */
const SLOT_REACH = 0.35;
/** Between a finished word's finish and the next picture. */
const NEXT_WORD_MS = 500;

export const pictureUrl = (s: VocabSense) => `vocab/${s.picture}`;

/** Tests read what was said, in order, from here; a child never sees it. */
function logSaid(what: string) {
  if (!UNDER_TEST) return;
  const w = window as unknown as { vocabSaid?: string[] };
  (w.vocabSaid ??= []).push(what);
}

export function vocabScreen(nav: Nav, stageId = VOCAB_STAGES[0].id): Screen {
  const stage = stageById(stageId) ?? VOCAB_STAGES[0];
  const game = new VocabGame(stage);
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };
  const wait = (ms: number) => new Promise<void>((r) => later(r, ms));
  let alive = true;
  /** Bumped by every new spoken sequence: an older one stops where it is. */
  let seq = 0;
  const cleanups: (() => void)[] = [];

  // ---------- elements ----------

  const traySlots = game.words.map((_, i) => h("span", { class: "slot", style: `--i:${i}` }));
  const tray = h("div", { class: "match-tray", "data-testid": "tray", role: "img", "aria-label": "Pebble tray" }, traySlots);

  const soundHint = h("span", { class: "sound-hint", html: ICON.soundOff, "aria-hidden": "true" });
  const speaker = h(
    "button",
    { class: "match-speaker", "data-quiet": "", "data-testid": "speaker", "aria-label": "Hear it again" },
    mascot("match-mascot"),
    h("span", { class: "shelf-play hear-play speaker-badge" }, h("span", { class: "shelf-play-icon", html: ICON.speaker })),
    soundHint,
  );

  const pictures = h("button", { class: "vocab-pictures", "data-quiet": "", "data-testid": "picture", "aria-label": "Hear it again" });
  const slotRow = h("div", { class: "vocab-slots", "data-testid": "slots" });
  const tileRow = h("div", { class: "vocab-tiles", "data-testid": "tiles" });
  const stageEl = h("main", { class: "vocab-stage" }, pictures, slotRow, tileRow);

  const el = h(
    "div",
    { class: "screen vocab", "data-testid": "vocab", "data-state": "prompt", "data-stage": stage.id, "data-index": "0" },
    h("header", { class: "topbar vocab-top" }, speaker, tray, iconButton(ICON.home, "Home", askLeave, "home small")),
    stageEl,
  );

  const setState = (s: string) => {
    el.dataset.state = s;
    el.dataset.index = String(game.index);
    if (UNDER_TEST) el.dataset.word = game.word?.kana.join("") ?? "";
  };

  let tileEls = new Map<number, HTMLButtonElement>();
  let slotEls: HTMLElement[] = [];
  let pictureEls: HTMLElement[] = [];

  /** Lay out the current word: its picture(s), empty slots, and tiles. */
  function deal(word: VocabWord) {
    if (UNDER_TEST) el.dataset.word = word.kana.join("");
    pictures.classList.toggle("two", word.senses.length > 1);
    pictures.classList.remove("bounce", "saying");
    pictureEls = word.senses.map((s) =>
      h("span", { class: "vocab-picture arrive", "data-sense": s.meaning ?? word.meaning }, h("img", { src: pictureUrl(s), alt: "", draggable: "false" })),
    );
    pictures.replaceChildren(...pictureEls);
    slotEls = word.kana.map((k, i) => h("span", { class: "vocab-slot", "data-slot": String(i), ...(UNDER_TEST ? { "data-kana": k } : {}) }));
    slotRow.replaceChildren(...slotEls);
    tileEls = new Map();
    tileRow.replaceChildren(
      ...game.tiles.map((t) => {
        const b = h("button", { class: "match-tile", "data-tile": String(t.id), "data-kana": t.kana, "data-quiet": "", "aria-label": "Tile" }, kanaSvg(t.kana));
        tileEls.set(t.id, b);
        return b;
      }),
    );
  }

  // ---------- voice ----------

  /** Say the word for each picture in turn, lighting that picture (はし: bridge, then chopsticks). */
  async function sayWord(my: number) {
    const word = game.word!;
    const two = word.senses.length > 1;
    for (let i = 0; i < word.senses.length; i++) {
      if (my !== seq || !alive) return;
      if (two) {
        pictures.classList.add("saying");
        pictureEls.forEach((p, j) => p.classList.toggle("lit", i === j));
      }
      logSaid(word.senses[i].clip.replace(".mp3", ""));
      await sayVocab(word.senses[i].clip, word.kana);
      if (two && i < word.senses.length - 1) await wait(250);
    }
    if (two && my === seq) {
      pictures.classList.remove("saying");
      pictureEls.forEach((p) => p.classList.remove("lit"));
    }
  }

  /** The prompt (or a free replay): taps wait until the word has been said. */
  async function prompt() {
    if (game.done) return;
    const my = ++seq;
    game.lock();
    setState("prompt");
    speaker.classList.add("talking");
    await sayWord(my);
    if (!alive || my !== seq) return;
    speaker.classList.remove("talking");
    game.unlock();
    setState("await");
  }

  const replay = () => {
    unlockAudio();
    soundHint.classList.remove("show");
    if (el.dataset.state === "await" || el.dataset.state === "prompt" || el.dataset.state === "wrong") void prompt();
  };
  speaker.addEventListener("click", replay);
  pictures.addEventListener("click", replay);
  cleanups.push(onVoiceTrouble(() => soundHint.classList.add("show")));

  // ---------- taps and drags on tiles ----------
  //
  // One finger at a time: while one is down every other contact is ignored,
  // and a palm-sized contact never counts. Released without moving: a tap,
  // if still over the tile it started on. Moved past DRAG_PX: a drag that
  // follows the finger; released over a slot (generously), it's offered to
  // that slot; anywhere else it slides home and counts as nothing.
  // pointercancel slides it home too, never counted.

  let held: { id: number; tile: HTMLButtonElement; x0: number; y0: number; dragging: boolean; over: HTMLElement | null } | null = null;

  tileRow.addEventListener("pointerdown", (e) => {
    const tile = (e.target as Element).closest<HTMLButtonElement>(".match-tile");
    if (!tile || held || isPalmContact(e) || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (game.isLocked) return; // touches during a lock are ignored, not counted
    held = { id: e.pointerId, tile, x0: e.clientX, y0: e.clientY, dragging: false, over: null };
    try {
      tile.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events in tests */
    }
  });

  tileRow.addEventListener("pointermove", (e) => {
    if (!held || e.pointerId !== held.id) return;
    const dx = e.clientX - held.x0;
    const dy = e.clientY - held.y0;
    if (!held.dragging && Math.hypot(dx, dy) < DRAG_PX) return;
    if (!held.dragging) {
      held.dragging = true;
      held.tile.classList.remove("wiggle", "sliding-back");
      held.tile.classList.add("dragging");
    }
    held.tile.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
    const over = slotAt(e.clientX, e.clientY);
    if (over !== held.over) {
      held.over?.classList.remove("over");
      over?.classList.add("over");
      held.over = over;
    }
  });

  tileRow.addEventListener("pointerup", (e) => {
    if (!held || e.pointerId !== held.id) return;
    const h0 = held;
    held = null;
    h0.over?.classList.remove("over");
    const id = Number(h0.tile.dataset.tile);
    if (!h0.dragging) {
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".match-tile");
      if (over === h0.tile) onPlace(h0.tile, game.tap(id));
      return;
    }
    const slot = slotAt(e.clientX, e.clientY);
    if (!slot) return slideBack(h0.tile);
    const r = game.drop(id, Number(slot.dataset.slot));
    if (r.kind === "ignored") return slideBack(h0.tile);
    onPlace(h0.tile, r);
  });

  tileRow.addEventListener("pointercancel", (e) => {
    if (!held || e.pointerId !== held.id) return;
    held.over?.classList.remove("over");
    if (held.dragging) slideBack(held.tile);
    held = null;
  });

  // Keyboard (Enter/Space on a focused tile) counts as a tap.
  tileRow.addEventListener("click", (e) => {
    const tile = (e.target as Element).closest<HTMLButtonElement>(".match-tile");
    if (tile && e.detail === 0) onPlace(tile, game.tap(Number(tile.dataset.tile)));
  });

  /** The empty slot under (or close to) a point. */
  function slotAt(x: number, y: number): HTMLElement | null {
    let best: HTMLElement | null = null;
    let bestD = Infinity;
    for (const s of slotEls) {
      if (s.classList.contains("filled")) continue;
      const r = s.getBoundingClientRect();
      const m = r.width * SLOT_REACH;
      if (x < r.left - m || x > r.right + m || y < r.top - m || y > r.bottom + m) continue;
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  function slideBack(tile: HTMLButtonElement) {
    tile.classList.remove("dragging");
    if (reducedMotion() || !tile.style.transform) {
      tile.style.transform = "";
      return;
    }
    tile.classList.add("sliding-back");
    void tile.offsetWidth;
    tile.style.transform = "";
    later(() => tile.classList.remove("sliding-back"), 300);
  }

  function onPlace(tile: HTMLButtonElement, r: PlaceResult) {
    unlockAudio();
    if (r.kind === "ignored") return slideBack(tile);
    if (r.kind === "wrong") {
      slideBack(tile);
      restart(tile, "wiggle");
      boop();
      if (r.hint) {
        const glow = game.hintTile;
        for (const [id, t] of tileEls) t.classList.toggle("glow", id === glow);
      }
      game.lock();
      setState("wrong");
      later(() => void prompt(), 420); // the word again
      return;
    }
    placed(tile, r.slot, r.wordDone);
  }

  /** A right tile: it lands in its slot and says its sound; its gap below stays. */
  function placed(tile: HTMLButtonElement, slot: number, wordDone: boolean) {
    const k = tile.dataset.kana!;
    const slotEl = slotEls[slot];
    const from = tile.getBoundingClientRect();
    tile.classList.remove("glow", "wiggle", "dragging");
    tile.classList.add("gone");
    tile.style.transform = "";
    const landed = h("span", { class: "match-tile", "data-kana": k }, kanaSvg(k));
    slotEl.replaceChildren(landed);
    slotEl.classList.add("filled");
    // Keep the glow on whichever tile still fits the leftmost empty slot.
    const glow = game.hintTile;
    for (const [id, t] of tileEls) t.classList.toggle("glow", id === glow);
    if (!reducedMotion() && from.width) {
      const to = slotEl.getBoundingClientRect();
      landed.animate(
        [{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: "none" }],
        { duration: 260, easing: "cubic-bezier(.23,1,.32,1)" },
      );
    }
    pop();
    stepChime(slot);
    if (!wordDone) {
      seq++; // a replay still running stops; the tile's sound cuts in
      speaker.classList.remove("talking");
      void sayKana(k);
      return;
    }
    void finish();
  }

  // ---------- a finished word ----------

  async function finish() {
    const my = ++seq;
    const i = game.index;
    const word = game.word!;
    const clean = game.wrongTiles[i] === 0;
    setState("finish");
    speaker.classList.remove("talking");
    await wait(320);
    // Each letter says its sound, left to right …
    for (let s = 0; s < slotEls.length; s++) {
      if (!alive || my !== seq) return;
      slotEls[s].classList.add("saying");
      logSaid(word.kana[s]);
      await sayKana(word.kana[s], s === 0);
      slotEls[s].classList.remove("saying");
      await wait(80);
    }
    if (!alive || my !== seq) return;
    // … then the whole word, the picture bounces, and stars spray out.
    await wait(200);
    await sayWord(my);
    if (!alive || my !== seq) return;
    restart(pictures, "bounce");
    cleanups.push(pageBurst(pictures, 1100));
    await dropPebble(i, word, clean);
    await wait(NEXT_WORD_MS);
    if (!alive || my !== seq) return;
    if (game.next()) {
      deal(game.word!);
      later(() => void prompt(), 450);
    } else results();
  }

  /** The word's pebble flies from the picture into its tray slot: gold when it was clean. */
  async function dropPebble(i: number, word: VocabWord, clean: boolean) {
    const slot = traySlots[i];
    const put = () => {
      slot.replaceChildren(h("span", { class: clean ? "pebble gold" : "pebble" }, h("img", { src: pictureUrl(word.senses[0]), alt: "" })));
      slot.classList.add("filled");
      slot.dataset.clean = String(clean);
    };
    const from = pictureEls[0]?.getBoundingClientRect();
    if (reducedMotion() || !from?.width) return put();
    const to = slot.getBoundingClientRect();
    const fly = h("span", { class: clean ? "pebble gold" : "pebble", "aria-hidden": "true" }, h("img", { src: pictureUrl(word.senses[0]), alt: "" }));
    Object.assign(fly.style, { position: "fixed", zIndex: "40", left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
    document.body.appendChild(fly);
    cleanups.push(() => fly.remove());
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    await fly
      .animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(2.2)`, opacity: 0.2 },
          { transform: `translate(${dx * 0.4}px, ${dy * 0.5 - 50}px) scale(1.6)`, opacity: 1, offset: 0.5 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 600, easing: "cubic-bezier(.45,0,.3,1)" },
      )
      .finished.catch(() => undefined);
    fly.remove();
    put();
  }

  // ---------- results ----------

  function results() {
    setState("results");
    el.dataset.stars = String(game.stars);
    el.dataset.clean = String(game.cleanWords);
    showResults({
      screen: el,
      stage: stageEl,
      tray,
      stars: game.stars,
      playAgain: () => nav.vocab(stage.id),
      goOn: () => nav.home(),
      later,
      cleanups,
    });
  }

  // ---------- leaving ----------

  function askLeave() {
    const m = modal(
      h(
        "div",
        { class: "leave-ask" },
        iconButton(ICON.play, "Keep playing", () => m.close(), "big-round"),
        iconButton(
          ICON.home,
          "Leave",
          () => {
            m.close();
            nav.home();
          },
          "big-round",
        ),
      ),
    );
  }

  return {
    el,
    mounted() {
      preloadKana(stage.setKana);
      preloadVocab(stage.words.flatMap((w) => w.senses.map((s) => s.clip)));
      later(() => void preloadDance(), 1500);
      if (UNDER_TEST) (window as unknown as { vocabSaid?: string[] }).vocabSaid = [];
      deal(game.word!);
      later(() => void prompt(), 600);
    },
    destroy() {
      alive = false;
      seq++;
      game.lock();
      timers.forEach(clearTimeout);
      cleanups.forEach((f) => f());
    },
  };
}

/** Restart a one-shot CSS animation class. */
function restart(el: HTMLElement, cls: string) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
