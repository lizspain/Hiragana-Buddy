#!/usr/bin/env python3
"""Render a contact sheet of every kana: strokes coloured by order, start dot,
stroke number. Used to eyeball data/kana-strokes.json.

Usage: python3 -I scripts/render_preview.py data/kana-strokes.json reference/kana-preview.png
"""
import json, sys
from PIL import Image, ImageDraw

COLORS = [(231, 111, 81), (42, 157, 143), (69, 123, 157), (233, 196, 106), (155, 93, 229)]
CELL, PAD, COLS = 150, 12, 10

data = json.load(open(sys.argv[1], encoding="utf-8"))["kana"]
chars = list(data)
rows = (len(chars) + COLS - 1) // COLS
img = Image.new("RGB", (COLS * CELL, rows * CELL), "white")
dr = ImageDraw.Draw(img)
for i, ch in enumerate(chars):
    ox, oy = (i % COLS) * CELL, (i // COLS) * CELL
    s = CELL - 2 * PAD
    dr.rectangle([ox + PAD, oy + PAD, ox + PAD + s, oy + PAD + s], outline=(220, 220, 220))
    dr.line([ox + PAD + s / 2, oy + PAD, ox + PAD + s / 2, oy + PAD + s], fill=(235, 235, 235))
    dr.line([ox + PAD, oy + PAD + s / 2, ox + PAD + s, oy + PAD + s / 2], fill=(235, 235, 235))
    for k, st in enumerate(data[ch]["strokes"]):
        c = COLORS[k % len(COLORS)]
        pts = [(ox + PAD + x * s, oy + PAD + y * s) for x, y in st["points"]]
        dr.line(pts, fill=c, width=5, joint="curve")
        x0, y0 = pts[0]
        dr.ellipse([x0 - 5, y0 - 5, x0 + 5, y0 + 5], fill=c)
        dr.text((x0 + 6, y0 - 14), str(k + 1), fill=c)
    dr.text((ox + 4, oy + 2), data[ch]["codepoint"], fill=(120, 120, 120))
img.save(sys.argv[2])
print("saved", sys.argv[2])
