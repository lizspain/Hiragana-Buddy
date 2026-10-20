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
# Single kana (one sound: す, きゃ) a further 30% slower than words, so each
# letter is easy to hear on its own and sounded-out words aren't rushed.
ONE_MORA_PACE = 0.7
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


# Said alone, Kokoro lifts the pitch of every kana by 4-8 semitones, like a
# question; sounded out, "porcupine" became "po^ roo^ ku^ pi^ n^". Single
# kana get one shared contour instead: a gentle fall, as at the end of a
# statement, so they also match each other when strung together.
PITCH_START_HZ = 250.0
PITCH_FALL_ST = 1.5  # semitones down from the first to the last voiced moment
PITCH_STRENGTH = 0.5  # how far toward that contour: 0 = as Kokoro said it, 1 = exactly on it


def pitch_track(audio: np.ndarray, sr: int, hop: int) -> np.ndarray:
    """F0 in Hz every `hop` samples (0 = unvoiced), by normalised autocorrelation.

    Gaps inside the voiced stretch are filled, and the last pitch is held
    through the voice's quiet tail, so the tail isn't chopped as noise.
    """
    w = int(sr * 0.03)
    lo, hi = int(sr / 500), int(sr / 120)
    peak = float(np.abs(audio).max()) or 1.0
    f0, loud = [], []
    for i in range(0, len(audio), hop):
        x = audio[max(0, i - w // 2) : i + w // 2].astype(np.float64)
        rms = float(np.sqrt(np.mean(x * x))) if len(x) else 0.0
        loud.append(rms)
        if len(x) < hi * 2 or rms < 0.03 * peak:
            f0.append(0.0)
            continue
        x = x - x.mean()
        r = np.correlate(x, x, "full")[len(x) - 1 :]
        j = lo + int(np.argmax(r[lo:hi]))
        f0.append(sr / j if r[j] > 0.3 * r[0] else 0.0)
    f0 = np.array(f0)
    out = f0.copy()
    for i in range(len(f0)):  # median-smooth to drop octave slips
        if f0[i]:
            out[i] = float(np.median([v for v in f0[max(0, i - 2) : i + 3] if v]))
    v = np.nonzero(out)[0]
    if len(v):
        a, b = v[0], v[-1]
        idx = np.arange(a, b + 1)
        known = out[a : b + 1] > 0
        out[a : b + 1] = np.interp(idx, idx[known], out[a : b + 1][known])
        # Hold the last pitch while the voice fades (until it is really quiet).
        k = b + 1
        while k < len(out) and loud[k] > 0.008 * peak:
            out[k] = out[b]
            k += 1
    return out


def level_pitch(audio: np.ndarray, sr: int, strength: float) -> np.ndarray:
    """Move voiced pitch part of the way onto the shared contour (TD-PSOLA).

    strength 0 leaves the clip alone, 1 lands exactly on the contour; in
    between keeps some of the voice's own movement. Pitch marks sit one
    glottal period apart on waveform peaks while voiced, every 4 ms
    otherwise. Output marks are spaced by the new period; at each, the nearest
    input mark's two-period Hann grain is added, so timing and vowel colour
    stay and only pitch moves.
    """
    hop = int(sr * 0.005)
    f0 = pitch_track(audio, sr, hop)
    voiced = np.nonzero(f0)[0]
    if len(voiced) < 4 or strength <= 0:
        return audio
    f0_at = lambda n: f0[min(len(f0) - 1, n // hop)]
    v0, v1 = voiced[0] * hop, voiced[-1] * hop

    def new_f0(n: int) -> float:
        f = f0_at(n)
        t = min(1.0, max(0.0, (n - v0) / max(1, v1 - v0)))
        goal = PITCH_START_HZ * 2 ** (-PITCH_FALL_ST * t / 12)
        return f * (goal / f) ** strength

    unv = int(sr * 0.004)
    marks: list[int] = []
    n, was_voiced = 0, False
    while n < len(audio):
        f = f0_at(n)
        if f:
            per = sr / f
            if was_voiced:
                # Next cycle: where the waveform best matches the last cycle (not just
                # the tallest peak, which can hop between two similar peaks and jitter).
                prev, h = marks[-1], int(per / 2)
                ref = audio[max(0, prev - h) : prev + h]
                best, score = int(prev + per), -np.inf
                for c in range(int(prev + 0.9 * per), int(prev + 1.1 * per) + 1):
                    seg = audio[max(0, c - h) : c + h]
                    if len(seg) != len(ref) or c + h > len(audio):
                        continue
                    v = float(np.dot(ref, seg))
                    if v > score:
                        best, score = c, v
                if best + h > len(audio):
                    break
                n = best
            else:
                b = min(int(n + per), len(audio))
                if b <= n:
                    break
                n = n + int(np.argmax(audio[n:b]))
            marks.append(n)
            was_voiced = True
            n = int(marks[-1] + 0.8 * per)
        else:
            if was_voiced:
                n = marks[-1] + unv
            marks.append(n)
            was_voiced = False
            n += unv
    marks = np.array(sorted(set(m for m in marks if 0 <= m < len(audio))))
    if len(marks) < 3:
        return audio

    out = np.zeros(len(audio) + sr // 10, np.float64)
    norm = np.zeros_like(out)
    ts = int(marks[0])
    while ts < len(audio):
        i = int(np.searchsorted(marks, ts))
        if i >= len(marks) or (i > 0 and ts - marks[i - 1] < marks[i] - ts):
            i -= 1
        i = max(0, min(len(marks) - 1, i))
        m = int(marks[i])
        prev_gap = m - marks[i - 1] if i > 0 else marks[1] - marks[0]
        next_gap = marks[i + 1] - m if i + 1 < len(marks) else prev_gap
        half = int(max(prev_gap, next_gap))
        a, b = max(0, m - half), min(len(audio), m + half)
        win = np.hanning(b - a + 2)[1:-1]
        o = ts - (m - a)
        if o >= 0:
            out[o : o + (b - a)] += audio[a:b] * win
            norm[o : o + (b - a)] += win
        ts += int(round(sr / new_f0(m))) if f0_at(m) else unv
    res = out[: len(audio)] / np.maximum(norm[: len(audio)], 0.5)
    return res.astype(audio.dtype)


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
        if one_mora:  # before the trim, so the voice's own fade-out is re-pitched smoothly
            audio = level_pitch(audio, sr, PITCH_STRENGTH)
        audio = trim_breath(audio, sr, strict=one_mora)
        if take.keep_s:
            audio = audio[: int(sr * take.keep_s)].copy()
            fade = int(sr * 0.05)
            audio[-fade:] *= np.linspace(1, 0, fade, dtype=audio.dtype) ** 1.5
        pace = ONE_MORA_PACE if one_mora else 1.0
        audio = stretch(audio, sr, STRETCH * SPEED / take.speed * take.longer * pace)
        if len(audio) < sr * 0.1 or float(np.abs(audio).max()) < 0.05:
            problems.append(f"{text}: audio too short or quiet ({len(audio) / sr:.2f}s)")
            continue
        # A new take for one clip gives it a new name, so offline copies refresh.
        key = CLIP_VERSION + text + (repr(TAKES[text]) if text in TAKES else "") + (f"|pace{ONE_MORA_PACE}|pitch{PITCH_START_HZ},{PITCH_FALL_ST},{PITCH_STRENGTH}" if one_mora else "")
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
