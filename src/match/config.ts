// Listen & Match tuning knobs, in one place so playtests can change them
// (docs/LISTEN-MATCH.md, plans/sound-match.md).

import { SOUNDS_LIKE } from "../audio-lines";

export const TILES_PER_GAME = 8;

/** First-pick hits needed for 3 and 2 stars; anything less is 1 star. */
export const STAR_THRESHOLDS = { three: 7, two: 5 } as const;

/** The third wrong tap in a round makes the right tile glow. */
export const HINT_AFTER_WRONG = 3;

/** Correct tap → next prompt: about 2 s in all (the found kana is said again in between). */
export const NEXT_ROUND_MS = 900;

/** No tap this long after a prompt → the speaker button pulses. It never replays by itself. */
export const IDLE_PULSE_MS = 6000;

/** Pairs pronounced identically: never both in one set. */
export const HOMOPHONES: readonly (readonly [string, string])[] = Object.entries(SOUNDS_LIKE).map(([a, b]) => [b, a] as const);

/** Pairs easily heard as each other: never added as filler (decided 2026-11-25). */
export const HARD_PAIRS: readonly (readonly [string, string])[] = [
  ["し", "ち"],
  ["す", "つ"],
  ["る", "ろ"],
  ["ぬ", "む"],
  ["ね", "れ"],
];
