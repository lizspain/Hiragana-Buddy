// The end-of-game results, shared by Listen & Match and Make a Word
// (docs/LISTEN-MATCH.md "Results", docs/VOCAB-SPELLING-DESIGN.md "Rewards"):
// the full pebble tray slides to the centre, the mascot dances and everyone is
// cheered, then the stars fill one at a time on a rising chime, then two
// picture buttons: play again, or go on along the path. A tap anywhere skips
// to the end.

import { praise, stepChime } from "../ui/audio";
import { pageBurst } from "../ui/burst";
import { dance } from "../ui/dance";
import { h, ICON, iconButton, stars as starsEl } from "../ui/dom";

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface ResultsOptions {
  /** The game screen (gets `finished`, and listens for the skip tap). */
  screen: HTMLElement;
  /** What the results panel replaces. */
  stage: HTMLElement;
  /** The game's pebble tray; it moves into the panel. */
  tray: HTMLElement;
  stars: 1 | 2 | 3;
  playAgain: () => void;
  goOn: () => void;
  /** The screen's own timer and cleanup lists, so leaving mid-sequence stops it. */
  later: (fn: () => void, ms: number) => void;
  cleanups: (() => void)[];
}

export function showResults(o: ResultsOptions): void {
  const octo = dance("dance match-dance");
  o.cleanups.push(octo.stop);
  // Only the stars earned: drawn hidden, then revealed one at a time (never empty outlines).
  const starRow = starsEl(o.stars, "stars big match-stars");
  for (const s of starRow.querySelectorAll(".star")) s.classList.replace("on", "pending");
  starRow.setAttribute("aria-label", "0 stars");
  const actions = h(
    "div",
    { class: "match-actions" },
    iconButton(ICON.replay, "Play again", o.playAgain, "big-round"),
    iconButton(ICON.play, "Go on", o.goOn, "big-round go-on"),
  );
  // The full tray moves to the centre: re-parent it, then slide it from where it was.
  const before = o.tray.getBoundingClientRect();
  const panel = h("section", { class: "match-results", "data-testid": "results" }, octo.el, o.tray, starRow, actions);
  o.screen.classList.add("finished");
  o.stage.replaceChildren(panel);
  if (!reducedMotion()) {
    const after = o.tray.getBoundingClientRect();
    o.tray.animate(
      [{ transform: `translate(${before.left - after.left}px, ${before.top - after.top}px) scale(${before.width / after.width})`, transformOrigin: "0 0" }, { transform: "none", transformOrigin: "0 0" }],
      { duration: 700, easing: "cubic-bezier(.23,1,.32,1)" },
    );
  }
  praise();

  // Stars fill one at a time on the rising chime; a tap anywhere jumps to the end.
  const n = o.stars;
  let shown = 0;
  const fill = () => {
    if (shown >= n) return;
    const s = starRow.children[shown] as HTMLElement;
    s.classList.replace("pending", "on");
    stepChime(2 + shown * 2);
    shown++;
    if (shown === n) o.cleanups.push(pageBurst(s));
  };
  const finish = () => {
    while (shown < n) fill();
    starRow.setAttribute("aria-label", `${n} star${n === 1 ? "" : "s"}`);
    actions.classList.add("show");
    o.screen.removeEventListener("pointerdown", skip);
  };
  const skip = (e: Event) => {
    if (!(e.target as Element).closest(".match-actions")) finish();
  };
  o.screen.addEventListener("pointerdown", skip);
  for (let i = 0; i < n; i++) o.later(fill, 1600 + i * 550);
  o.later(finish, 1600 + n * 550 + 700);
}
