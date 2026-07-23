# Narration assets

Every one of the thirteen scenes has a dedicated transcript, retained WAV master, and browser-ready MP3 in both languages.

```text
audio/
├── en/
│   ├── <scene-id>.txt
│   ├── <scene-id>.mp3
│   └── source-wav/<scene-id>.wav
└── ja/
    ├── <scene-id>.txt
    ├── <scene-id>.mp3
    └── source-wav/<scene-id>.wav
```

The UTF-8 text file was the direct synthesis input for its same-basename WAV, so each served transcript exactly matches its spoken script. Quiz narration invites an answer without revealing it.

## Voices

| Language | Voice | Engine | Character |
| --- | --- | --- | --- |
| English | `en_US-lessac-medium` | local Piper | Lessac, male |
| Japanese | `ja_shikoku_metan_normal` | local Voicevox | 四国めたん, female |

The English WAV masters are mono, 22,050 Hz, 16-bit PCM. The Japanese WAV masters are mono, 24,000 Hz, 16-bit PCM.

## Encoding

WAV masters were synthesized sequentially with:

```text
/home/lennart/.codex/skills/generate-local-tts/scripts/generate_tts.py
```

No two synthesis processes ran at the same time. Browser copies were then encoded individually with local FFmpeg and the required high-quality setting:

```bash
ffmpeg -nostdin -n \
  -i "/absolute/path/input.wav" \
  -codec:a libmp3lame -q:a 2 \
  "/absolute/path/output.mp3"
```

`ffprobe` verified all 26 MP3s as positive-duration MP3 audio with positive file size. The WAV masters remain unchanged.

## Durations

| Scene ID | English | Japanese |
| --- | ---: | ---: |
| `deep-time-gateway` | 39.60 s | 37.49 s |
| `triassic-beginnings` | 41.14 s | 39.82 s |
| `quiz-periods` | 14.37 s | 19.15 s |
| `jurassic-giants` | 37.54 s | 34.94 s |
| `feathers-before-flight` | 37.59 s | 38.11 s |
| `cretaceous-spinosaurus` | 38.90 s | 42.26 s |
| `gobi-velociraptor` | 38.48 s | 38.78 s |
| `last-neighbors` | 37.41 s | 39.65 s |
| `quiz-neighbors` | 13.35 s | 18.07 s |
| `fossil-detectives` | 39.99 s | 41.11 s |
| `quiz-tracks` | 14.34 s | 19.54 s |
| `chicxulub-impact` | 39.60 s | 41.26 s |
| `birds-continue` | 36.70 s | 40.92 s |
| **Total** | **428.21 s (7:08)** | **450.33 s (7:30)** |

Approximate media sizes:

- English: 18.88 MB WAV masters and 3.69 MB MP3
- Japanese: 21.62 MB WAV masters and 4.16 MB MP3

## Runtime behavior

- Narration starts only after the opening start gesture.
- A single shared audio element prevents overlapping voices.
- Changing scene or language cancels the previous clip before loading the replacement.
- Replay, mute/unmute, visible progress, and recoverable autoplay rejection are provided.
- A failed audio load leaves navigation active and points the viewer toward the transcript.
- Transcript requests are guarded by scene/language tokens, cached per locale, and fall back to localized chapter copy when unavailable.

