"""Cut the white backgrounds out of the source art and write web-ready files.

Developer-only (runs in the .voicegen Python; needs Pillow + numpy):
    .voicegen/venv/Scripts/python.exe -I scripts/art/cutout.py

Reads art-source/, writes public/art/:
    octopus.webp          the mascot, trimmed, 512 px tall at most
    octopus-dance.webp    16 dance frames re-aligned on a shared ground point,
                          4x4 sheet of equal cells
    stone-frame.webp      the pebble ring, square
and src/art.json (dance frame size, stone ring's inner edge) for the app.

How the background goes: flood-fill inward from the image edges through pixels
that are white or a pale shadow tone; the dark cartoon outlines stop the fill,
so eye highlights, the cream bandana and pale stones inside an outline stay
solid. Inside the filled region, white is turned into transparency
("colour to alpha"), so the soft lavender/grey shadows remain as see-through
tints of their own colour.
"""

import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "art-source"
OUT = ROOT / "public" / "art"

# A pixel can be background if colour-to-alpha would make it at most this opaque
# (white = 0, the lavender ground shadow ~0.2, outlines ~0.85).
PASSABLE = 0.40
NOISE = 0.035  # alpha below this is compression noise on white
# Enclosed white areas larger than this share of the image are holes, not highlights.
POCKET_FRACTION = 0.0017  # mascot: highlights <=1270 px, pocket 1973 px (of 1M); dance cells: highlights <=89, pockets >=161 (of 65k)


def c2a_alpha(rgb: np.ndarray) -> np.ndarray:
    """Opacity a pixel needs over white to look like itself (GIMP 'colour to alpha')."""
    return (255.0 - rgb).max(axis=2) / 255.0


def flood(passable: np.ndarray, seeds: list[tuple[int, int]]) -> np.ndarray:
    h, w = passable.shape
    seen = np.zeros_like(passable, dtype=bool)
    q = deque()
    for y, x in seeds:
        if passable[y, x] and not seen[y, x]:
            seen[y, x] = True
            q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and passable[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return seen


def cut(img: Image.Image, extra_seeds: list[tuple[int, int]] = ()) -> Image.Image:
    rgb = np.asarray(img.convert("RGB")).astype(np.float64)
    h, w, _ = rgb.shape
    a = c2a_alpha(rgb)
    border = [(0, x) for x in range(w)] + [(h - 1, x) for x in range(w)] + [(y, 0) for y in range(h)] + [(y, w - 1) for y in range(h)]
    bg = flood(a <= PASSABLE, border + list(extra_seeds))

    # Enclosed pockets (white showing between a tentacle and the pencil, inside a
    # curled tentacle): pure-white areas the edge fill can't reach. Anything bigger
    # than an eye highlight is background too.
    white = (a <= 0.06) & ~bg
    min_area = POCKET_FRACTION * h * w
    seen = np.zeros_like(white)
    for y, x in zip(*np.nonzero(white)):
        if seen[y, x]:
            continue
        comp = flood(white & ~seen, [(int(y), int(x))])
        seen |= comp
        if comp.sum() >= min_area:
            bg |= flood(a <= PASSABLE, list(zip(*[v.tolist() for v in np.nonzero(comp)]))[:1])

    # Pixels next to the background (anti-aliased outline edges) also get colour-to-alpha,
    # so outlines fade smoothly instead of carrying a white fringe.
    edge = np.zeros_like(bg)
    edge[1:, :] |= bg[:-1, :]
    edge[:-1, :] |= bg[1:, :]
    edge[:, 1:] |= bg[:, :-1]
    edge[:, :-1] |= bg[:, 1:]
    soft = bg | (edge & (a < 0.75))

    alpha = np.where(soft, a, 1.0)
    alpha[soft & (alpha < NOISE)] = 0.0
    # Un-mix white: colour = (c - (1 - a) * 255) / a
    safe = np.maximum(alpha, 1e-6)[..., None]
    color = np.where(soft[..., None], (rgb - (1 - alpha[..., None]) * 255.0) / safe, rgb)
    out = np.dstack([np.clip(color, 0, 255), alpha * 255.0]).round().astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def bbox(im: Image.Image, min_alpha: int = 20) -> tuple[int, int, int, int]:
    a = np.asarray(im)[..., 3]
    ys, xs = np.nonzero(a > min_alpha)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def save_webp(im: Image.Image, path: Path) -> int:
    im.save(path, "WEBP", quality=88, alpha_quality=90, method=6)
    return path.stat().st_size


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    meta: dict = {}

    # Mascot: cut, trim with a little air, cap at 512 px tall.
    m = cut(Image.open(SRC / "octopus-mascot.webp"))
    x0, y0, x1, y1 = bbox(m)
    pad = 8
    m = m.crop((max(0, x0 - pad), max(0, y0 - pad), min(m.width, x1 + pad), min(m.height, y1 + pad)))
    if m.height > 512:
        m = m.resize((round(m.width * 512 / m.height), 512), Image.LANCZOS)
    n = save_webp(m, OUT / "octopus.webp")
    meta["octopus"] = {"width": m.width, "height": m.height}
    print(f"octopus.webp {m.width}x{m.height} {n // 1024} KB")

    # Dance: 4x4 grid of 256 px cells. Cut each frame, then line them all up on
    # the bottom-centre of their ground shadow so the octopus doesn't jitter.
    sheet = Image.open(SRC / "octopus-dance-sheet.webp")
    cell = sheet.width // 4
    frames, boxes = [], []
    for r in range(4):
        for c in range(4):
            f = cut(sheet.crop((c * cell, r * cell, (c + 1) * cell, (r + 1) * cell)))
            frames.append(f)
            boxes.append(bbox(f))
    left = max((b[0] + b[2]) / 2 - b[0] for b in boxes)  # widest half to the left of centre
    right = max(b[2] - (b[0] + b[2]) / 2 for b in boxes)
    up = max(b[3] - b[1] for b in boxes)
    fw = int(np.ceil(left + right)) + 8
    fh = int(np.ceil(up)) + 8
    out = Image.new("RGBA", (fw * 4, fh * 4), (0, 0, 0, 0))
    for i, (f, b) in enumerate(zip(frames, boxes)):
        cx = (b[0] + b[2]) / 2
        dx = round(fw / 2 - cx)
        dy = (fh - 4) - b[3]
        tile = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        tile.alpha_composite(f, (dx, dy))
        out.alpha_composite(tile, ((i % 4) * fw, (i // 4) * fh))
    n = save_webp(out, OUT / "octopus-dance.webp")
    meta["dance"] = {"frameWidth": fw, "frameHeight": fh, "columns": 4, "frames": 16}
    print(f"octopus-dance.webp {out.width}x{out.height} (frame {fw}x{fh}) {n // 1024} KB")

    # Stone frame: square ring; also seed the fill from the middle (the inside paper area).
    s = Image.open(SRC / "stone-frame.png")
    f = cut(s, [(s.height // 2, s.width // 2)])
    n = save_webp(f, OUT / "stone-frame.webp")
    # Inner edge of the ring along the middle row/column: first/last stone pixel inside.
    a = np.asarray(f)[..., 3] > 128
    mid_r, mid_c = a[s.height // 2], a[:, s.width // 2]

    def inner(v: np.ndarray) -> tuple[int, int]:
        idx = np.nonzero(v)[0]
        half = len(v) // 2
        lo = idx[idx < half].max() + 1
        hi = idx[idx > half].min()
        return int(lo), int(hi)

    l, r = inner(mid_r)
    t, b = inner(mid_c)
    # Visible stones (alpha > 50%) as fractions of the image, so controls can sit right against them.
    cx0, cy0, cx1, cy1 = bbox(f, 128)
    meta["stoneFrame"] = {
        "size": f.width,
        "visible": [round(cx0 / f.width, 4), round(cy0 / f.height, 4), round(cx1 / f.width, 4), round(cy1 / f.height, 4)],
        # Inner opening as fractions of the image (left, top, right, bottom insets).
        "inset": [round(l / f.width, 4), round(t / f.height, 4), round((f.width - r) / f.width, 4), round((f.height - b) / f.height, 4)],
    }
    print(f"stone-frame.webp {f.width}x{f.height} {n // 1024} KB, inner opening insets {meta['stoneFrame']['inset']}")

    # Read by the app (src/ui/dance.ts, src/ui/board.ts).
    (ROOT / "src" / "art.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    # Previews on cream, dark and checkerboard for checking edges by eye.
    prev = ROOT / "test-results" / "art-preview"
    prev.mkdir(parents=True, exist_ok=True)
    for name in ("octopus.webp", "octopus-dance.webp", "stone-frame.webp"):
        im = Image.open(OUT / name).convert("RGBA")
        w, h = im.size
        board = Image.new("RGBA", (w * 3, h), (255, 248, 232, 255))
        board.paste((40, 34, 32, 255), (w, 0, w * 2, h))
        chk = Image.new("RGBA", (w, h))
        px = chk.load()
        for yy in range(h):
            for xx in range(w):
                px[xx, yy] = (200, 200, 200, 255) if (xx // 16 + yy // 16) % 2 else (255, 255, 255, 255)
        board.paste(chk, (w * 2, 0))
        for k in range(3):
            board.alpha_composite(im, (k * w, 0))
        board.convert("RGB").save(prev / name.replace(".webp", ".png"))


if __name__ == "__main__":
    main()
