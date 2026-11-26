import type { Stars } from "../engine/matcher";
import { STAR_THRESHOLDS } from "./config";

/** Stars for a finished game: every game earns at least one. */
export function starsFor(hits: number): Exclude<Stars, 0> {
  if (hits >= STAR_THRESHOLDS.three) return 3;
  if (hits >= STAR_THRESHOLDS.two) return 2;
  return 1;
}
