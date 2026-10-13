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
from typing import NamedTuple
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
# Played back at 80% of Kokoro's pace, for small ears. Slowing Kokoro itself
# (speed 0.72) makes it invent a voiced lead-in on short clips (す → "a-zu"),
# so render at 0.9 and time-stretch afterwards, keeping the pitch.
STRETCH = 0.8
KBPS = 48
PAD_S = 0.03  # silence at each end; the app overlaps clips by about this much
PEAK = 0.9
CREDIT = "Japanese voice: Kokoro-82M (jf_alpha), Apache-2.0."

# Alone, these are read as particles (wa, e); as letters they are ha, he.
# ん alone is very short and hissy; a held nasal (ɴː) sounds like the letter.
OVERRIDES = {"は": "ha", "へ": "he", "ん": "ɴː"}


class Take(NamedTuple):
    """How to say one clip when the default (phonemes at SPEED) sounds wrong."""

    ph: str  # phonemes; a final "." makes Kokoro say it as a sentence, which steadies a lone vowel
    speed: float = SPEED  # Kokoro's pace; the clip is stretched back to the same final pace
    longer: float = 1.0  # extra stretch on top (below 1 = longer)
    keep_s: float | None = None  # cut after this many seconds (drops a trailing glide)


# Single kana picked by ear (Oct 2026). Alone, Kokoro glides between vowels
# (い as "uweh", さ as "sa-ee"); these takes were the clearest.
TAKES = {
    "い": Take("i."),
    "う": Take("ɯ.", speed=1.0),
    "さ": Take("sa.", speed=1.0),
    "ふ": Take("ɸɯ.", speed=1.0),
    "へ": Take("heː."),
    "を": Take("o.", speed=1.0),
    "み": Take("mʲiː.", keep_s=0.26),  # held, then cut before it turns into "mee-ya"
    "ん": Take("ɴː.", longer=0.55, keep_s=0.2),  # a long "nnn": stretched, cut before the "-uh"
}
# Bump when clip audio changes: file names change, so devices that cached the
# old clips for offline use fetch the new ones.
CLIP_VERSION = "4"
SMALL = set("ゃゅょぁぃぅぇぉゎ")


def phonemize(g2p: ja.JAG2P, text: str) -> str:
    if text in OVERRIDES:
        return OVERRIDES[text]
    p, _ = g2p(text)
    return re.sub(r" *ː *", "ː", p).strip()  # ー arrives as " ː "


def trim_breath(audio: np.ndarray, sr: int, strict: bool) -> np.ndarray:
    """Cut Kokoro's trailing breath and leading silence.

    After a short utterance the model adds 100-180 ms of quiet, hissy breath
    (mostly >3 kHz); chained mora clips then sound like "och-hych-yoech".
    strict (single kana, which get chained to sound out words): keep only the
    one continuous sounding stretch around the loudest 10 ms frame, so a later
    puff of breath is dropped. Otherwise (whole words: may contain pauses and
    soft final syllables like the ぐ in どっぐ): keep from the first to the last
    frame above 12% of the peak. Either way, fade the end out over 40 ms.
    """
    w = int(sr * 0.01)
    env = np.array([np.sqrt(np.mean(audio[i : i + w] ** 2)) for i in range(0, len(audio) - w, w)])
    if not len(env):
        return audio
    floor = 0.12 * env.max()
    if strict:
        peak = int(np.argmax(env))
        first = last = peak
        while first > 0 and env[first - 1] > floor:
            first -= 1
        while last < len(env) - 1 and env[last + 1] > floor:
            last += 1
    else:
        loud = np.nonzero(env > floor)[0]
        first, last = int(loud[0]), int(loud[-1])
    start = max(0, (first - 2) * w)
    end = min(len(audio), (last + 2) * w)
    out = audio[start:end].copy()
    fade = min(len(out) // 3, int(sr * 0.04))
    if fade:
        out[-fade:] *= np.linspace(1, 0, fade, dtype=out.dtype) ** 1.5
    return out


def stretch(audio: np.ndarray, sr: int, rate: float) -> np.ndarray:
    """Play at `rate` × speed with the same pitch (WSOLA).

    Overlap-adds 30 ms Hann frames every 15 ms of output, reading the input
    every 15 × rate ms, each nudged (±7 ms) to the spot that best continues the
    waveform already written, so voiced sounds stay smooth instead of buzzing.
    """
    n = int(sr * 0.03)
    hs = n // 2
    ha = hs * rate
    tol = int(sr * 0.007)
    win = np.hanning(n).astype(np.float32)
    src = np.concatenate([np.zeros(tol + n, np.float32), audio.astype(np.float32), np.zeros(tol + 2 * n, np.float32)])
    frames = int(len(audio) / ha) + 1
    out = np.zeros(frames * hs + n, np.float32)
    norm = np.zeros_like(out)
    prev = tol + n  # where the previous frame was read
    for k in range(frames):
        centre = int(round(tol + n + k * ha))
        if k:
            want = src[prev + hs : prev + hs + n]  # natural continuation of the last frame
            best, score = centre, -np.inf
            for d in range(-tol, tol + 1):
                c = centre + d
                v = float(np.dot(want, src[c : c + n]))
                if v > score:
                    best, score = c, v
            centre = best
        out[k * hs : k * hs + n] += src[centre : centre + n] * win
        norm[k * hs : k * hs + n] += win
        prev = centre
    out = out / np.maximum(norm, 1e-3)
    return out[: int(len(audio) / rate)]


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
        take = TAKES.get(text) or Take(phonemize(g2p, text))
        ph = take.ph
        unknown = sorted({c for c in ph if c not in DEFAULT_VOCAB})
        if not ph or unknown:
            problems.append(f"{text}: phonemes {ph!r} unknown {unknown}")
            continue
        audio, sr = kokoro.create(ph, voice=VOICE, speed=take.speed, lang="ja", is_phonemes=True)
        # Strict only for one sound (す, きゃ): two-kana words like ねこ lost their こ.
        one_mora = len(text) == 1 or (len(text) == 2 and text[1] in SMALL)
        audio = trim_breath(audio, sr, strict=one_mora)
        if take.keep_s:
            audio = audio[: int(sr * take.keep_s)].copy()
            fade = int(sr * 0.05)
            audio[-fade:] *= np.linspace(1, 0, fade, dtype=audio.dtype) ** 1.5
        audio = stretch(audio, sr, STRETCH * SPEED / take.speed * take.longer)
        if len(audio) < sr * 0.1 or float(np.abs(audio).max()) < 0.05:
            problems.append(f"{text}: audio too short or quiet ({len(audio) / sr:.2f}s)")
            continue
        # A new take for one clip gives it a new name, so offline copies refresh.
        key = CLIP_VERSION + text + (repr(TAKES[text]) if text in TAKES else "")
        name = hashlib.sha1(key.encode("utf-8")).hexdigest()[:12] + ".mp3"
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
