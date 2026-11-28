# Recording the kana voice

The plan for Listen & Match's final audio (docs/LISTEN-MATCH.md, "Audio refinement"): a
native-speaker parent from the school records every kana, and those recordings replace the
interim VOICEVOX clips under the same file names. This page is the session guide. Hand
section 1 to the speaker; sections 2–3 are for whoever runs the session and imports the takes.

## Before the session

- **Written permission.** Get the speaker's written OK to use their voice in the app before
  recording. Agree how they're credited on the About screen: by name, or something like
  "a parent at our school".
- **Public or private?** If the speaker is happy for the clips to be public, Lingua Libre
  (lingualibre.org) can run the session and publish to Wikimedia Commons under a free licence.
  Otherwise record privately as below. Either way the files come here the same way.
- About an hour. A quiet room with soft furnishings (curtains, a sofa), no fan or fridge hum.
  A phone or USB mic about 20 cm from the mouth, slightly to one side. Same position all session.

## 1. For the speaker

Say each item **three times**, with a short pause between takes: calm, friendly, slightly
slow, as if to a 5-year-old. One clear syllable per take: no trailing breath, no question
lilt, no added vowel at the end.

**Watch for these** (they're the ones voices most often get wrong):

| | |
| --- | --- |
| ふ | No English "f": the lips barely touch, no teeth. |
| らりるれろ | A light tap, not an English r or l. |
| し ち つ | shi, chi, tsu (not si, ti, tu). |
| ん | A plain hum, not "nu". |
| う | Short and lightly rounded, not a long English "oo". |
| は へ | As letters: ha, he (not the particles wa, e). |
| を | The same sound as お ("o"). |

### Kana (71), in order

File names on the right: please say the file name before each item, or keep the order exactly
so takes can be named afterwards.

| | | | | |
| --- | --- | --- | --- | --- |
| あ a | い i | う u | え e | お o |
| か ka | き ki | く ku | け ke | こ ko |
| さ sa | し shi | す su | せ se | そ so |
| た ta | ち chi | つ tsu | て te | と to |
| な na | に ni | ぬ nu | ね ne | の no |
| は ha | ひ hi | ふ fu | へ he | ほ ho |
| ま ma | み mi | む mu | め me | も mo |
| や ya | | ゆ yu | | よ yo |
| ら ra | り ri | る ru | れ re | ろ ro |
| わ wa | | | | を wo (say "o") |
| ん n | | | | |
| が ga | ぎ gi | ぐ gu | げ ge | ご go |
| ざ za | じ ji | ず zu | ぜ ze | ぞ zo |
| だ da | ぢ di (say "ji") | づ du (say "zu") | で de | ど do |
| ば ba | び bi | ぶ bu | べ be | ぼ bo |
| ぱ pa | ぴ pi | ぷ pu | ぺ pe | ぽ po |

### One line

| File | Say |
| --- | --- |
| intro-en | Listen, then tap the one you hear! |

## 2. After the session: name the takes

Cut the session into one file per take (Audacity: Analyze → Label Sounds, then
File → Export Multiple), any format ffmpeg reads (WAV preferred, 48 kHz mono if you can).
Name them `<file>-<take>.wav` and put them in `audio-src/recorded/` (git-ignored):

```
audio-src/recorded/ka-1.wav   ka-2.wav   ka-3.wav
audio-src/recorded/shi-1.wav  …
audio-src/recorded/intro-en-1.wav
```

Pick the best take for each by ear. List the picks in `audio-src/recorded/takes.json`; any
kana not listed uses take 1:

```json
{ "ka": 2, "shi": 3, "intro-en": 1 }
```

ぢ, づ and を don't need their own takes: the app plays じ, ず and お for them. If they're
missing, the import copies those clips.

## 3. Import

```bash
node scripts/gen-kana-audio.ts --source recorded --voice "a parent at our school"
```

It trims each take to 30 ms of silence each side (cutting breaths), sets every clip to the
same loudness with peaks under −1 dBFS, encodes 64 kbps mono MP3, and writes the same file
names to `public/audio/kana/`. The manifest's `voice` becomes the credit you passed, with
`interim: false`. A kana with no recording stops the import (nothing is half-replaced) unless
you add `--allow-missing`, which keeps that kana's current clip and lists it.

Then:

1. Open `/tools/audio-review.html` on the dev server. The native speaker listens to every clip
   and marks it. **All must pass before release.**
2. `npm test` and `npx playwright test`.
3. Update `data/ATTRIBUTION.md`: replace the VOICEVOX section with the speaker's credit and
   permission note. The About screen follows the manifest automatically; it only links to
   VOICEVOX while the VOICEVOX clips ship.
4. Commit. The service worker picks up the new clips on families' devices at the next visit
   (same names, new content).
