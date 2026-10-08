# Hiragana Writing Buddy — brief for Claude Code

You are building a static mobile/tablet web app that teaches pre-reading
kindergartners (age ~5–6, English/Japanese immersion) to write a word or their
name in hiragana, one character at a time. Full design doc: `docs/DESIGN.md`
(read the relevant sections before each milestone). This file is the working
summary; if the two disagree, ask before guessing.

## Non-negotiables

- Never discouraging. No red, no X marks, no buzzers, no "wrong", no timers,
  no lives. Every finished word earns at least 1 star.
- Stroke order is enforced: only the next expected stroke can be accepted.
- Ink appears under the finger on the next frame, in every phase.
- 40 fps minimum, 60 target, on a mid-tier phone and a base iPad.
- Touch first, mouse must work too. Palms and resting hands must do nothing.
- Nothing leaves the device: no analytics, no network calls except loading
  the app's own static files. No accounts.
- Static site only (GitHub Pages / Cloudflare Pages).

## Stack

TypeScript + Vite, Preact (or plain DOM), Canvas 2D (three layers: guide, ink,
effects), IndexedDB (`idb-keyval`), `vite-plugin-pwa`, WanaKana for romaji,
Web Speech API for spoken kana. Vitest + Playwright.

## What is already in this pack

| Path | What | Use |
| --- | --- | --- |
| `data/kana-strokes.json` | 87 glyphs from KanjiVG: per stroke `d` (SVG path, 0–109 space), `points` (32 pts, 0–1 cell), `length`, `numberPos` | Ghosts, demos, start dots, matching |
| `data/kana-table.json` | Chart layout (basic, voiced, small), romaji, `speak` text, `small` flag, plus ー | Kana chart, tile editor, speech |
| `data/en-names-words.json` | 176 English names + 44 words → katakana + hiragana, mora count, Japanese word for words | Mode A tier 1 lookup |
| `reference/stroke-matcher.js` | Tested matcher: `compareStroke`, `judgeNext`, `warmth`, `scoreCharacter`, tolerances per phase | Port to TS as `src/engine/matcher.ts`; keep behaviour |
| `tests/matcher.test.mjs` | Synthetic child-trace tests (`node --test tests/matcher.test.mjs`) | Keep passing in CI after the port |
| `reference/kana-preview.png` | Every glyph with coloured, numbered strokes | Visual check of the data |
| `scripts/*.py` | Rebuild the JSON from KanjiVG / edit the name list | Re-run if data changes |
| `data/ATTRIBUTION.md` | Licences | Show KanjiVG credit in the About screen |

Notes on the data:
- `d` paths are in KanjiVG's 109×109 space; scale by `cellSize/109`. `points` are already 0–1.
- Small kana are already drawn small and low; draw them in the same full cell.
- ー is one horizontal stroke (U+30FC). Keep it in names by default; the
  `expandLongVowel` setting replaces it with the vowel of the previous kana.
- Hide ゐ ゑ ゔ ゕ ゖ from the chart.

## Word input

1. Mode A (English): normalise (lower-case, trim, collapse spaces) → look up
   `names`, then `words` → else e2k C2K fallback (see below) → katakana →
   hiragana by code-point shift (−0x60 for U+30A1–U+30F6).
2. Mode B (romaji): `wanakana.toHiragana(input)`; live preview.
3. Both end on an editable tile row (tap tile → chart to replace; add, remove,
   drag to reorder; tap to hear). Limit 14 morae (small ゃゅょぁぃぅぇぉゎ
   join the previous kana; っ and ー count).
4. Words with a `japanese` value also offer "Write the Japanese word" (dog → いぬ).

e2k fallback (milestone 4, optional for MVP): weights are
`model-c2k.npz` from https://github.com/Patchethium/e2k/releases (0.4.0),
fp16, ~4.4 MB. Convert to a flat binary + JSON index at build time, lazy-load
on first dictionary miss, and port the greedy decoder (bi-GRU encoder,
GRU decoder with attention; see `src/e2k/inference.py` upstream) to JS.
Code is Unlicense; weights are trained on CC BY-SA dictionaries, so credit
them in About. Until this lands, a dictionary miss goes straight to Mode B
with a friendly hint.

## Practice flow per character

Phase 1 Watch and trace → Phase 2 Trace → Phase 3 Write (scored). Then the
next character. After the last one, show the phase-3 drawings side by side
("my word"), stars, spoken word, save to history.

- Phase 1: animate stroke k (dot + growing line, 0.6–1.2 s by length), then
  show only stroke k's ghost + start dot + arrow; child traces; repeat.
- Phase 2: whole ghost, numbered start dots, no animation.
- Phase 3: empty cell with dashed cross guidelines, no ghost.
- Engine state per character: `demo(k) → await(k) → judge → accept | retry`.
- Correction ladder on miss: 1) fade ink + replay stroke, 2) pulse start dot +
  arrow, 3) "let's do it together": accept any stroke starting near the dot.
- Order slip (`judgeNext` returns `kind: "order"`): "That's stroke N+1! Let's
  do stroke N first", highlight stroke N.

## Matching (use the reference; tolerances in cell units)

| Phase | mean dist | start | offset forgiven |
| --- | --- | --- | --- |
| 1 | 0.15 | 0.22 | 0 |
| 2 | 0.13 | 0.20 | 0 |
| 3 | 0.12 | 0.18 | ≤0.18 |

Short strokes scale down with a 0.07 floor. Length 0.4–2.0× (ticks up to 3×),
direction cosine > 0.2. Score (phase 3): 70 shape + 15 placement + 15
proportion, −5 per retried stroke; stars 80+ → 3, 55+ → 2, else 1.

Hot/cold (stretch): `warmth(p, strokePoints, phase)` → 0 hot … 1 cold. Ink
colour ramps warm orange-gold → yellow → soft sky blue; also thin the line as
it cools. Precompute a 64×64 distance grid per stroke on character load.

## Input rules

Pointer Events on the writing canvas only; `touch-action: none`; pointer
capture; `getCoalescedEvents()` when present. Ignore pointers that start
outside the cell (+12 px margin); one active pen; second pointer within 150 ms
→ larger / further-from-centre one is palm; contact > ~40 CSS px → palm; drop
strokes < 2% of cell lasting < 80 ms; never cancel a live stroke because a
palm landed; `pointercancel` discards without a miss; once `pointerType ===
"pen"` is seen, ignore touch. Port `palm.js` from Liz's Soft Canvas project if
it covers this.

## Storage

IndexedDB: `profiles`, `items` (kind word|kana, input, mode, kana[],
sessions[{at, score, stars, perKana[], drawing}]), `settings`. Keep 20
sessions per item; drawings downsampled to 16 pts/stroke. Call
`navigator.storage.persist()`. Parent menu: JSON backup/restore. Show iOS
users a one-time "Add to Home Screen" tip (Safari clears site storage after 7
days of browsing without visiting; home-screen apps keep it).

## Milestones (each ends with a deploy to Pages)

1. Skeleton: Vite + PWA + Pages workflow; home, chart, writing screen with
   guide layer from `kana-strokes.json`; mouse + touch ink.
2. Engine: port matcher + tests; three phases for a single kana; correction
   ladder; positive feedback (chime, sparkles); palm rules.
3. Words: Mode B (WanaKana), Mode A dictionary, tile editor, mora limit,
   word flow, "my word" screen, speech.
4. History: IndexedDB, history shelf, parent view with score trend, backup.
   e2k fallback.
5. Polish: hot/cold potato, mascot, reduced-motion, perf pass on devices.

## Acceptance checks

- `node --test tests/` passes (matcher thresholds unchanged unless agreed).
- Playwright: draw あ correctly with mouse in all 3 phases → 3 stars; draw
  stroke 2 first → order message, no failure state; tap outside cell while
  drawing → stroke continues.
- Two simultaneous touches (one large at the cell edge) still produce one
  clean stroke.
- 40+ fps sustained while drawing with 4× CPU throttling (Chrome perf panel).
- First load < 150 KB gzipped JS+CSS (excluding stroke JSON and e2k weights).
- Airplane mode after first visit: app opens and saves history.
- No network requests other than same-origin static files.
- Every screen after word entry is usable without reading.
