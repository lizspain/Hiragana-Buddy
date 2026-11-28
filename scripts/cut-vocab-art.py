"""Cut Make a Word's picture sheets into one picture per word.

    .voicegen/venv/Scripts/python.exe scripts/cut-vocab-art.py

Reads art-source/vocab/vocab-<stage>-sheet.jpg (4 x 2 grids in worksheet
order, white background) and vocab-hashi.jpg (the chopsticks), and writes
public/vocab/<picture>.webp for every picture in data/vocab-words.json:
the white around each drawing made transparent, trimmed, centred on a square
and scaled to SIZE. White inside a drawing (an eye's shine, the dango) stays
white; large pure-white holes enclosed by outlines (inside the scissor rings,
between the bridge rails) become transparent too.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art-source" / "vocab"
OUT = ROOT / "public" / "vocab"
SIZE = 512
MARGIN = 0.04  # of the square, each side
BG_MIN = 232  # every channel at least this: background-ish
HOLE_MIN = 248  # an enclosed hole must be this white to go …
HOLE_AREA = 0.004  # … and at least this much of the cell


def transparent_background(img: Image.Image) -> Image.Image:
    rgb = np.asarray(img.convert("RGB")).astype(np.int16)
    h, w, _ = rgb.shape
    lo = rgb.min(axis=2)
    spread = rgb.max(axis=2) - lo
    bg = (lo >= BG_MIN) & (spread <= 18)

    # Background connected to the edges: flood-fill a padded mask from a corner.
    mask = Image.fromarray(np.pad(bg, 1, constant_values=True).astype(np.uint8) * 255, "L")
    ImageDraw.floodfill(mask, (0, 0), 128)
    outside = (np.asarray(mask)[1:-1, 1:-1] == 128)

    # Big, pure-white holes enclosed by outlines.
    holes = bg & ~outside & (lo >= HOLE_MIN)
    if holes.any():
        # Seeds only where a hole is solidly white (JPEG specks and thin gaps drop out),
        # then each seed's whole region is filled on the full mask.
        hm = Image.fromarray(holes.astype(np.uint8) * 255, "L")
        cores = np.asarray(hm.filter(ImageFilter.MinFilter(9))) > 0
        work = hm.copy()
        while cores.any():
            y, x = np.unravel_index(np.argmax(cores), cores.shape)
            ImageDraw.floodfill(work, (int(x), int(y)), 77)
            region = np.asarray(work) == 77
            if region.sum() >= HOLE_AREA * h * w:
                outside |= region
            work.paste(0, mask=Image.fromarray(region.astype(np.uint8) * 255, "L"))
            cores &= ~region

    # Soft edge: near the cut, lighter pixels fade (the JPEG's anti-aliased rim).
    ring = np.asarray(Image.fromarray(outside.astype(np.uint8) * 255, "L").filter(ImageFilter.MaxFilter(5))) > 0
    whiteness = np.clip((lo - 150) / (BG_MIN - 150), 0, 1)
    alpha = np.where(outside, 0, np.where(ring, 1 - whiteness, 1))
    rgba = np.dstack([rgb.astype(np.uint8), (alpha * 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA")


def square(img: Image.Image) -> Image.Image:
    a = np.asarray(img)[:, :, 3]
    ys, xs = np.nonzero(a > 24)
    box = img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    side = int(max(box.size) / (1 - 2 * MARGIN))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(box, ((side - box.width) // 2, (side - box.height) // 2), box)
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def cells(sheet: Image.Image):
    w, h = sheet.size
    cw, ch = w // 4, h // 2
    for row in range(2):
        for col in range(4):
            yield sheet.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch))


def main():
    words = json.loads((ROOT / "data" / "vocab-words.json").read_text(encoding="utf8"))["words"]
    OUT.mkdir(parents=True, exist_ok=True)
    made = []
    for stage in ["1A", "1B", "2A", "2B"]:
        ws = sorted((w for w in words if w["stage"] == stage), key=lambda w: w["order"])
        sheet = Image.open(SRC / f"vocab-{stage}-sheet.jpg")
        for w, cell in zip(ws, cells(sheet)):
            # はし's bridge is on the 2B sheet; its chopsticks have their own file.
            name = Path(w["senses"][0]["picture"]).stem
            square(transparent_background(cell)).save(OUT / f"{name}.webp", quality=82, method=6)
            made.append(name)
    chop = Image.open(SRC / "vocab-hashi.jpg")
    square(transparent_background(chop)).save(OUT / "hashi-chopsticks.webp", quality=82, method=6)
    made.append("hashi-chopsticks")
    total = sum((OUT / f"{n}.webp").stat().st_size for n in made)
    print(f"{len(made)} pictures, {total / 1024:.0f} KB in all, in {OUT}")


if __name__ == "__main__":
    main()
