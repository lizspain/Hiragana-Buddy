# Make a Word (Vocabulary Spelling): build plan

Design: `docs/VOCAB-SPELLING-DESIGN.md`. Branch: `vocab-spelling`, from
`sound-match` (it reuses Listen & Match code that isn't on main yet).

## Decisions (Liz, 2026-11-27)

| Question | Answer |
| --- | --- |
| Branch | New branch `vocab-spelling` from `sound-match` |
| Where Liz first plays 1A | Pushed to the branch's own preview (vocab-spelling.hiraganabuddy.pages.dev) |
| Pictures | Liz is sending sprite sheets for 1A, 1B, 2A, 2B plus a chopsticks sprite; until then, plain placeholders named by word id |
| Preview of a new stage's words | No preview |
| Name, icon | Open. Working label ことばを つくろう / "Make a Word", behind one constant |
| Collected-words shelf | Open (later version) |

## What is reused, what changes in shared code

| Piece | Where | Plan |
| --- | --- | --- |
| Stars from a count of 8 | `match/scoring.ts`, `match/config.ts` | Shared as is (7 → 3, 5 → 2) |
| Unlock rule, current stone | `match/progress.ts` `pathState`, `currentStone` | Shared as is |
| Results (tray to centre, cheer, stars count up, play again / go on) | inside `screens/match.ts` | Move into a shared module both games call |
| Path screen | `screens/path.ts` (tied to Listen & Match sets) | Make it take a list of stages, a stone face, best stars and a start route |
| Pebble tray | `match.css` | Add a gold pebble (Listen & Match keeps plain ones, as decided 2026-11-25) |
| Kana sounds | `ui/audio.ts` `sayKana` | Shared as is |
| Word clips | `ui/audio.ts` | New: `sayVocab`, `preloadVocab`, `vocabClipBuffer` reading `audio/words/manifest.json` |
| Palm rules | `ui/pen.ts` `isPalmContact` | Shared as is |
| Drag | none yet | New in the vocab screen |

## Word clips (milestone 1)

`node scripts/gen-kana-audio.ts --words` (add `--fresh` to rebuild, `--only
hashi,ame` for a few). Speed 0.85 (kana clips use 0.75), otherwise the kana
processing. Accents use VOICEVOX's numbering: 1 = high then low; the number of
kana = low then high. After setting an accent the script asks the engine for
the mora pitch again (`/mora_data`): without that, the accent number alone
changes nothing.

Pitch set by hand: the five in the spec (はし ×2, あめ, かき, した), plus six
the engine got backwards for standard Tokyo pitch: かみ (it said "god"), みみ,
あし, うた, みて, かた. Unsure, for the native speaker: くま, こま, しか, とまと
(the engine's own pitch).

## Milestones

1. Word data, validator, word clips, review page.
2. Stage 1A playable: state machine and tests first, then tap placement, the
   finish sequence and results. Push to the branch preview for Liz to play
   on a tablet.
3. Drag, hint, はし, all four stages, `vocabResults` in backup and restore.
4. Path, unlocks, parent switch, home button (2 × 2), first-visit practice word.
5. Polish: star spray, sound effects, reduced motion.
