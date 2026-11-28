// What Look and Write remembers: one row per finished game (docs/VOCAB-SPELLING-DESIGN.md
// "Data model"). Best stars and unlocks are worked out from these rows with
// the helpers Listen & Match uses; store.ts persists them.

import { addGameResult, bestGameStars, mergeGameResults } from "../match/progress";

export interface VocabResult {
  profileId: string;
  stageId: string;
  /** ISO time the game finished. */
  playedAt: string;
  /** Words spelled with no wrong tile, 0–8. */
  cleanWords: number;
  stars: 1 | 2 | 3;
}

export const addVocabResult = (rows: VocabResult[], r: VocabResult): VocabResult[] => addGameResult(rows, r, "stageId");
export const bestVocabStars = (rows: readonly VocabResult[], profileId: string, stageId: string) => bestGameStars(rows, "stageId", profileId, stageId);
export const mergeVocabResults = (mine: VocabResult[], incoming: unknown): VocabResult[] => mergeGameResults(mine, incoming, "stageId");
