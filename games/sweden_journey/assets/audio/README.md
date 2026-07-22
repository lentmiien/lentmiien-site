# Japanese narration assets

Every scene has three matching files:

- `<scene>.txt` — the exact UTF-8 Japanese narration script and caption fallback.
- `source-wav/<scene>.wav` — the Voicevox master generated with `ja_shikoku_metan_normal` (四国めたん, normal style), mono at 24 kHz.
- `<scene>.mp3` — the browser asset, converted with FFmpeg `libmp3lame -q:a 2`.

| Clip | Duration |
| --- | ---: |
| `land-of-light` | 33.50 s |
| `viking-routes` | 35.88 s |
| `quiz-viking` | 11.40 s |
| `vasa-era` | 41.59 s |
| `modern-democracy` | 46.22 s |
| `nature-access` | 39.55 s |
| `quiz-nature` | 11.09 s |
| `fika-culture` | 35.69 s |
| `ideas-nobel` | 45.46 s |
| `quiz-nobel` | 10.68 s |
| `pop-culture` | 37.49 s |
| `finale` | 36.41 s |

Total narration time is approximately 6 minutes 24 seconds. The app uses one shared audio element and never overlaps narration clips.
