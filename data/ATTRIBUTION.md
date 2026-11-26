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

## public/audio — Japanese voice clips
Rendered with Kokoro-82M (https://huggingface.co/hexgrad/Kokoro-82M), voice
jf_alpha, Apache-2.0, via kokoro-onnx (MIT) and misaki (Apache-2.0). See
scripts/voice/README.md. Credit line: "Japanese voice: Kokoro-82M (jf_alpha), Apache-2.0."

## src/fonts — Nunito and Klee One
Nunito (Vernon Adams, Cyreal, Jacques Le Bailly) and Klee One (Fontworks), both
SIL Open Font License 1.1, via Fontsource. Klee One is cut down to the home
subtitle's characters by scripts/art/fonts.py.

## public/art, art-source — octopus mascot, dance, stone frame
Provided by the app's author. White backgrounds removed by
scripts/art/cutout.py.

## public/audio/kana — kana sounds (interim)
Synthesized locally with VOICEVOX (https://voicevox.hiroshiba.jp/), voice
四国めたん (ノーマル), by scripts/gen-kana-audio.ts. Use follows the 四国めたん
voice terms: https://zunko.jp/con_ongen_kiyaku.html. Nothing was downloaded;
every clip was rendered by the engine on the developer's machine.

Credit line for the app's About screen (required while these clips ship; do
not remove): "VOICEVOX:四国めたん".

These clips are interim. A native-speaker recording will replace them under the
same file names; this credit can only go once none of these clips ship.
