# Kardashev narration assets

All narration is in natural English and was synthesized locally with Piper voice `en_US-lessac-medium` (male, en-US). Each `.txt` file is the exact UTF-8 text passed to the synthesizer for its matching WAV; the same file is fetched as the optional browser transcript.

WAV masters are mono, 22,050 Hz, 16-bit PCM and remain under `source-wav/`. Browser files were converted sequentially with FFmpeg, `libmp3lame`, and VBR quality 2. No external speech or media service is used at runtime.

| Scene asset | WAV duration |
| --- | ---: |
| `the-signal` | 51.409 s |
| `humanity-073` | 52.059 s |
| `quiz-measure` | 17.624 s |
| `type-one` | 61.068 s |
| `planetary-threshold` | 60.709 s |
| `quiz-type-one` | 17.845 s |
| `type-two` | 52.721 s |
| `stellar-industry` | 57.481 s |
| `quiz-waste-heat` | 17.519 s |
| `type-three` | 58.282 s |
| `meaning-of-the-scale` | 59.640 s |
| `finale` | 60.430 s |
| **Total** | **566.787 s (9:26.8)** |

The light quiz interactions supply the remaining pause in the target ten-minute visit.

## Generation and conversion

Each master was generated one at a time with the installed local TTS script:

```bash
python3 /home/lennart/.codex/skills/generate-local-tts/scripts/generate_tts.py \
  --voice en_US-lessac-medium \
  --text-file /absolute/path/to/scene.txt \
  --output /absolute/path/to/source-wav/scene.wav
```

Each MP3 was then converted without replacing the WAV:

```bash
ffmpeg -nostdin -n \
  -i /absolute/path/to/source-wav/scene.wav \
  -codec:a libmp3lame -q:a 2 \
  /absolute/path/to/scene.mp3
```

`ffprobe` confirmed all twelve MP3s use the MP3 codec, 22,050 Hz mono audio, and have positive duration and file size. An FFmpeg volume scan found consistent mean levels from −17.8 dB to −16.6 dB.
