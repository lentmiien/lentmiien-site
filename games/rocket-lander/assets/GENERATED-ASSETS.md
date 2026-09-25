# Original local art and sound

No downloaded art, generative-image service, secret service, runtime asset generator API, narrator or fabricated audio file is used.

- `emblem.svg`: original vector lander emblem, reproducible with `node games/rocket-lander/scripts/generate-assets.cjs`. SVG source is checked in. Uses the site's Graphite/Ember/Golden Amber colors.
- `js/renderer.mjs`: original ivory/ember/gold survey rocket, window, gear, engine bell, opposing side nozzles; authored layered skyline profiles, triangular terrain shelf, exact extruded collision silhouettes, pad lights/stripes/labels, celestial bodies/rings, aurora ribbons, vegetation, crystals, basalt and refinery details. Deterministic seeded cosmetic variation. Geometry is created locally from checked-in source, with no build or generated mesh download.
- Exhaust uses original cone meshes, an emissive engine light and at most 80 instanced low-poly particles. Landing shadow is a lightweight projected contact marker, not a global shadow map.
- `js/boot.js`: optional original Web Audio engine tone (filtered oscillator); only enabled by clicking Sound. No audio files or narration. Muting, pausing, losing focus and ending a flight silence it.
- Canvas pad labels use the local system font. No webfont requests.
- `docs/validation/*.png`: real Playwright/Chromium captures of the running game, produced by `tests/browser-smoke.cjs`; these are validation evidence, not shipped background art.

Original work belongs to this repository under its existing terms; no separate third-party art license is needed. The only third-party rendering library is unchanged **Three.js 0.185.1**, MIT licensed. Its full license, provenance and hashes are retained in `vendor/`. Theme tokens are copied locally from Sky Harbor's repository theme copy to preserve standalone portability.
