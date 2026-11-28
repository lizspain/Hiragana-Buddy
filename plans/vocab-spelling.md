# Look & Write (Vocabulary Spelling): build plan

Design: `docs/VOCAB-SPELLING-DESIGN.md`. Branch: `vocab-spelling`, from
`sound-match` (it reuses Listen & Match code that isn't on main yet).

## Decisions (Liz, 2026-11-27)

| Question | Answer |
| --- | --- |
| Branch | New branch `vocab-spelling` from `sound-match` |
| Where Liz first plays 1A | Pushed to the branch's own preview (vocab-spelling.hiraganabuddy.pages.dev) |
| Pictures | Liz is sending sprite sheets for 1A, 1B, 2A, 2B plus a chopsticks sprite; until then, plain placeholders named by word id |
| Preview of a new stage's words | No preview |
| Name, icon | "Look & Write" (with &, like Listen & Match), icon: the eye picture (め) from stage 1A (Nov 27). In `vocab/config.ts` |
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

## Milestone notes

- 2 (Nov 27): stage 1A playable; Liz tested on iPad, works. Results moved to
  `match/results.ts` for both games.
- Stars everywhere show only what was earned, never empty outlines (playtest,
  Nov 27; in CLAUDE.md). Stones on the path will show earned stars only.
- 3 (Nov 27): `vocabResults` store (backup version 3, merged on restore).
  The result helpers in `match/progress.ts` are now generic over the stone
  field (setId / stageId), so both games share them. はし plays bridge, then
  chopsticks, lighting each picture, at the prompt, on replays and at the
  finish. All four stages play (unit test per stage; e2e plays 2B). Until the
  path lands, tests open a stage through `window.hbNav` (only when
  `navigator.webdriver`).
- 4 (Nov 27): the stone path is shared (`screens/stone-path.ts`); Listen &
  Match passes its kana faces and My word row, Look & Write its pictures. Home
  opens the Look & Write path. Grown-ups card: Unlock whole path. First-visit
  practice word: つき, unscored, no pebble; a hand taps the tile for the
  first letter, then loops a drag of the next tile to its slot until the child
  does it (it never moves a tile itself). Picture stones are larger than
  Listen & Match stones; the picture is about 90 px, a little short of the
  spec's 3 cm.
- Path change (Nov 27): stones that aren't open aren't shown, on both paths;
  the next one appears when the one before reaches 3 stars (or all appear with
  Unlock whole path).
- 5 (Nov 27): the real pictures. Liz's sheets in art-source/vocab/ (4 x 2 grids in
  worksheet order, plus the chopsticks) are cut by scripts/cut-vocab-art.py into
  33 transparent 512 px WebP files in public/vocab/ (723 KB, precached). Polish: a
  thunk when a tile is picked up to drag, a twinkle with the star spray, a pebble
  clink (brighter for gold). Reduced motion: the bounce fades, the spray becomes a
  golden glow, pebbles fade in. Larger pictures on tablets (up to 340 px).
- Playtest fixes (Nov 28): a wobbly tap (lifted within 30 px of where it
  landed) is a tap, in both games. The say-it-again button is a play button at
  the picture's lower right (on a phone, under はし's second picture); the
  mascot left the game's top row. Home is the full-size button at the top left
  on both games and both paths, and the trays shrink to fit beside it. Holding
  the old button on an iPad left the game silent: iOS had "interrupted" the
  audio and the app only woke it from "suspended". Now any tap wakes it from
  either, and the game screens turn off the iOS long-press bubble.
