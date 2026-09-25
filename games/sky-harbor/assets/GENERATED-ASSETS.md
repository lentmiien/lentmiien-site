# Local assets and provenance

Generated on 2026-09-25, following Amber Isle's existing deterministic local vector-art process. No stock image, AI image service or runtime asset download is used.

- `images/flight-poster.svg`: original code-authored coastal flying illustration, patchwork fields, runway and amber-winged trainer.
- `images/flight-poster.png`: actual 1100 × 650 PNG rasterization of that SVG, using the repository's existing `sharp` package at development time.
- `images/emblem.svg`: original Golden Amber aircraft emblem.
- Original low-poly aircraft, clouds, terrain, airport and scenery geometry is created in local renderer source. Map imagery and runway numbers/markings are generated locally at runtime from the same authored world, without fetching textures.

Reproduce the artwork:

```sh
node games/sky-harbor/scripts/generate-assets.cjs
```

## Optional speech

`audio/briefing.wav` is **actual generated Piper speech**, using configured `en_US-lessac-medium`, not a placeholder or browser speech synthesis.

- Duration **13.886 seconds**, mono PCM WAV, 22,050 Hz, 16 bit, 612,396 bytes.
- Exact transcript in `audio/briefing.txt`, also displayed in the game.
- Explicit Listen gesture only; stop button, pause/menu stop, and readable fallback if playback fails. No audio starts automatically. There is no engine loop or runtime synthesis.
- Generated with the local `generate-local-tts` skill; no voice model or synthesis binary is redistributed. The WAV alone is sufficient to play.

Author's optional regeneration command (use a new output filename to preserve an existing clip):

```sh
python3 /home/lennart/.codex/skills/generate-local-tts/scripts/generate_tts.py \
  --voice en_US-lessac-medium \
  --text-file /absolute/path/to/games/sky-harbor/assets/audio/briefing.txt \
  --output /absolute/path/to/a/new-briefing.wav
```

Original game code, generated artwork and narration follow the repository's ISC license declaration. Third-party runtime code is limited to unmodified Three.js 0.185.1; its complete MIT notice and hashes are included under `vendor/`. The local theme copy follows the existing site's tokens. No third-party art or font is downloaded or redistributed.
