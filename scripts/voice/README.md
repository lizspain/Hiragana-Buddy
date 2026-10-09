# Voice clips

The app's Japanese voice is pre-recorded with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)
(voice `jf_alpha`, speed 0.9) and shipped as small MP3s in `public/audio/`.
English prompts use the device's own speech voices (the app prefers natural
ones), so they have no clips.

Families never run any of this: the app only downloads each MP3 (a few KB) the
first time it is needed. The tools below run once, on a developer machine, and
live in the git-ignored `.voicegen/` folder (~250 MB).

## One-time setup (Windows)

```bash
mkdir -p .voicegen/uv && cd .voicegen/uv
curl -sSL -o uv.zip https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip && unzip uv.zip && rm uv.zip
cd .. && export UV_PYTHON_INSTALL_DIR="$PWD/python" UV_CACHE_DIR="$PWD/cache" UV_LINK_MODE=copy
./uv/uv.exe venv venv --python 3.12
./uv/uv.exe pip install --python venv/Scripts/python.exe kokoro-onnx "misaki[ja]" unidic-lite soundfile lameenc
./uv/uv.exe pip uninstall --python venv/Scripts/python.exe unidic   # use the 50 MB unidic-lite, not the 770 MB one
mkdir -p models && cd models
curl -sSLO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx
curl -sSLO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

## Re-render (after changing names, kana data or praise)

```bash
node scripts/voice/lines.mjs                                          # list every Japanese line
.voicegen/venv/Scripts/python.exe -I scripts/voice/render_clips.py    # ~15 min on a laptop CPU
```

`render_clips.py` checks every pronunciation against Kokoro's vocabulary and
prints a `PROBLEM` line for anything it could not render. Clips are named by a
hash of their text, so unchanged lines keep their file names.

`render_samples.py` renders a comparison table of all four Japanese voices
into `voice-samples/` (git-ignored) for choosing by ear.

Pronunciation uses misaki's default "cutlet" front end, which is what Kokoro
was trained on. (Its other "pyopenjtalk" mode emits symbols Kokoro does not
know, e.g. きゃ comes out as just "a".)
