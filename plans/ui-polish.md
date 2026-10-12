# UI polish: execution plan

Bring the whole Hiragana Buddy app into the style of the Figma Make mockup
(`hiragana-buddy-source.zip`, home page only), add the octopus mascot, its
dance, and the stone frame around the writing square.

Planned 2026-10-11 through a GrillMe-style interview. Build in one pass, review
at the end.

## Decisions

| Topic | Decision |
| --- | --- |
| Scope | Every screen: home, letter chart, word entry, writing, "my word", grown-ups, modals |
| Kana on tiles and cards | Keep the KanjiVG stroke drawings, restyled (thicker, new ink colour). No Japanese font for kana |
| Practised-word cards | Two targets: card face starts practice, tan speaker pill only plays the sound |
| Mascot | Octopus replaces the onigiri everywhere in the app. The app/home-screen icon stays あ |
| Dance sprite | Plays on the "my word" summary only |
| Background removal | White removed; soft shadows kept as see-through tints |
| Stone frame | Rings the outside of the paper in all three writing steps; the drawing square shrinks a little to fit |
| Fonts | Bundle Nunito (Latin subset, 2 weights) and a tiny Klee One subset for the ひらがな の ともだち subtitle. No Google Fonts calls |
| Backdrop | Faint wood-grain lines and pebble clusters on every screen, including writing (kept very faint) |
| Review | One pass, screenshots of every screen at the end |
| Git | Commit + push current work on `voice-input`, then create `ui-polish` (approved) and do all of this there |

## Steps

### 0. Git
1. On `voice-input`, commit the uncommitted app and voice-input work (logical
   commits), push.
2. Create `ui-polish` from it (approved by the user), push it.

### 1. Art: cut-outs and web-ready files
Source files are kept in `art-source/` (committed): `octopus-mascot.webp`,
`octopus-dance-sheet.webp` (4×4 grid, 16 frames), `stone-frame.png`.

1. Add `scripts/art/cutout.py` (runs in the dev-only `.voicegen` Python; add
   Pillow there):
   - Flood-fill from the image edges (and the frame's centre) through light
     pixels; the dark outlines stop the fill, so white eye highlights and the
     cream bandana inside the outline stay opaque.
   - On the filled region, "colour to alpha" against white: pure white becomes
     transparent; the lavender ground shadow and stone shadows become
     see-through tints of their own colour.
   - Feather 1 px at the boundary to avoid a white fringe.
2. Dance sheet: split into 16 frames, trim each to its content, then re-align
   all frames on a shared bottom-centre point (so the octopus doesn't jitter)
   and rebuild a sheet with equal frame cells.
3. Outputs in `public/art/` (WebP with alpha, Safari 14+):
   - `octopus.webp`: 512 px, about 30 KB
   - `octopus-dance.webp`: 16 frames at ~240 px, about 120 KB, plus a small
     JSON with frame size and count
   - `stone-frame.webp`: 1024 px, about 80 KB, plus the measured ring
     thickness (fraction of width) for layout
4. Check each cut-out on cream, dark and checkerboard backgrounds (screenshots).
5. Precache all three with the service worker (they're small and needed offline).

### 2. Shared style
1. Replace the `:root` tokens in `src/styles.css` with the mockup palette:
   canvas `#fff8e8`, surface `#fffdf0`, ink `#2d2928`, brand green `#146449`,
   tan `#c9a175`/`#d3ad88`, brown edges `#654731`/`#7e5a3b`, peach
   `#ffad78`/`#c66b28`, cyan `#28a8c2`/`#126a83`, gold `#f3a713`, muted star
   `#b8b4b1`, focus `#7d66df`.
2. Fonts: add `@fontsource/nunito` (700, 900; Latin) as a dev dependency and copy
   the woff2 files into the build; subset Klee One 600 to the subtitle's
   characters with `pyftsubset` (fonttools in `.voicegen`). `@font-face` with
   `font-display: swap`; add the OFL licence notes to `data/ATTRIBUTION.md` and
   the About section.
3. One "raised toy" look shared by every control: 3 px dark outline, large
   radius, solid lower edge in a darker shade, soft cast shadow, subtle top
   highlight.
4. Press feedback: a small `pressFeedback()` helper (one listener on the
   document) adds `.is-pressed` for 240 ms on pointer or keyboard activation:
   4 px down, 10% darker, shorter edge. Reduced motion keeps the state, drops
   the easing. Never fires on the writing stage.
5. Backdrop: one fixed, `aria-hidden` SVG layer (wood grain + 3–4 pebble
   clusters with sprouts) behind every screen; fewer clusters on phones; on
   the writing screen at lower opacity. Static, so it costs nothing while drawing.
6. Icons: new gear from the mockup; existing icons get the heavier outline
   style.

### 3. Screens
- **Home**: the mockup layout. Green two-line title, Klee One subtitle,
  octopus beside it, tan gear (press-and-hold still guards the grown-ups
  screen). Peach "Write a word" and cyan "One letter" cards, with あ in a
  raised cream inset drawn from strokes. Practice cards: kana strokes, label,
  outlined gold/grey stars, and the tan speaker pill as its own button. 2
  columns on phones, 4 on tablets.
- **Letter chart**: tab buttons and kana cells as raised cream tiles; the
  selected tab in brand green.
- **Word entry**: outlined input, tan mic button (listening state in peach),
  raised kana tiles, chip choices, deep-green Start.
- **Writing**:
  - Top-bar buttons become tan raised circles like the gear; step pips and
    word strip restyled; palette swatches get dark outlines.
  - Stone frame: an `<img>` behind the canvases, sized to the paper plus the
    measured ring thickness. `Board.resize()` reserves that ring, so the cell is
    about 8% smaller.
  - Pointer handling is unchanged: the stones aren't drawing area, and the
    12 px forgiving margin still applies.
  - Paper and guide colours move to the new palette (`GUIDE_COLORS`).
- **My word**:
  - The octopus dances above the stars while the rainbow burst plays: 10 fps,
    the 16 frames twice (~3 s), then rests on the calm first frame.
  - Drawn with a small canvas stepper, so it's paused off-screen and static
    with reduced motion.
  - Drawn letters sit on raised cream cards.
  - Home and Again corners as tan circles.
- **Grown-ups**: cards, toggles and buttons in the new style; About gains
  the font and art credits.
- **Modals and loading screen**: the iOS tip, the chart picker and the boot
  screen (octopus instead of あ) restyled.

### 4. Verify
1. `npm test` (matcher + unit) and `npm run test:e2e` all pass; update any
   test that depended on old layout.
2. Writing still meets the non-negotiables: ink on the next frame, 40+ fps
   with 4× CPU throttling (backdrop and stone frame are static layers), palm
   and order tests unchanged.
3. First-load JS + CSS still under 150 KB gzipped (fonts and art counted
   separately); no network requests except the app's own files (existing
   test).
4. Offline after first visit: fonts and art come from the cache.
5. Regenerate `design-export/` (`npm run design-export`) so Figma has the new
   look; check SVG text uses Nunito.
6. Screenshots of every screen: phone, tablet, tablet landscape.

### 5. Hand-off
Commit and push `ui-polish`, send the screenshots, and list anything that
needs your eye (cut-out edges, dance timing, frame thickness).

## Out of scope
- A new app/home-screen icon.
- Dance anywhere other than the summary.
- Changes to stroke matching, scoring, voice clips or voice input behaviour.
