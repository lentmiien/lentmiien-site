# Narration assets

The narration is generated and served locally. Runtime playback never calls an
external speech service.

## Voices and layout

- `en/`: Piper `en_US-lessac-medium`, male Lessac voice, mono 22,050 Hz WAV
  masters
- `ja/`: Voicevox `ja_shikoku_metan_normal`, female 四国めたん voice, mono
  24,000 Hz WAV masters
- `en/*.txt` and `ja/*.txt`: the exact text supplied to the corresponding
  synthesizer, with one transcript per scene
- `en/*.mp3` and `ja/*.mp3`: browser-ready MP3 files encoded with
  `libmp3lame` at VBR quality 2
- `en/source-wav/*.wav` and `ja/source-wav/*.wav`: retained synthesis masters

There are 12 transcripts, 12 MP3 files, and 12 WAV masters in each language.
The narration scripts cover all eight story chapters, all three discoveries,
and the finale.

## Verified duration

| Scene | English MP3 | Japanese MP3 |
| --- | ---: | ---: |
| 01 · Estuary gateway | 0:51 | 0:57 |
| 02 · Sunlit neighborhood | 0:54 | 1:01 |
| 03 · Surface-breath discovery | 0:19 | 0:26 |
| 04 · Twilight commute | 0:56 | 1:06 |
| 05 · Midnight senses | 0:59 | 1:04 |
| 06 · Living-light discovery | 0:20 | 0:26 |
| 07 · Vent oasis | 1:00 | 1:12 |
| 08 · Vent-kitchen discovery | 0:20 | 0:27 |
| 09 · Abyssal snow | 0:52 | 1:05 |
| 10 · Hadal snailfish | 0:54 | 1:10 |
| 11 · Challenger Deep | 1:00 | 1:12 |
| 12 · Finale at the surface | 0:59 | 1:13 |
| **Total** | **9:23** | **11:18** |

Durations were checked with `ffprobe` after MP3 conversion. All 24 MP3 streams
were verified as mono MP3 at their source sample rate, and all WAV and MP3 files
were non-empty. A `volumedetect` pass over every MP3 found active audible
signals: English mean levels range from approximately −17.0 to −15.9 dB, and
Japanese mean levels from approximately −26.0 to −25.0 dB.

## Reproduction notes

The project used the repository's local narration skills. Each transcript was
synthesized individually so language switching can replace one scene safely.
WAV masters were converted without overwriting:

```bash
ffmpeg -nostdin -n -i input.wav -codec:a libmp3lame -q:a 2 output.mp3
```

If a browser blocks or fails audio playback, `js/app.js` exposes a localized
failure state and keeps the matching transcript independently available.
