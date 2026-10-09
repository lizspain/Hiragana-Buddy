"""Render the app's Japanese voice clips with Kokoro (jf_alpha).

One-time tool for the developer's machine; families only ever get the MP3s.
    node scripts/voice/lines.mjs
    .voicegen/venv/Scripts/python.exe -I scripts/voice/render_clips.py

Reads .voicegen/ja-lines.json, writes public/audio/ja/*.mp3 and
public/audio/manifest.json (exact text -> file, read by src/ui/audio.ts).
"""

import hashlib
import json
import re
import sys
from pathlib import Path

import lameenc
import numpy as np
from kokoro_onnx import Kokoro
from kokoro_onnx.config import DEFAULT_VOCAB
from misaki import ja

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / ".voicegen" / "models"
OUT = ROOT / "public" / "audio"

VOICE = "jf_alpha"
SPEED = 0.9
KBPS = 48
PAD_S = 0.03  # silence at each end; the app overlaps clips by about this much
PEAK = 0.9
CREDIT = "Japanese voice: Kokoro-82M (jf_alpha), Apache-2.0."

# Alone, these are read as particles (wa, e); as letters they are ha, he.
OVERRIDES = {"は": "ha", "へ": "he"}


def phonemize(g2p: ja.JAG2P, text: str) -> str:
    if text in OVERRIDES:
        return OVERRIDES[text]
    p, _ = g2p(text)
    return re.sub(r" *ː *", "ː", p).strip()  # ー arrives as " ː "


def to_mp3(audio: np.ndarray, sr: int) -> bytes:
    pad = np.zeros(int(sr * PAD_S), dtype=np.float32)
    fade = min(len(audio) // 4, int(sr * 0.008))
    if fade:
        ramp = np.linspace(0, 1, fade, dtype=np.float32)
        audio = audio.copy()
        audio[:fade] *= ramp
        audio[-fade:] *= ramp[::-1]
    peak = float(np.abs(audio).max()) or 1.0
    audio = np.concatenate([pad, audio * (PEAK / peak), pad])
    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
    enc = lameenc.Encoder()
    enc.set_bit_rate(KBPS)
    enc.set_in_sample_rate(sr)
    enc.set_channels(1)
    enc.set_quality(2)
    return enc.encode(pcm.tobytes()) + enc.flush()


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    lines = json.loads((ROOT / ".voicegen" / "ja-lines.json").read_text(encoding="utf-8"))
    # Optional: re-render only the given texts, keeping every other clip.
    only = set(sys.argv[1:])
    kokoro = Kokoro(str(MODELS / "kokoro-v1.0.int8.onnx"), str(MODELS / "voices-v1.0.bin"))
    g2p = ja.JAG2P()  # misaki's default "cutlet" front end, which Kokoro was trained on

    (OUT / "ja").mkdir(parents=True, exist_ok=True)
    manifest: dict[str, str] = {}
    if only:
        manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))["ja"]
        lines = [l for l in lines if l["text"] in only]
    problems = []
    total = 0
    for i, line in enumerate(lines):
        text = line["text"]
        ph = phonemize(g2p, text)
        unknown = sorted({c for c in ph if c not in DEFAULT_VOCAB})
        if not ph or unknown:
            problems.append(f"{text}: phonemes {ph!r} unknown {unknown}")
            continue
        audio, sr = kokoro.create(ph, voice=VOICE, speed=SPEED, lang="ja", is_phonemes=True)
        if len(audio) < sr * 0.1 or float(np.abs(audio).max()) < 0.05:
            problems.append(f"{text}: audio too short or quiet ({len(audio) / sr:.2f}s)")
            continue
        name = hashlib.sha1(text.encode("utf-8")).hexdigest()[:12] + ".mp3"
        data = to_mp3(audio, sr)
        (OUT / "ja" / name).write_bytes(data)
        manifest[text] = f"ja/{name}"
        total += len(data)
        if line["kind"] in ("tile", "mora") and len(text) <= 2:
            print(f"{text}\t{ph}")
        if i % 50 == 0:
            print(f"... {i}/{len(lines)}", file=sys.stderr)

    # Drop clips from earlier runs that no longer have a line.
    keep = set(manifest.values())
    for f in (OUT / "ja").glob("*.mp3"):
        if f"ja/{f.name}" not in keep:
            f.unlink()

    (OUT / "manifest.json").write_text(
        json.dumps({"credit": CREDIT, "ja": manifest, "en": {}}, ensure_ascii=False, indent=0), encoding="utf-8"
    )
    print(f"\n{len(manifest)} clips, {total / 1024:.0f} KB")
    for p in problems:
        print("PROBLEM", p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
