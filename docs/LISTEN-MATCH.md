# Listen & Match: sound matching mini game

Markdown copy of `docs/Hiragana Buddy - Sound Matching Mini Game.docx` (Nov 25, 2026 draft).
The implementation decisions from 2026-11-25 are folded in and marked **v1:**. Where this
file and the .docx disagree, this file wins. Build plan: `plans/sound-match.md`.

## Overview and goals

The app plays a kana sound and the child taps the matching tile out of eight. A game is eight
rounds, one per tile, and ends with 1–3 stars for how many rounds were right on the first tap.
Writing teaches what a kana looks like and how to form it; matching teaches what it sounds like.

Goals:
- A pre-reader can start and finish a game with no adult help and no text to read.
- Every game ends with at least one star. Mistakes slow the child down but are never marked as failure.
- A native Japanese speaker would approve every clip.
- Reuse the writing game's kana data, saved words, star display and audio, so it feels like one app.
- A child can see how far they've come: in this game and along the sets.
  (**v1:** the "across all the kana" level, ear badges, is out.)

Success: 5–6-year-olds finish a game in about 2–4 minutes without asking what to do;
first-tap accuracy rises on repeat; a native speaker passes every clip; after a game a child
shows a parent what they won without being asked.

Out of scope for v1: katakana, timers or speed scoring, leaderboards, the reverse game (see a
kana, pick a sound), and links between the matching and writing games.

## Getting in

The home screen gets a third main button, **Listen & Match / きいて えらぼう**, with an ear icon.
**v1:** the button is hidden behind a grown-ups switch ("Try Listen & Match") until the
native-speaker clips pass review, then it's on by default.

It opens the **set path**: stepping stones through the pebble garden, one stone per set, with
the current set centred, the mascot standing on it and the stone bobbing. The current set is
the first stone without 3 stars, and one tap on it starts the game. Each stone shows the set's
first kana and three star outlines that fill with its best result. A stone opens when the one
before it reaches 3 stars; stones behind the mascot stay open for replay.
**My word** stones sit in a short row above the path and are always open.
**v1:** the row shows the 3 most recently practised saved words.

## One game, round by round

- **First visit.** **v1:** no practice round. The spoken intro ("Listen, then tap the one you
  hear!", Japanese then English) plays on the very first game.
- **First game on a new set.** The eight tiles arrive one at a time, each saying its sound
  (about 8 s). Later games on that set go straight to round 1.
- The board shows eight kana tiles, with an empty pebble tray of eight slots along the top.
  Tile positions are shuffled each game.
- A round starts when the mascot says one kana. The mascot wears a speaker badge and is the
  **speaker button**: tapping it replays the sound at any time, free.
- **Correct tap:** the tile pops, a chime plays, the kana plays again, and the tile hops into
  the next tray slot, leaving a gap. Other tiles don't move.
  **v1:** every found tile lands as the same pebble (no gold/plain distinction).
- **Wrong tap:** a soft wiggle and a gentle "boop", and the prompt plays again. No red, no X,
  no buzzer. The child keeps trying.
- **Third wrong tap in a round:** the right tile glows and the mascot looks at it.
- The next round starts by itself about a second after the pebble lands. No Next button.
- After all eight tiles are in the tray, the game goes to the results.

## Scoring

A round is a **first-pick hit** if the first tile tapped after the sound was right. Replays
don't count against the child.

| First-pick hits (of 8) | Accuracy | Stars |
| --- | --- | --- |
| 7–8 | 88–100% | 3 |
| 5–6 | 63–75% | 2 |
| 1–4 | 13–50% | 1 |

Found tiles leave play, so the last round is a guaranteed hit and random tapping averages
about 2.7 hits; 5+ shows real recognition. Thresholds are one config value. Each set's best
stars are saved and shown on its stone and on the home screen, in the saved-words star style.

## Progress the child can see

| Level | What the child sees | When it changes |
| --- | --- | --- |
| This game | The pebble tray fills left to right | Every round |
| The sets | The mascot moves along the path; stars sit on each stone | After each game |

**v1:** ear badges on the kana chart are out.

## Rewards

Every reward shows the child something they did. Nothing is random, and nothing earned is
ever taken away.

- **During the game:** pop, a chime one note higher than the last, the kana spoken again, and a
  pebble in the tray. The eighth pebble completes the rising scale.
- **After the last tile** (about 6 s, a tap skips ahead): the full tray moves to the centre and
  the mascot cheers with a praise line from the writing game's pool, for every child. Then the
  1–3 stars fill in with the rising chime (**v1:** no gold-pebble count-up). Two picture
  buttons: play again, or go on along the path.
- **Back on the path:** new best stars fly onto the stone; a worse replay leaves the best in
  place. When a set first reaches 3 stars, the next stone flips open and the mascot hops onto it.
- Never: streaks, daily rewards, countdowns, coins, shops or surprise prizes.

## Tile sets

Every set has exactly 8 full-size kana.

| Class set | Kana |
| --- | --- |
| 1 | か て く み き つ た め |
| 2 | し ま う は あ こ さ と |

- **Class sets** are curated in the order the class practises them. Sets 3+ are still to come.
  **v1:** until then the path continues with auto-filled sets (see `plans/sound-match.md`).
- **Dakuten sets:** **v1:** deferred until curated.
- **My word set:** the kana of a saved word, padded to 8 with random basic kana. Padding never
  sounds the same as a kana in the set and never makes a hard pair with one. A word of 8+ kana
  uses its first 8 distinct kana. Small kana (ゃゅょっ…) and ー are skipped.

Rules for every set:
- No two tiles sound the same: じ/ぢ, ず/づ, お/を.
- Hard pairs are never added as filler. **v1 list:** し/ち, す/つ, る/ろ, ぬ/む, ね/れ. A curated
  set keeps a hard pair the curriculum teaches together, and a hard pair inside the child's own
  word stays.

## Designing for pre-readers

- No words on screen tell the child what to do. The spoken intro plays the first time only.
- After about 6 s with no tap, the speaker button pulses gently. The sound never replays by
  itself, and waiting never counts as a miss.
- Tiles at least 2 cm (about 80 pt) square with at least 1 cm gaps. Phone portrait 2×4; tablet
  and landscape 4×2.
- Taps count only after the prompt finishes. Palm rejection and first-touch-wins come from the
  writing game.
- No timers, no lives, no game over.
- Sound effects are quieter than the kana voice.
- Tiles draw kana from the stroke data, not a print font (き, さ, り look as taught).
- Steady beat: about 2 s from a correct tap to the next sound.
- Can't be played silent: if mute is on, the button shows a crossed-out speaker and tapping it
  turns sound on before the path opens.
- A small home button in a top corner shows two pictures: keep playing, or leave. An unfinished
  game isn't scored.
- Reduced motion: hops and bobs become fades.

## Grown-ups

Behind the press-and-hold settings gate: reset set progress; **Unlock whole path** (opens every
stone; turning it off closes unearned stones and keeps every star); the sounds the child most
often mixes up, next to the writing game's list. **v1:** the "Try Listen & Match" switch lives
here too. Progress is keyed by profile; **v1** has only the built-in profile.

## Audio refinement

In this game the sound *is* the question, so the stock clips must be fixed before launch, and
fixed clips go into the writing game too.

1. **Audit:** a dev-only review page lists every kana with play and Pass / Fix / Replace, and
   exports a review sheet. Check first: ふ (no English f), らりるれろ (light tap), し/ち/つ (not
   si/ti/tu), ん (plain hum), を (same as お), う (short, lightly rounded), and every clip one
   short syllable with no clipped end, breath or reverb.
2. **Source:** a native-speaker parent from the school records the final set, with written
   permission. TTS fills in during development. Record all 46 basic + 25 dakuten/handakuten kana
   (71 clips) plus the intro lines in Japanese and English. (No complete openly licensed
   single-speaker kana set was found on 2026-11-24; Lingua Libre could run the session if the
   parent is happy for clips to be public.)
3. **Spec:** quiet room, phone or USB mic, 3 takes per kana, calm, friendly, slightly slow.
   About 30 ms silence each side, 0.4–0.8 s clips, mono 48 kHz source, loudness-matched,
   peaks below −1 dBFS, .mp3 or .m4a per kana. WAVs stay out of git. A native speaker passes
   every clip on the review page before release.

## Data model

```
KanaSet      { id, label, kana: [8 kana], kind: "class" | "auto" | "word" }
GameSession  { profileId, setId, tileOrder: [8], promptOrder: [8], round: 0..7,
               found: [kana], firstPickHit: [bool × 8], wrongTaps: [count × 8],
               taps: [{round, kana, tilesLeft, t}] }
MatchResult  { profileId, setId, playedAt, hits: 1..8, stars: 1..3 }
KanaProgress { profileId, kana, mixedUpWith: {kana: count} }
```

Best stars, unlocks and "preview already seen" are derived from MatchResult rows. The tap log
stays on the device and is never sent anywhere.

## Game logic

- Tile order and prompt order are shuffled separately each game.
- Input is locked while any kana voice clip plays; taps during the lock are ignored and not counted.
- Only a round's first tap sets `firstPickHit`; later wrong taps are logged but change nothing.
- Stars: ≥7 → 3, ≥5 → 2, else 1 (config).
- Wrong taps are counted per round; the third turns on the glow. A round ends only on the right tile.
- `unlocked(setId)`: the previous set's best is 3 stars, or the parent's Unlock whole path is on.

## Risks

- **iOS audio:** silent until first tap; mute switch / Low Power Mode. Unlock on the home
  screen's first tap; show a visual "sound on?" hint if playback fails.
- **Guessing:** wrong taps only wiggle and replay, and thresholds sit above the random average.
- **Audio slips:** final recordings must pass review before release.
- **Stalling on a stone:** 3 stars needs 7/8. The tile preview, the glow hint, the mixed-up list
  and the Unlock switch help; playtests count games per stone.

## Open

- Which parent records, and when (written permission first).
- Class sets 3+ and dakuten sets.
