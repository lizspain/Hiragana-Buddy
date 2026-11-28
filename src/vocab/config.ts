// Look and Write tuning knobs and names in one place
// (docs/VOCAB-SPELLING-DESIGN.md, plans/vocab-spelling.md).
// Stars use Listen & Match's STAR_THRESHOLDS (match/config.ts), and the hint
// its HINT_AFTER_WRONG, so both games score and help the same way.

/** The game's name in the app (Liz, Nov 2026). Its home icon is the eye from stage 1A. */
export const VOCAB_NAME = { en: "Look and Write" } as const;

/** The home card's icon: the eye picture (め) from the first set of word pictures. */
export const VOCAB_ICON = "vocab/me.webp";
