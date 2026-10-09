"""Render a few sample kana in each Kokoro Japanese voice, for choosing by ear.

One-time tool, runs only on the developer's machine (see scripts/voice/README.md):
    .voicegen/venv/Scripts/python.exe -I scripts/voice/render_samples.py

Writes voice-samples/<voice>/<n>.wav and voice-samples/index.html.
"""

import html
import re
import sys
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro
from misaki import ja

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / ".voicegen" / "models"
OUT = ROOT / "voice-samples"

VOICES = ["jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro"]
SAMPLES = ["あ", "か", "し", "つ", "ふ", "ん", "きゃ", "ちいさい や", "えま", "ねこ", "しゃーろっと", "じょうず！"]
SPEED = 0.9


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    kokoro = Kokoro(str(MODELS / "kokoro-v1.0.int8.onnx"), str(MODELS / "voices-v1.0.bin"))
    # Kokoro was trained on misaki's default "cutlet" front end (needs unidic-lite).
    g2p = ja.JAG2P()
    rows = []
    for i, text in enumerate(SAMPLES):
        phonemes, _ = g2p(text)
        phonemes = re.sub(r" *ː *", "ː", phonemes)  # ー arrives as " ː "
        print(f"{text}\t{phonemes}")
        cells = []
        for v in VOICES:
            audio, sr = kokoro.create(phonemes, voice=v, speed=SPEED, lang="ja", is_phonemes=True)
            path = OUT / v / f"{i:02d}.wav"
            path.parent.mkdir(parents=True, exist_ok=True)
            sf.write(path, audio, sr)
            cells.append(f'<td><audio controls preload="none" src="{v}/{i:02d}.wav"></audio></td>')
        rows.append(f'<tr><th lang="ja">{html.escape(text)}</th>{"".join(cells)}</tr>')

    head = "".join(f"<th>{v.removeprefix('jf_')}</th>" for v in VOICES)
    (OUT / "index.html").write_text(
        f"""<!doctype html><meta charset="utf-8"><title>Kokoro voice samples</title>
<style>body{{font-family:system-ui;background:#fff8ef;color:#4a3b35;padding:16px}}
table{{border-collapse:collapse}}th,td{{padding:6px 10px;border-bottom:1px solid #efd9bd;text-align:left}}
th[lang]{{font-size:1.4rem}}audio{{height:36px;width:180px}}</style>
<h1>Kokoro Japanese voices</h1><p>Speed {SPEED}. Play down a column to hear one voice.</p>
<table><tr><th></th>{head}</tr>{"".join(rows)}</table>
""",
        encoding="utf-8",
    )
    print("wrote", OUT / "index.html")


if __name__ == "__main__":
    sys.exit(main())
