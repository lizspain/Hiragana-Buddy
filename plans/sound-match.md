# Listen & Match — implementation plan

Source of truth: `docs/Hiragana Buddy - Sound Matching Mini Game.docx` (Nov 25, 2026 draft).
Branch: `sound-match`, cut from `main` at 2bc8ff7 (ui-polish merged, PR #8).
Status: decisions settled 2026-11-25 (see below). Milestones 1–3 done; next: milestone 4.

### Milestone 3 notes (2026-11-26)

- `sets.ts`: `PATH_SETS` = class 1–2, then `AUTO_SETS` 3–6, kept as fixed data exactly as
  drafted below and pinned by tests (every basic kana except を is covered). `wordSet(word)`
  builds a My word set, keeps the word's hard pairs, and pads with random filler that never
  clashes. Its id is `word:<kana>`, and the padding is new each game.
- `progress.ts` (pure, tested): `MatchResult` rows (capped at 2000, never dropping a set's
  best), per-kana `mixedUpWith` counts, `topMixUps` for the grown-ups view, and backup
  merges that are safe to repeat.
- `store.ts`: `matchResults` and `kanaProgress` keys beside `items`. `recordMatch` runs when
  results show; an unfinished game isn't saved. Every row has `profileId` `p1`. Backups are
  `version: 2` and still read version 1 files.
- `nav.match(id)` takes a path stone id or `word:…`. No UI reaches word sets until milestone 4.
- The speaker button now uses the entry page's Hear it button style (`.shelf-play.hear-play`).

### Milestone 2 notes (2026-11-26)

- Playable on class set 1. Turn on Settings → "Try Listen & Match" (grown-ups gate) and a
  green Listen & Match button appears on home. The launch gate came forward from
  milestone 5 so the prototype can be tried on devices after deploy; the mute → crossed
  speaker → sound back on behaviour came with it.
- `src/match/` has `config.ts`, `sets.ts` (class sets 1–2 and the rule checker),
  `scoring.ts`, `game.ts` (the state machine) and `match.css`. The screen is
  `src/screens/match.ts`.
- Tile taps land on release over the same tile. The first touch wins, and a palm-sized
  contact is ignored (`isPalmContact`, shared with the writing stage).
- Found tiles fly to the tray (the Web Animations API, about 0.56 s) and become pebbles with
  the kana on them. Finds climb a C-major octave (`stepChime`), ending on C.
- Results: the tray slides into the centre, the octopus dances, a praise line plays, stars
  fill one by one, then Play again / Go on. A tap skips ahead. "Go on" goes home until the
  path exists (milestone 4).
- Not yet: saving results, the tile preview, the path, the spoken intro.
- Tests: `src/match/game.test.ts` (14) and `e2e/match.spec.ts` (7 × phone/tablet).

### Milestone 1 notes (2026-11-25)

- `ui/audio.ts`: every voice line returns a promise that resolves when it has been heard,
  interrupted or dropped (it never rejects, so the game's input lock can't stick). Added
  `preloadKana`, `kanaClipFile`/`kanaClipBuffer`, `onVoiceTrouble`, and an SFX bus
  (`SFX_LEVEL`, now 1: TTS clips peak at about −1.5 dBFS, well above the chimes).
- Homophones `を→お`, `ぢ→じ`, `づ→ず` play their twin's clip (`SOUNDS_LIKE` in
  `audio-lines.ts`), in both games.
- Review page: `npm run dev`, open `/#audio-review`. Dev build only (checked: not in `dist`).
- Automated audit of the current Kokoro `jf_alpha` clips: all 71 present; sound lengths
  260–655 ms (median 385), so 42 fall under the spec's 0.4 s. That's expected of TTS, and the
  slower recorded voice should fix it. は and わ peak at −1.0 dBFS (right at the limit).
  Loudness is even (within ±3 dB). Silence at each end is 70–100 ms, more than the
  30 ms spec but not flagged. Listening checks (ふ, ら行, し/ち/つ, ん, う) are Liz's
  to do on the page.

## How the doc maps onto this codebase

The doc names modules as `.js` files and a new `AudioBank`. The app is TypeScript and
already has most of the plumbing, so the plan reuses it:

| Doc module | Here | Notes |
| --- | --- | --- |
| `audio/AudioBank.js` | extend `src/ui/audio.ts` | Already decodes clips into Web Audio buffers from `public/audio/manifest.json`, unlocks on first tap, and has `chime(step)`, `boop()`, `pop()`. Add: `sayKana` returning a promise that resolves when the clip ends (for the input lock), `preloadKana(list)`, a "playback failed" signal for the "sound on?" hint, and SFX gain below the voice. No second audio module. |
| `match/sets.ts` | `src/match/sets.ts` | Curated sets, My word builder, validators. Pure, unit-tested. |
| `match/MatchGame.js` | `src/match/game.ts` | DOM-free state machine (`preview → prompt → await → found/wrong → … → done`). Scripted-tap tests. |
| `match/scoring.js`, `progress.js` | `src/match/scoring.ts`, `src/match/progress.ts` | Pure; thresholds and rules in one `src/match/config.ts`. |
| `SetPath.js`, `MatchScreen.js`, `ResultsScreen.js` | `src/screens/path.ts`, `src/screens/match.ts`, `src/screens/match-done.ts` | Same pattern as other screens: a function returning `Screen`, registered in `app.ts` `nav`. |
| tiles from stroke data | `kanaSvg` in `src/ui/dom.ts` | Already renders a kana from `kana-strokes.json`. Tiles are plain `<button>`s (doc's call). |
| IndexedDB stores | `src/store.ts` | The app keeps one idb-keyval store with whole-array keys (`settings`, `items`). Add `matchResults` and `kanaProgress` keys the same way; backup bumps to `version: 2` and still reads version 1. |
| parent gate | `holdButton` + `src/screens/parent.ts` | Add "Reset set progress", "Unlock whole path", and "Sounds mixed up most". |
| audio review page | `#audio-review` route, dev build only | Behind `import.meta.env.DEV`, so it never ships. Exports a CSV/JSON review sheet. |

Rules carried over from `CLAUDE.md`: never discouraging, nothing leaves the device,
touch first with palm rules, at least 40 fps, no new runtime dependencies, and the first load
stays under 150 KB gzipped.

## Milestones on this branch

Each one ends green (`npm test`, `npm run build`, Playwright) and is a commit point.

1. **Audio foundation**: audio.ts additions above, the dev review page, and the audit of the
   current Kokoro `jf_alpha` clips against the doc's checklist. Found already: `を` has its
   own clip, not the `お` clip; alias it. The current TTS stays as the interim voice.
2. **Playable prototype**: class set 1 hard-coded; board (2×4 portrait / 4×2 landscape,
   tiles ≥ 80 pt), mascot speaker button, input lock while voice plays, wiggle and boop
   on a wrong tap, glow after the 3rd wrong tap, gaps stay, pebble tray, auto-advance
   about 2 s, results count-up. Unit tests for game, scoring.
3. **Sets and saving**: class sets 1–2, auto-filled sets, My word set builder, the
   `matchResults` and `kanaProgress` keys, and backup/restore.
4. **Progress and rewards**: set path with stones, stars, mascot and unlocks, the auto-filled
   stones, the My word row; stars flying from the results to the path; tile preview on a
   set's first game.
5. **Polish**: pebble-garden styling, rising chimes, spoken intro (JA then EN, new
   `LINES` entries rendered through `scripts/voice`), grown-ups settings (reset, unlock
   whole path, "Try Listen & Match" gate, mixed-up sounds), reduced motion, mute → crossed
   speaker on the home button.
6. **Tests and checks**: Playwright for a full game (all first-tap → 3 stars; all wrong →
   1 star, never stuck), the tap lock, palm rejection on tiles, and the bundle-size check.

Out of this branch (the doc's milestones 6–7): the native-speaker recording session and
playtests. The code makes them a drop-in: new clips replace `public/audio/ja/*` through
the manifest.

## Decisions (grilling with Liz, 2026-11-25)

These override the design doc where they differ. Mirrored in `docs/LISTEN-MATCH.md`.

| Topic | Decision |
| --- | --- |
| Set path and mascot | **In.** Stepping stones, stars on each stone, mascot on the current set. |
| Practice round (first visit, 2 tiles, hand demo) | **Out.** |
| Tile sound preview on a set's first game | **In.** It's the first-timer's warm-up. The spoken intro (JA then EN) still plays on the very first game. |
| Gold/plain pebbles | **Out.** Every found tile becomes the same pebble. After the cheer, 1–3 stars fill in with the rising chime. Stars still count first-tap hits. |
| Ear badges on the kana chart | **Out.** |
| Per-kana tap log | **Kept**, for the grown-ups view's "sounds mixed up most" list (on-device only). |
| Glow after the 3rd wrong tap; tiles drawn from stroke data | In (not separately questioned; part of the decided wrong-tap flow and the doc's tile rules). |
| Profiles | Every match record carries `profileId`; v1 uses the existing single built-in profile `p1`. No profile picker. |
| Dakuten sets | **Deferred** until curated. |
| Path after class sets 1–2 | **Auto-filled** stones from the remaining basic kana (below), until class sets 3+ are curated. |
| My word row | The **3 most recently practised** saved words, one stone each. Stars for older words are kept. |
| Hard pairs (never used as filler) | し/ち, す/つ, る/ろ, ぬ/む, ね/れ. In `config.ts`. |
| Homophones (never in one set) | じ/ぢ, ず/づ, お/を. |
| Launch gate | The home button is hidden behind a grown-ups switch ("Try Listen & Match") until the native-speaker clips pass review; then it's on by default. |
| Delivery | One PR per milestone, merged to `main` (deploys to Pages). |
| Docs | `docs/LISTEN-MATCH.md` (markdown copy plus these decisions), both `.docx` files and this plan are committed. |

### Auto-filled path sets (draft, for Liz to check)

After sets 1–2, 29 basic kana are left (を is dropped as a homophone of お). They are chunked
in gojūon order, with no hard pair inside any set, and the last set is padded from set 1–2 kana:

| Stone | Kana |
| --- | --- |
| 3 | い え お け す せ そ ち |
| 4 | な に ぬ ね の ひ ふ へ |
| 5 | ほ む も や ゆ よ ら る |
| 6 | り れ ろ わ ん + あ か さ |

They're computed by `sets.ts` and pinned by a unit test, so the stones never change under a
child's saved stars. Replace them with curated class sets 3+ when they arrive. Set ids stay
stable (`class-3`… vs `auto-3`…), so stars on auto stones aren't carried over to curated ones.

## Still open (not blocking milestone 1)

- Who records, and when (the doc's open question).
- Class sets 3+ and dakuten sets: curated contents.
