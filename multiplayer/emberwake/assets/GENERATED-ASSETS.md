# Art and audio

The cooperative edition carries forward the original Emberwake Isles art and its vendored MIT-licensed Three.js renderer. Its own generator draws the rearranged navigation chart, a 128 × 320 pixel atlas and 199 SVG inventory illustrations. The harbor pennant and brass-trimmed salvager’s coffer use the same palette and geometry as their world models.

Rebuild from the repository root with `node multiplayer/emberwake/scripts/generate-assets.cjs`. The generator uses Node’s standard library. The runtime draws the live chart from terrain and shared edits. Crew models and callsign pennants are drawn in `js/crew-avatars.js`. `js/renderer.js` handles daylight, underwater lighting, creatures and boats. `js/audio.js` synthesizes the sound effects in the browser.

The app supplies the Graphite/Ember/Golden Amber stylesheet. All game art, audio and scripts run locally in the browser. The Three.js license and checksums are in `../vendor/`.
