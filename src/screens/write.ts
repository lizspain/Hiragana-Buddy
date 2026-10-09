// The writing screen: each kana runs phase 1 (watch and trace) → 2 (trace) →
// 3 (write, scored), then the next kana. Only the cell, progress, replay,
// sound and home are on screen.

import type { Nav, PracticePlan, Screen } from "../app";
import { glyph } from "../data";
import type { Phase, Pt } from "../engine/matcher";
import { starsFor } from "../engine/matcher";
import { CharacterSession, type Outcome } from "../engine/session";
import { boop, chime, fanfare, line, pop, praise, preloadWord, sayKana, sayOrderSlip, setSoundEnabled, soundEnabled, unlockAudio } from "../ui/audio";
import { Board } from "../ui/board";
import { h, html, ICON, iconButton, kanaSvg } from "../ui/dom";
import { inkPalette } from "../ui/palette";
import { PenInput } from "../ui/pen";
import { getSettings, isMastered, recordSession, saveSettings, type KanaResult } from "../store";

const PHASE_ICON: Record<Phase, string> = { 1: ICON.eye, 2: ICON.trace, 3: ICON.pencil };
const PHASE_LABEL: Record<Phase, string> = { 1: "Watch and trace", 2: "Trace", 3: "Write" };

export function writeScreen(nav: Nav, plan: PracticePlan): Screen {
  const settings = getSettings();
  const stage = h("div", { class: "stage", "data-testid": "stage" });
  const strip = h("div", { class: "strip", "aria-label": "Your word" });
  const pips = h("div", { class: "pips" });
  const soundBtn = iconButton(soundEnabled() ? ICON.soundOn : ICON.soundOff, "Sound", () => {
    const on = !soundEnabled();
    setSoundEnabled(on);
    void saveSettings({ sound: on });
    soundBtn.innerHTML = on ? ICON.soundOn : ICON.soundOff;
  });
  const replayBtn = iconButton(ICON.replay, "Show me again", () => replay(), "replay");

  const el = h(
    "div",
    { class: "screen write" },
    h("header", { class: "topbar" }, iconButton(ICON.home, "Home", () => nav.home(), "home"), pips, h("div", { class: "right" }, replayBtn, soundBtn)),
    strip,
    h("main", { class: "stage-wrap" }, stage),
    h(
      "aside",
      { class: "palette-area" },
      inkPalette(settings.inkColor, (c) => {
        board.setInkColor(c);
        void saveSettings({ inkColor: c });
      }),
    ),
  );

  const board = new Board(stage);
  board.inkColor = settings.inkColor;

  // ---------- state ----------
  let idx = 0;
  let phases: Phase[] = [1, 2, 3];
  let pi = 0;
  let session!: CharacterSession;
  let busy = false;
  let demoTimer = 0;
  let destroyed = false;
  const timers = new Set<number>();
  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!destroyed) fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const results: KanaResult[] = [];
  const drawings: Pt[][][] = [];

  const kana = () => plan.kana[idx];
  const phase = () => phases[pi];

  const pen = new PenInput(stage, () => board.cell, {
    start(x, y) {
      unlockAudio();
      clearTimeout(demoTimer);
      board.beginLive(x, y);
    },
    move: (xs, ys) => board.extendLive(xs, ys),
    discard: () => board.dropLive(),
    end(points) {
      if (busy) {
        board.fadeLive();
        return;
      }
      handle(session.submit(points), points);
    },
  });
  board.onResize = () => pen.cancel();

  // A second hand landing on a button mid-stroke must not leave the screen.
  el.addEventListener(
    "click",
    (e) => {
      if (pen.drawing) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );

  // ---------- rendering ----------

  function renderStrip() {
    strip.replaceChildren(
      ...plan.kana.map((k, i) =>
        h(
          "button",
          {
            class: `strip-tile${i === idx ? " current" : ""}${i < idx ? " done" : ""}`,
            "aria-label": `${k}`,
            onclick: () => sayKana(k),
          },
          kanaSvg(k),
          i < idx ? html(`<span class="sticker">${ICON.star}</span>`) : null,
        ),
      ),
    );
    strip.hidden = plan.kana.length < 2;
    strip.querySelector(".current")?.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function renderPips() {
    pips.replaceChildren(
      ...phases.map((p, i) =>
        h("span", { class: `pip${i === pi ? " now" : ""}${i < pi ? " done" : ""}`, title: PHASE_LABEL[p], html: PHASE_ICON[p] }),
      ),
    );
  }

  function refreshGuide() {
    board.setScene({ glyph: glyph(kana()), phase: phase(), k: session.k, follow: session.followMe, together: session.together });
    stage.dataset.kana = kana();
    stage.dataset.phase = String(phase());
    stage.dataset.stroke = String(session.k);
    stage.dataset.follow = String(session.followMe);
    stage.dataset.together = String(session.together);
  }

  function setBusy(b: boolean) {
    busy = b;
    stage.dataset.busy = String(b);
  }

  // ---------- flow ----------

  function startKana() {
    const k = kana();
    phases = settings.skipPhase1WhenMastered && isMastered(k) ? [2, 3] : [1, 2, 3];
    pi = 0;
    renderStrip();
    sayKana(k, false); // waits for the last letter's praise to finish
    startPhase();
  }

  function startPhase() {
    session = new CharacterSession(glyph(kana()), phase());
    board.clearInk();
    board.clearEffects();
    refreshGuide();
    renderPips();
    setBusy(false);
    const p = phase();
    if (p === 1) {
      line("watch", false);
      demoSoon(500);
    } else if (p === 2) line("trace", false);
    else line("write", false);
  }

  function demoSoon(ms: number) {
    clearTimeout(demoTimer);
    demoTimer = later(ms, () => {
      if (!pen.drawing && !session.done) void board.playDemo(glyph(kana()).strokes[session.k]);
    });
  }

  function replay() {
    unlockAudio();
    if (busy || session.done || pen.drawing) return;
    void board.playDemo(glyph(kana()).strokes[session.k]);
  }

  function handle(o: Outcome, points: Pt[]) {
    const strokes = glyph(kana()).strokes;
    stage.dataset.outcome = o.kind;
    if (o.kind === "accept") {
      board.acceptLive(points);
      board.sparkle(points);
      chime(o.stroke);
      if (o.together) line("togetherDone");
      if (o.phaseDone) return phaseDone();
      refreshGuide();
      if (phase() === 1) demoSoon(450);
      return;
    }

    board.fadeLive();
    refreshGuide(); // switches to the follow-me / together look when it starts
    const s = strokes[o.stroke];
    const firstTime = session.misses === 3 || session.misses === 6;
    if (o.kind === "order") {
      pop();
      sayOrderSlip(o.drawn + 1, o.stroke + 1);
      board.highlight(s, o.stroke);
      if (o.help === "follow" || o.help === "together") demoSoon(2600);
      return;
    }
    boop();
    if (o.help === "replay") {
      line(pick(["again1", "again2", "again3"] as const));
      demoSoon(500);
    } else if (o.help === "pulse") {
      line("dot");
      board.pulseStart(s, o.stroke);
    } else {
      // Follow me: this stroke goes back to "watch and trace" until it's done.
      line(firstTime ? o.help : pick(["again1", "again2"] as const));
      demoSoon(450);
    }
  }

  function phaseDone() {
    setBusy(true);
    const k = kana();
    const p = phase();
    stage.classList.remove("cheer");
    void stage.offsetWidth; // restart the CSS bounce
    stage.classList.add("cheer");
    if (p === 3) {
      const sc = session.score();
      results.push({ kana: k, score: sc.score, retries: session.retried });
      drawings.push(session.drawing());
      fanfare();
      board.celebrate();
      sayKana(k, false);
      praise(); // queued: plays after the kana, never on top of it
    } else {
      pop();
      sayKana(k, false);
    }
    later(p === 3 ? 1900 : 1200, () => {
      stage.classList.remove("cheer");
      pi++;
      if (pi < phases.length) return startPhase();
      idx++;
      if (idx < plan.kana.length) return startKana();
      void finish();
    });
  }

  async function finish() {
    const score = Math.round(results.reduce((a, r) => a + r.score, 0) / results.length);
    const stars = starsFor(score);
    await recordSession(plan.kind, plan.kana, plan.input, plan.mode, {
      at: new Date().toISOString(),
      score,
      stars,
      perKana: results,
      drawing: drawings,
    });
    if (!destroyed) nav.done({ plan, score, stars, drawings });
  }

  return {
    el,
    mounted() {
      board.resize();
      preloadWord(plan.kana);
      startKana();
    },
    destroy() {
      destroyed = true;
      timers.forEach((t) => clearTimeout(t));
      pen.destroy();
      board.destroy();
      speechSynthesis?.cancel();
    },
  };
}

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)];
}
