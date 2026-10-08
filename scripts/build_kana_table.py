#!/usr/bin/env python3
"""Build data/kana-table.json: the practice chart layout and per-kana metadata.

Usage: python3 -I scripts/build_kana_table.py data/kana-table.json
"""
import json, sys

# Gojuon chart, row by row; None = empty cell in the grid.
GOJUON = [
    ["あ a", "い i", "う u", "え e", "お o"],
    ["か ka", "き ki", "く ku", "け ke", "こ ko"],
    ["さ sa", "し shi", "す su", "せ se", "そ so"],
    ["た ta", "ち chi", "つ tsu", "て te", "と to"],
    ["な na", "に ni", "ぬ nu", "ね ne", "の no"],
    ["は ha", "ひ hi", "ふ fu", "へ he", "ほ ho"],
    ["ま ma", "み mi", "む mu", "め me", "も mo"],
    ["や ya", None, "ゆ yu", None, "よ yo"],
    ["ら ra", "り ri", "る ru", "れ re", "ろ ro"],
    ["わ wa", None, None, None, "を wo"],
    ["ん n", None, None, None, None],
]
DAKUTEN = [
    ["が ga", "ぎ gi", "ぐ gu", "げ ge", "ご go"],
    ["ざ za", "じ ji", "ず zu", "ぜ ze", "ぞ zo"],
    ["だ da", "ぢ ji", "づ zu", "で de", "ど do"],
    ["ば ba", "び bi", "ぶ bu", "べ be", "ぼ bo"],
    ["ぱ pa", "ぴ pi", "ぷ pu", "ぺ pe", "ぽ po"],
]
SMALL = [["ゃ ya", "ゅ yu", "ょ yo", "っ (pause)", None],
         ["ぁ a", "ぃ i", "ぅ u", "ぇ e", "ぉ o"]]

def cells(rows, group):
    out = {}
    for r, row in enumerate(rows):
        for c, cell in enumerate(row):
            if not cell:
                continue
            ch, rom = cell.split(" ", 1)
            out[ch] = {"romaji": rom, "group": group, "row": r, "col": c,
                       "small": group == "small"}
    return out

kana = {}
kana.update(cells(GOJUON, "basic"))
kana.update(cells(DAKUTEN, "voiced"))
kana.update(cells(SMALL, "small"))
kana["ー"] = {"romaji": "(long vowel)", "group": "mark", "row": 0, "col": 0, "small": False}
for ch in kana:
    # Spoken name of the character for speech synthesis (ja-JP).
    if ch == "っ":
        kana[ch]["speak"] = "ちいさい つ"
    elif kana[ch]["small"]:
        kana[ch]["speak"] = "ちいさい " + chr(ord(ch) + 1)
    elif ch == "ー":
        kana[ch]["speak"] = "のばす ぼう"
    elif ch == "を":
        kana[ch]["speak"] = "を"   # TTS may say "o"; record audio if this matters
    else:
        kana[ch]["speak"] = ch

doc = {
    "meta": {
        "romanisation": "Modified Hepburn for display; input accepts Hepburn and Kunrei via wanakana",
        "notes": [
            "Small kana sit in the lower-left quarter of the cell in horizontal writing; KanjiVG already draws them small and low.",
            "ゐ ゑ ゔ ゕ ゖ exist in kana-strokes.json but are left out of the practice chart.",
            "Long-vowel mark ー (U+30FC) is kept by default in loanword/name spellings (e.g. じぇーむず), as kindergarten materials do; a parent setting expands it to a vowel kana instead (じぇえむず). In horizontal writing it is one left-to-right stroke.",
        ],
    },
    "charts": {
        "basic": [[c.split(" ")[0] if c else None for c in row] for row in GOJUON],
        "voiced": [[c.split(" ")[0] if c else None for c in row] for row in DAKUTEN],
        "small": [[c.split(" ")[0] if c else None for c in row] for row in SMALL],
    },
    "kana": kana,
}
open(sys.argv[1], "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, indent=1))
print(len(kana), "kana")
