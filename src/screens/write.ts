// The writing screen: each kana runs phase 1 (watch and trace) → 2 (trace) →
// 3 (write, scored), then the next kana. Only the cell, progress, replay,
// sound and home are on screen.

import type { Nav, PracticePlan, Screen } from "../app";
import { glyph } from "../data";
import type { Phase, Pt } from "../engine/matcher";
import { starsFor, type Stars } from "../engine/matcher";
import { CharacterSession, type Outcome } from "../engine/session";
import { boop, chime, fanfare, line, pop, praise, preloadWord, sandSwoosh, sayKana, sayOrderSlip, setSoundEnabled, soundEnabled, thunk, unlockAudio } from "../ui/audio";
import { Board } from "../ui/board";
import { h, html, ICON, iconButton, kanaSvg, mascot, quiet } from "../ui/dom";
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
    if (on) thunk(); // a little "tok" says sound is back; muting stays silent
  });
  quiet(soundBtn);
  const replayBtn = iconButton(ICON.replay, "Show me again", () => replay(), "replay");

  const paletteArea = h(
    "aside",
    { class: "palette-area" },
    inkPalette(settings.inkColor, (c) => {
      board.setInkColor(c);
      void saveSettings({ inkColor: c });
    }),
  );
  // The drawing square spans the page (so it is centred on it); the word strip,
  // ink colours and Watch/Trace/Write steps are pinned against the stone frame
  // once it is placed.
  const stageWrap = h("main", { class: "stage-wrap" }, stage, strip, paletteArea, pips);
  const topbar = h("header", { class: "topbar" }, iconButton(ICON.home, "Home", () => nav.home(), "home"), h("div", { class: "right" }, replayBtn, soundBtn));
  const el = h("div", { class: "screen write" }, topbar, stageWrap);

  const board = new Board(stage);
  board.inkColor = settings.inkColor;
  board.alignTop = true; // the word strip sits right under the top bar, the stones under it

  // The word strip, ink colours and steps keep their proportions to the stones:
  // at full size (ui = 1) they are sized for a frame at least REF px across;
  // a smaller frame (a short or narrow window) shrinks them by the same factor.
  const phone = () => innerWidth <= 480;
  const STRIP_GAP = 4; // space between the tiles' edge and the top stones
  const base = () =>
    phone()
      ? { swatch: 42, swatchGap: 12, pip: 38, stepGap: 12, mascot: 48, mascotGap: 6 }
      : { swatch: 48, swatchGap: 16, pip: 58, stepGap: 26, mascot: 58 * 1.15, mascotGap: 10 };
  /** Frame size (px) at which everything is full size: the colours fit along it, and the steps (with the octopus) under it. */
  const REF = () => {
    const b = base();
    const colours = 6 * b.swatch + 5 * b.swatchGap; // the picked one's ring may reach past the stones' edge
    const steps = 2 * (b.pip * 1.15 * 1.5 + b.stepGap + b.mascotGap + b.mascot); // Trace centred, octopus at the left
    return Math.max(colours, steps);
  };
  const MIN_UI = 0.5;
  let ui = 1;
  /** Visible stones ÷ the space they were given; measured after each layout. */
  let fill = 0.9;
  const stripH = (s: number) => 64 * s + 6; // the largest tile (58) grown 10% as the current one, + its raised lower edge (6)
  const paletteT = (s: number) => base().swatch * s * 1.08 + 22; // swatch + ring + gap
  const pipsH = (s: number) => base().pip * s * 1.15 + 10;
  const wide = (w: number, h: number) => w > h * 1.15;
  // How far below the top of the drawing area the top buttons' raised edge ends,
  // so the word strip starts exactly there (no gap, no overlap).
  const underTopBar = () => {
    const b = topbar.querySelector<HTMLElement>(".icon-btn");
    if (!b) return 0;
    const lift = parseFloat(getComputedStyle(b).getPropertyValue("--lift")) || 0;
    return b.getBoundingClientRect().bottom + lift - stageWrap.getBoundingClientRect().top; // may be negative
  };
  const reserveAt = (w: number, h: number, s: number) => {
    const top = underTopBar() + stripH(s) + STRIP_GAP; // the strip shows for single letters too
    return wide(w, h) ? { top, side: paletteT(s), bottom: pipsH(s) } : { top, side: 0, bottom: paletteT(s) + pipsH(s) };
  };
  let avail = 1;
  board.reserve = (w, h) => {
    // Shrinking the controls gives the stones more room, so settle the scale in a few steps.
    let s = 1;
    for (let i = 0; i < 4; i++) {
      const r = reserveAt(w, h, s);
      avail = Math.min(w - 2 * r.side, h - r.top - r.bottom);
      s = Math.max(MIN_UI, Math.min(1, (avail * fill) / REF()));
    }
    ui = s;
    stageWrap.style.setProperty("--ui", s.toFixed(3));
    return reserveAt(w, h, s);
  };
  board.onLayout = (f) => {
    if (avail > 0) fill = Math.min(f.w, f.h) / avail;
    const isWide = wide(stage.clientWidth, stage.clientHeight);
    stageWrap.dataset.layout = isWide ? "wide" : "tall";
    // Strip: centred on the frame, its tiles sitting on the top stones.
    const n = plan.kana.length;
    const tile = Math.max(34 * ui, Math.min(58 * ui, (f.w - (n - 1) * 8) / n));
    const sh = stripH(ui);
    Object.assign(strip.style, { left: `${f.x}px`, width: `${f.w}px`, top: `${f.y - sh - STRIP_GAP}px`, height: `${sh}px` });
    strip.style.setProperty("--tile", `${tile}px`);
    // Colours: just right of the stones (wide screens) or just under them (tall).
    Object.assign(
      paletteArea.style,
      isWide
        ? { left: `${f.x + f.w + 6}px`, top: `${f.y + f.h / 2}px`, transform: "translateY(-50%)" }
        : { left: `${f.x + f.w / 2}px`, top: `${f.y + f.h + 2}px`, transform: "translateX(-50%)" },
    );
    // Steps: under the colours (tall), or under the stones when the colours sit beside them (wide).
    const below = f.y + f.h + (isWide ? 4 : paletteT(ui) + 2);
    Object.assign(pips.style, { left: `${f.x + f.w / 2}px`, top: `${below + pipsH(ui) / 2}px` });
  };

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

  // Sand swoosh: loudness follows finger speed; goes quiet if the finger rests.
  let lastX = 0, lastY = 0, lastT = 0, sandQuiet = 0;
  const sandFollow = (x: number, y: number) => {
    const now = performance.now();
    const dt = Math.max(8, now - lastT);
    const speed = Math.hypot(x - lastX, y - lastY) / board.cell.size / (dt / 1000);
    lastX = x;
    lastY = y;
    lastT = now;
    sandSwoosh(speed);
    clearTimeout(sandQuiet);
    sandQuiet = window.setTimeout(() => sandSwoosh(0), 90);
  };
  const sandStop = () => {
    clearTimeout(sandQuiet);
    sandSwoosh(0);
  };

  const pen = new PenInput(stage, () => board.cell, {
    start(x, y) {
      unlockAudio();
      clearTimeout(demoTimer);
      board.beginLive(x, y);
      lastX = x;
      lastY = y;
      lastT = performance.now();
    },
    move: (xs, ys) => {
      board.extendLive(xs, ys);
      sandFollow(xs[xs.length - 1], ys[ys.length - 1]);
    },
    discard: () => {
      sandStop();
      board.dropLive();
    },
    end(points) {
      sandStop();
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

  // Both are built once and then only change classes, so the current tile and
  // step glide into place (CSS transitions) and only a newly earned sticker pops.
  function renderStrip() {
    if (!strip.childElementCount) {
      strip.append(
        ...plan.kana.map((k) => h("button", { class: "strip-tile", "aria-label": `${k}`, "data-quiet": "", onclick: () => sayKana(k) }, kanaSvg(k))),
      );
      }
    [...strip.children].forEach((t, i) => {
      t.classList.toggle("current", i === idx);
      t.classList.toggle("done", i < idx);
      if (i < idx && !t.querySelector(".sticker")) t.append(html(`<span class="sticker">${ICON.star}</span>`));
    });
    strip.querySelector(".current")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }

  /** Watch → Trace → Write, always all three (a skipped "watch" shows as done), so Trace stays centred. */
  function renderPips() {
    const now = phase();
    if (!pips.childElementCount) {
      pips.append(
        // The octopus watches the steps; positioned outside the row so Trace stays centred.
        mascot("pip-mascot"),
        ...([1, 2, 3] as Phase[]).map((p) => h("span", { class: "pip", title: PHASE_LABEL[p], html: PHASE_ICON[p] })),
      );
    }
    pips.querySelectorAll(".pip").forEach((el, i) => {
      const p = (i + 1) as Phase;
      el.classList.toggle("now", p === now);
      el.classList.toggle("done", p < now);
    });
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
    if (o.kind === "moveOn") {
      // Gentle, no fanfare: their try fades and the model stroke settles in its place.
      board.fadeLive();
      board.clearEffects(); // the together hints for the old stroke
      board.acceptLive(o.points);
      line("movedOn");
      if (o.phaseDone) return phaseDone();
      refreshGuide();
      if (phase() === 1) demoSoon(3200); // after the line, so the next demo isn't talked over
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
      results.push({ kana: k, score: sc.score, retries: session.retried, autoTraced: sc.stars === 0 });
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
    // 0 stars only if the app traced every letter itself; otherwise at least 1.
    const stars: Stars = results.every((r) => r.autoTraced) ? 0 : starsFor(score);
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
      sandStop();
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
