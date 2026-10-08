#!/usr/bin/env python3
"""Build data/kana-strokes.json from KanjiVG hiragana SVGs.

Usage:
  python3 -I scripts/build_kana_strokes.py <path-to-kanjivg/kanji> data/kana-strokes.json

KanjiVG (c) Ulrich Apel, CC BY-SA 3.0. The generated JSON is a derivative work
and must keep that licence and attribution (see data/ATTRIBUTION.md).

Output coordinates are normalised to a 0..1 square (KanjiVG uses 109x109).
Each stroke keeps the original SVG path (for drawing/animation) and a
resampled centre-line polyline of N evenly spaced points (for matching).
"""
import json, math, re, sys
from pathlib import Path

N_POINTS = 32          # resampled points per stroke
SIZE = 109.0           # KanjiVG viewBox

# Hiragana U+3041..U+3096 plus the dakuten/handakuten marks are not separate
# glyphs here; voiced kana (が etc.) already include their marks as strokes.
CODEPOINTS = list(range(0x3041, 0x3097)) + [0x30FC]  # + long-vowel mark ー

TOKEN = re.compile(r"[MmCcSsLlHhVvZz]|-?\d*\.?\d+(?:e-?\d+)?")


def cubic(p0, p1, p2, p3, steps=24):
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        mt = 1 - t
        x = mt**3*p0[0] + 3*mt*mt*t*p1[0] + 3*mt*t*t*p2[0] + t**3*p3[0]
        y = mt**3*p0[1] + 3*mt*mt*t*p1[1] + 3*mt*t*t*p2[1] + t**3*p3[1]
        out.append((x, y))
    return out


def flatten(d):
    toks = TOKEN.findall(d)
    i, cmd = 0, None
    cur = (0.0, 0.0)
    start = cur
    last_ctrl = None
    pts = []

    def num():
        nonlocal i
        v = float(toks[i]); i += 1
        return v

    while i < len(toks):
        if re.match(r"[A-Za-z]", toks[i]):
            cmd = toks[i]; i += 1
            if cmd in "Zz":
                pts.append(start); cur = start; continue
        rel = cmd.islower()
        c = cmd.upper()
        ox, oy = cur if rel else (0.0, 0.0)
        if c == "M":
            cur = (ox + num(), oy + num()); start = cur; pts.append(cur)
            cmd = "l" if rel else "L"; last_ctrl = None
        elif c == "L":
            cur = (ox + num(), oy + num()); pts.append(cur); last_ctrl = None
        elif c == "H":
            cur = ((ox if rel else 0) + num(), cur[1]); pts.append(cur); last_ctrl = None
        elif c == "V":
            cur = (cur[0], (oy if rel else 0) + num()); pts.append(cur); last_ctrl = None
        elif c == "C":
            p1 = (ox + num(), oy + num()); p2 = (ox + num(), oy + num()); p3 = (ox + num(), oy + num())
            pts += cubic(cur, p1, p2, p3); last_ctrl = p2; cur = p3
        elif c == "S":
            p1 = (2*cur[0] - last_ctrl[0], 2*cur[1] - last_ctrl[1]) if last_ctrl else cur
            p2 = (ox + num(), oy + num()); p3 = (ox + num(), oy + num())
            pts += cubic(cur, p1, p2, p3); last_ctrl = p2; cur = p3
        else:
            raise ValueError(f"unsupported command {cmd} in {d}")
    return pts


def resample(pts, n):
    seg = [math.dist(pts[k], pts[k + 1]) for k in range(len(pts) - 1)]
    total = sum(seg)
    if total == 0:
        return [pts[0]] * n, 0.0
    step = total / (n - 1)
    out = [pts[0]]
    acc, k, pos = 0.0, 0, pts[0]
    target = step
    while len(out) < n - 1 and k < len(seg):
        if acc + seg[k] >= target:
            t = (target - acc) / seg[k] if seg[k] else 0
            a, b = pts[k], pts[k + 1]
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            target += step
        else:
            acc += seg[k]; k += 1
    while len(out) < n - 1:
        out.append(pts[-1])
    out.append(pts[-1])
    return out, total


def main(src_dir, out_path):
    src = Path(src_dir)
    result = {}
    for cp in CODEPOINTS:
        f = src / f"{cp:05x}.svg"
        if not f.exists():
            print(f"missing {f.name}", file=sys.stderr); continue
        text = f.read_text(encoding="utf-8")
        paths = re.findall(r'<path id="kvg:[0-9a-f]+-s(\d+)"[^>]*\sd="([^"]+)"', text)
        paths.sort(key=lambda p: int(p[0]))
        nums = re.findall(r'<text transform="matrix\(1 0 0 1 ([\d.]+) ([\d.]+)\)">(\d+)</text>', text)
        num_pos = {int(n): (round(float(x) / SIZE, 4), round(float(y) / SIZE, 4)) for x, y, n in nums}
        strokes = []
        for idx, d in paths:
            raw = flatten(d)
            pts, length = resample(raw, N_POINTS)
            strokes.append({
                "d": d,
                "points": [[round(x / SIZE, 4), round(y / SIZE, 4)] for x, y in pts],
                "length": round(length / SIZE, 4),
                "numberPos": list(num_pos.get(int(idx), (None, None))),
            })
        ch = chr(cp)
        result[ch] = {"codepoint": f"U+{cp:04X}", "strokeCount": len(strokes), "strokes": strokes}
    meta = {
        "source": "KanjiVG https://kanjivg.tagaini.net/ (github.com/KanjiVG/kanjivg)",
        "license": "CC BY-SA 3.0 - Copyright (C) Ulrich Apel. Derivative data; keep attribution and share-alike.",
        "viewBox": "0 0 1 1 (original 109x109 divided by 109)",
        "pointsPerStroke": N_POINTS,
        "generatedBy": "scripts/build_kana_strokes.py",
    }
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(json.dumps({"meta": meta, "kana": result}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(result)} kana to {out_path}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
