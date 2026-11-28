// Listen & Match: hear a kana, tap its tile (docs/LISTEN-MATCH.md).
//
// The mascot says a kana and is the replay ("speaker") button. Eight tiles sit
// on the board; a found tile hops into the pebble tray and leaves its gap, so
// the others never move. A wrong tap only wiggles the tile and replays the
// sound; the third wrong tap in a round makes the right tile glow. After the
// eighth pebble: cheer for everyone, then 1–3 stars, then play again / go on.

import "../match/match.css";
import type { Nav, Screen } from "../app";
import { HINT_AFTER_WRONG, IDLE_PULSE_MS, NEXT_ROUND_MS } from "../match/config";
import { MatchGame } from "../match/game";
import { PATH_SETS, pathSetById, wordSet, type KanaSet } from "../match/sets";
import { getSettings, matchBestStars, matchPlayed, recordMatch, saveSettings } from "../store";
import { showResults } from "../match/results";
import { boop, line, onVoiceTrouble, pop, preloadKana, sayKana, stepChime, unlockAudio } from "../ui/audio";
import { preloadDance } from "../ui/dance";
import { h, ICON, iconButton, kanaSvg, mascot, modal } from "../ui/dom";
import { isPalmContact, isTapDistance } from "../ui/pen";

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Tests read the asked-for kana from the board; a child never sees it. */
const UNDER_TEST = typeof navigator !== "undefined" && navigator.webdriver;

/** A path stone by id, or a My word set (`word:きみ`, padded afresh each game). */
function resolveSet(id: string): KanaSet {
  if (id.startsWith("word:")) return wordSet([...id.slice(5)]);
  return pathSetById(id) ?? PATH_SETS[0];
}

export function matchScreen(nav: Nav, setId = PATH_SETS[0].id): Screen {
  const set = resolveSet(setId);
  /** For the path: this set's best before this game, so new stars can fly onto its stone. */
  const bestBefore = matchBestStars(set.id);
  /** A set's first game opens with each tile saying its sound. */
  const firstTime = !matchPlayed(set.id);
  const game = new MatchGame(set.kana);
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };
  let alive = true;
  /** Between a find and the next prompt: nothing but the flight and the kana. */
  let busy = false;
  let idle = 0;
  let speakSeq = 0;
  const cleanups: (() => void)[] = [];

  // ---------- elements ----------

  const slots = game.tiles.map((_, i) => h("span", { class: "slot", style: `--i:${i}` }));
  const tray = h("div", { class: "match-tray", "data-testid": "tray", role: "img", "aria-label": "Pebble tray" }, slots);

  const soundHint = h("span", { class: "sound-hint", html: ICON.soundOff, "aria-hidden": "true" });
  const speaker = h(
    "button",
    { class: "match-speaker", "data-quiet": "", "data-testid": "speaker", "aria-label": "Hear it again" },
    mascot("match-mascot"),
    // Same look as "Hear it" on the entry page and the play button on word cards.
    h("span", { class: "shelf-play hear-play speaker-badge" }, h("span", { class: "shelf-play-icon", html: ICON.speaker })),
    soundHint,
  );

  const tileEls = new Map<string, HTMLButtonElement>();
  const board = h(
    "div",
    { class: "match-board", "data-testid": "board" },
    game.tiles.map((k) => {
      const b = h("button", { class: "match-tile", "data-kana": k, "data-quiet": "", "aria-label": "Tile" }, kanaSvg(k));
      tileEls.set(k, b);
      return b;
    }),
  );

  const el = h(
    "div",
    { class: "screen match", "data-testid": "match", "data-state": "prompt", "data-round": "0" },
    h("header", { class: "topbar match-top" }, iconButton(ICON.home, "Home", askLeave, "home"), tray),
    h("main", { class: "match-stage" }, speaker, board),
  );

  const setState = (s: string) => {
    el.dataset.state = s;
    el.dataset.round = String(game.round);
    if (UNDER_TEST) board.dataset.target = game.target ?? "";
  };

  // ---------- voice ----------

  /** Say a kana with taps locked; unlock afterwards unless a newer line or a find took over. */
  async function speak(k: string) {
    const my = ++speakSeq;
    game.lock();
    setState("prompt");
    speaker.classList.add("talking");
    await sayKana(k);
    if (!alive || my !== speakSeq) return;
    speaker.classList.remove("talking");
    if (!busy && !game.done) {
      game.unlock();
      setState("await");
      armIdle();
    }
  }

  function armIdle() {
    clearTimeout(idle);
    speaker.classList.remove("nudge");
    idle = window.setTimeout(() => alive && !busy && speaker.classList.add("nudge"), IDLE_PULSE_MS);
  }

  function prompt() {
    void speak(game.target!);
  }

  cleanups.push(
    onVoiceTrouble(() => {
      soundHint.classList.add("show");
    }),
  );

  speaker.addEventListener("click", () => {
    unlockAudio();
    soundHint.classList.remove("show");
    if (busy || game.done) return;
    void speak(game.target!);
  });

  // ---------- taps on tiles ----------
  //
  // First touch wins: while one finger is down every other contact is
  // ignored, and a palm-sized contact never counts. A tap lands on release,
  // over the tile it started on or within TAP_SLOP_PX of where it landed (a
  // wobbly tap is still a tap). Keyboard "clicks" (detail 0) count too.

  let down: { id: number; tile: HTMLButtonElement; x0: number; y0: number } | null = null;
  board.addEventListener("pointerdown", (e) => {
    const tile = (e.target as Element).closest<HTMLButtonElement>(".match-tile");
    if (!tile || down || isPalmContact(e) || (e.pointerType === "mouse" && e.button !== 0)) return;
    down = { id: e.pointerId, tile, x0: e.clientX, y0: e.clientY };
    try {
      tile.setPointerCapture(e.pointerId); // the release reaches us even off the board
    } catch {
      /* synthetic events in tests */
    }
  });
  board.addEventListener("pointerup", (e) => {
    if (!down || e.pointerId !== down.id) return;
    const { tile, x0, y0 } = down;
    down = null;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".match-tile");
    if (over === tile || isTapDistance(x0, y0, e.clientX, e.clientY)) onTap(tile);
  });
  board.addEventListener("pointercancel", (e) => {
    if (down?.id === e.pointerId) down = null;
  });
  board.addEventListener("click", (e) => {
    const tile = (e.target as Element).closest<HTMLButtonElement>(".match-tile");
    if (tile && e.detail === 0) onTap(tile);
  });

  function onTap(tile: HTMLButtonElement) {
    unlockAudio();
    const k = tile.dataset.kana!;
    const r = game.tap(k);
    if (r.kind === "ignored") return;
    clearTimeout(idle);
    speaker.classList.remove("nudge");
    if (r.kind === "wrong") {
      game.lock();
      restart(tile, "wiggle");
      boop();
      if (r.wrongs >= HINT_AFTER_WRONG) hint();
      setState("wrong");
      later(() => void speak(game.target!), 260);
      return;
    }
    found(tile, k, r.last);
  }

  function hint() {
    const t = tileEls.get(game.target!)!;
    t.classList.add("glow");
    const a = speaker.getBoundingClientRect();
    const b = t.getBoundingClientRect();
    speaker.style.setProperty("--look-x", String(Math.sign(b.left + b.width / 2 - (a.left + a.width / 2))));
    speaker.style.setProperty("--look-y", String(Math.sign(b.top + b.height / 2 - (a.top + a.height / 2))));
    speaker.classList.add("look");
  }

  function found(tile: HTMLButtonElement, k: string, last: boolean) {
    busy = true;
    speakSeq++; // a replay still running must not unlock
    setState("found");
    const step = game.found.length - 1;
    tile.classList.remove("glow", "wiggle");
    speaker.classList.remove("look");
    restart(tile, "pop");
    pop();
    stepChime(step);
    const said = sayKana(k);
    const landed = flyToTray(tile, slots[step], k);
    void Promise.all([said, landed]).then(() => {
      if (!alive) return;
      later(() => {
        busy = false;
        game.next();
        if (last) results();
        else prompt();
      }, last ? 500 : NEXT_ROUND_MS);
    });
  }

  /** The tile hops into its tray slot and becomes a pebble; its board gap stays. */
  function flyToTray(tile: HTMLButtonElement, slot: HTMLElement, k: string): Promise<void> {
    const pebble = () => {
      slot.replaceChildren(h("span", { class: "pebble" }, kanaSvg(k)));
      slot.classList.add("filled");
    };
    const from = tile.getBoundingClientRect();
    tile.classList.add("gone");
    if (reducedMotion() || !from.width) {
      pebble();
      return Promise.resolve();
    }
    const to = slot.getBoundingClientRect();
    const fly = h("div", { class: "flyer", "aria-hidden": "true" }, kanaSvg(k));
    Object.assign(fly.style, {
      left: `${from.left}px`,
      top: `${from.top}px`,
      width: `${from.width}px`,
      height: `${from.height}px`,
      padding: `${from.width * 0.14}px`,
    });
    document.body.appendChild(fly);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const s = to.width / from.width;
    const anim = fly.animate(
      [
        { transform: "translate(0,0) scale(1.08)" },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(${(1 + s) / 2})`, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(${s})` },
      ],
      { duration: 560, easing: "cubic-bezier(.45,0,.3,1)" },
    );
    return new Promise((resolve) => {
      const done = () => {
        fly.remove();
        pebble();
        resolve();
      };
      anim.onfinish = done;
      anim.oncancel = done;
      cleanups.push(() => fly.remove());
    });
  }

  // ---------- results ----------

  function results() {
    setState("results");
    el.dataset.stars = String(game.stars);
    void recordMatch(set.id, game.hits, game.stars, game.taps);
    clearTimeout(idle);
    showResults({
      screen: el,
      stage: el.querySelector<HTMLElement>(".match-stage")!,
      tray,
      stars: game.stars,
      playAgain: () => nav.match(set.id),
      goOn: () => nav.path({ setId: set.id, before: bestBefore }),
      later,
      cleanups,
    });
  }

  // ---------- very first game: the spoken intro ----------
  //
  // "Listen, then tap the one you hear!" in English, once ever. (A Japanese
  // version played first; playtesters found it confusing, cut Nov 2026.)
  // The mascot talks; taps and the speaker wait.

  async function intro() {
    if (getSettings().matchIntroDone) return;
    busy = true;
    setState("intro");
    speaker.classList.add("talking");
    await line("matchIntroEn");
    speaker.classList.remove("talking");
    busy = false;
    if (alive) void saveSettings({ matchIntroDone: true });
  }

  // ---------- first game on a set: the tile preview ----------
  //
  // The eight tiles arrive one at a time, each saying its sound (about 8 s),
  // so a child who hasn't met these kana gets a fair first try. Taps and the
  // speaker do nothing until it ends.

  async function preview() {
    busy = true;
    setState("preview");
    const tiles = [...tileEls.values()];
    for (const t of tiles) t.classList.add("waiting");
    await new Promise((r) => later(() => r(null), 500));
    for (const t of tiles) {
      if (!alive) return;
      t.classList.remove("waiting");
      t.classList.add("arrive");
      await sayKana(t.dataset.kana!);
      await new Promise((r) => later(() => r(null), 180));
    }
    if (!alive) return;
    busy = false;
    later(prompt, 500);
  }

  // ---------- leaving ----------

  function askLeave() {
    const m = modal(
      h(
        "div",
        { class: "leave-ask" },
        iconButton(ICON.play, "Keep playing", () => m.close(), "big-round"),
        iconButton(ICON.home, "Leave", () => {
          m.close();
          nav.home();
        }, "big-round"),
      ),
    );
  }

  return {
    el,
    mounted() {
      preloadKana(set.kana);
      // Decode the results dance now, not on the frame it starts.
      later(() => void preloadDance(), 1500);
      void (async () => {
        await intro();
        if (!alive) return;
        if (firstTime) void preview();
        else later(prompt, 600); // once the board has had a moment to appear
      })();
    },
    destroy() {
      alive = false;
      game.lock();
      clearTimeout(idle);
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

