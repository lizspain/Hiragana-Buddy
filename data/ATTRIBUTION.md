# Data sources and licences

## kana-strokes.json — CC BY-SA 3.0
Derived from KanjiVG (https://kanjivg.tagaini.net/), copyright (C) Ulrich Apel,
released under Creative Commons Attribution-Share Alike 3.0
(https://creativecommons.org/licenses/by-sa/3.0/). Stroke paths were copied,
normalised to a 0–1 cell and resampled to 32 points per stroke by
scripts/build_kana_strokes.py. This file stays under CC BY-SA 3.0.

Credit line for the app's About screen:
"Stroke order data: KanjiVG, © Ulrich Apel, CC BY-SA 3.0."

## kana-table.json, en-names-words.json
Written for this project. Name spellings follow common Japanese katakana
renderings; review with a Japanese speaker before launch.

## Optional: e2k model (not included)
https://github.com/Patchethium/e2k — code under the Unlicense; the C2K model is
trained on Wiktionary and JMdict/EDICT (both CC BY-SA). If the weights ship
with the app, credit: "English-to-kana model: e2k by Patchethium, trained on
Wiktionary and JMdict/EDICT data (CC BY-SA)."

## Libraries the app will use
WanaKana (MIT) — https://github.com/WaniKani/WanaKana
