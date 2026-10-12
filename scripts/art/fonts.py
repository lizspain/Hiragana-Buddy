"""Copy the app's bundled fonts into src/fonts/ (developer-only).

    npm install                                          # brings @fontsource/nunito, @fontsource/klee-one
    .voicegen/venv/Scripts/python.exe -I scripts/art/fonts.py

- Nunito 700/800/900, Latin subset, as shipped by Fontsource.
- Klee One 600 cut down to just the home subtitle (ひらがな の ともだち), ~3 KB.
Both are SIL Open Font License 1.1.
"""

import glob
import shutil
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "fonts"
SUBTITLE = "ひらがなのともだち"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for w in (700, 800, 900):
        name = f"nunito-latin-{w}-normal.woff2"
        shutil.copy(ROOT / "node_modules/@fontsource/nunito/files" / name, OUT / name)

    need = {ord(c) for c in SUBTITLE}
    src = None
    for f in glob.glob(str(ROOT / "node_modules/@fontsource/klee-one/files/klee-one-*-600-normal.woff2")):
        if need <= set(TTFont(f).getBestCmap()):
            src = f
            break
    if not src:
        raise SystemExit("No single Klee One subset file has every subtitle character")
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = []
    opts.name_IDs = ["*"]
    font = TTFont(src)
    s = subset.Subsetter(opts)
    s.populate(text=SUBTITLE)
    s.subset(font)
    font.flavor = "woff2"
    font.save(OUT / "klee-one-600-subtitle.woff2")
    print("fonts written to", OUT)


if __name__ == "__main__":
    main()
