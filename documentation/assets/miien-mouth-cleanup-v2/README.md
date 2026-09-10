# Mouth cleanup review artifacts

Generated offline with `volta run --node 24.20.0 node scripts/review-miien-mouth-assets.js` from the committed base and old/new mouth patches. No image generation, application startup, live synthesis or private data. Review output is deterministic for the installed Sharp/lockfile; images contain no runtime conversation data.

- `mouth-comparison.png`: columns resting, old small, corrected small, old open, corrected open. Rows room gradient endpoints `#0e0f13` (`--bg`), `#20242a` (`--surface-3`), light stress background `#e8dfd2`. Mouths are magnified 3× using nearest-neighbor sampling to expose seams.
- `portrait-backgrounds.png`: columns resting, corrected small, corrected open. Same background rows, at half the runtime canvas size.
- `mouth-cycle.webp`: eight frames, looping resting/small/open/small/resting/small/open/resting. This offline illustration is not a live playback-cadence test.

The source artwork and composites were visually inspected. No rectangular seam was apparent in the corrected comparisons; generated lip shading still varies between states. Outside-mask pixels are unchanged; outer-seam deltas stay below one RGB level in automated compositing checks. Source-over adds some opacity inside the changed mouth: the original base's partial alpha cannot be exactly preserved by an overlay. The reference-background correction and minimum alpha bound background response error below five RGB levels on black/white stress backgrounds.

These are composites, not browser/device screenshots or human acceptance. Actual device scaling, display color, motion comfort and live Anny intelligibility remain Lennart's verification. The original character/blink artwork, idle timing and approximate playback-timed mouth cadence are unchanged. See [the current checklist](../../chat5-miien.md#lennarts-deployment-and-human-verification-checklist) and [source provenance](../miien-neutral-v1/provenance.json).
