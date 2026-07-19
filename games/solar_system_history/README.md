# Orrery · A Solar System Story

A standalone, cinematic 3D guided tour through Solar System history, the human story, and modelled futures for the Sun. The application is served automatically at `/solar_system_history/` after the main server restarts; it also appears in the generated `/games` index.

## Structure

- `index.html` — semantic experience shell, overlays, timeline, and controls.
- `css/styles.css` — responsive Graphite/Ember/Golden Amber presentation.
- `js/events.js` — the 27 science-grounded milestones and source links.
- `js/scene.js` — the procedural Three.js orrery, particles, bodies, era states, and camera choreography.
- `js/narration.js` — single-clip narration controller and transcript loader.
- `js/tour.js` — guided-tour state machine, Today gate, replay, accessibility, and fallback behavior.
- `assets/images/` — generated 1600×900 WebP artist impressions.
- `assets/audio/` — one transcript per event; add same-basename MP3 files here.
- `vendor/` — pinned Three.js module and its MIT license.

## Adding narration

Generate audio from any transcript and save it beside that transcript with the same basename:

```text
assets/audio/chicxulub-impact.txt
assets/audio/chicxulub-impact.mp3
```

No JavaScript change is necessary. Audio is checked lazily when its event begins. Only one shared audio element is used, and the story does not advance until the clip ends or the viewer chooses Continue. Missing audio falls back to the on-screen transcript without interrupting the tour.

## Scientific and visual scope

The event sequence is sourced in `js/events.js`. Uncertainty is explicit for the Moon-forming impact, early oceans and life, early bombardment timing, deep-future habitability, and Earth’s unresolved survival during the Sun’s giant phases.

This is a story-driven visualization rather than a numerical ephemeris. Display sizes, orbit radii, orbital speeds, camera motion, and intervals are deliberately compressed. Generated event images are presented as artist impressions. Their final prompts are recorded in `assets/images/GENERATED-ASSETS.md`.
