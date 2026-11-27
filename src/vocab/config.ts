// Make a Word tuning knobs and names in one place
// (docs/VOCAB-SPELLING-DESIGN.md, plans/vocab-spelling.md).
// Stars use Listen & Match's STAR_THRESHOLDS (match/config.ts), and the hint
// its HINT_AFTER_WRONG, so both games score and help the same way.

/** The game's name in the app: a working label until Liz picks the final one. */
export const VOCAB_NAME = { ja: "ことばを つくろう", en: "Make a Word" } as const;
