# Bilingual narration assets

Every one of the 19 scenes has three matching files in each language folder:

- `<scene>.txt` — exact UTF-8 narration script and transcript asset.
- `source-wav/<scene>.wav` — untouched local speech-synthesis master.
- `<scene>.mp3` — browser asset converted with FFmpeg `libmp3lame -q:a 2`.

The UI keeps one shared `<audio>` element, never overlaps narration, and changes its source when the scene or language changes.

## Voices and formats

| Language | Voice | Engine | WAV format | MP3 total |
| --- | --- | --- | --- | ---: |
| English (`en`) | `en_US-lessac-medium` (Lessac, male) | Piper | mono, 22.05 kHz | 10:20.20 |
| Japanese (`ja`) | `ja_shikoku_metan_normal` (四国めたん, female, normal) | Voicevox | mono, 24 kHz | 12:57.41 |

Japanese scripts favor speech-friendly readings for specialist names and explain the corresponding term in the visible chapter content. English and Japanese never share an audio file.

## Clip durations

| Scene | English | Japanese |
| --- | ---: | ---: |
| `quantum-edge` | 29.28 s | 36.60 s |
| `proton` | 31.35 s | 36.65 s |
| `atom` | 33.02 s | 40.13 s |
| `dna` | 31.43 s | 41.69 s |
| `virus` | 32.97 s | 40.61 s |
| `cell` | 31.90 s | 39.12 s |
| `sand-grain` | 30.35 s | 36.96 s |
| `hand` | 32.21 s | 39.72 s |
| `human` | 30.38 s | 38.74 s |
| `blue-whale` | 31.84 s | 41.90 s |
| `city` | 32.97 s | 43.20 s |
| `earth` | 34.72 s | 43.63 s |
| `earth-moon` | 30.96 s | 38.95 s |
| `sun` | 33.44 s | 38.95 s |
| `heliosphere` | 33.62 s | 43.85 s |
| `star-gap` | 34.46 s | 40.75 s |
| `milky-way` | 34.19 s | 42.05 s |
| `ic-1101` | 34.22 s | 45.31 s |
| `finale` | 36.91 s | 48.60 s |

## Generation workflow

Each WAV was synthesized sequentially—never in a parallel batch—using the local skill script and the matching transcript as `--text-file`. No overwrite flag was used. Browser files were then converted individually without replacing any existing output:

```bash
ffmpeg -nostdin -n -i input.wav -codec:a libmp3lame -q:a 2 output.mp3
```

## Verification

All 38 MP3 files were checked with `ffprobe` for MP3 codec, positive duration and size, expected mono channel count, and expected sample rate. Each file was also decoded through FFmpeg `volumedetect`:

- English mean-volume range: −17.5 to −16.2 dB.
- Japanese mean-volume range: −26.0 to −24.8 dB.
- No empty, silent, failed, or zero-duration file was found.

The focused Jest test additionally verifies that every scene has non-empty transcript, MP3, and WAV files in both language folders and that each transcript exactly matches the corresponding localized narration field.
