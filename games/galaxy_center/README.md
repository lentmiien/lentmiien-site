# Journey to the center of our galaxy

`galaxy_center` is a standalone, English-language audiovisual tour for young
children. It follows an imagined route from our Solar System to Sagittarius A*,
the supermassive black hole at the center of the Milky Way. The main site
discovers the folder automatically and serves it at `/galaxy_center/` after the
server restarts.

## Experience

The full journey runs for approximately 11 minutes 24 seconds of narration and
contains 12 navigable scenes: eight core chapters, three short discoveries, and
a finale.

1. **Our galactic address** — the Milky Way, the Orion Spur, scale, and the
   challenge of mapping a galaxy from inside it
2. **Alpha Centauri** — a three-star family, Proxima Centauri, Proxima b, and
   the limits of “habitable zone”
3. **Discovery: a ruler made of light**
4. **TRAPPIST-1** — seven rocky worlds and the transit method
5. **The Orion Nebula** — stellar nurseries, the Trapezium, and protoplanetary
   disks
6. **Crossing the disk** — spiral arms, Gaia, the central bar, and a galactic
   year
7. **Discovery: the galaxy’s slow clock**
8. **The Crab pulsar** — supernova remnants, neutron stars, and multiwavelength
   observations
9. **The Central Molecular Zone** — dust, molecular gas, infrared and radio
   maps, and the Arches Cluster
10. **Sagittarius A*** — S2’s orbit, the event horizon, and the Event Horizon
    Telescope
11. **Discovery: clues around the invisible**
12. **Finale: one galaxy** — a reflective connection between every stop and
    home

The route is deliberately narrative rather than a literal straight flight.
Nearby and well-studied systems teach the tools astronomers use before the
story turns inward across the disk. The app states clearly that people cannot
make this physical journey and that the galaxy artwork is reconstructed from
measurements rather than photographed from outside.

## Narration

All 12 scenes use the local Piper `en_US-lessac-medium` voice. The exact
transcript file for each scene was passed directly to the local synthesis tool,
so the transcript is the spoken script rather than a shortened caption.

- WAV masters: mono PCM, 22.05 kHz
- Browser audio: MP3 via `libmp3lame`, VBR quality 2
- Total runtime: 684.487 seconds, or approximately 11 minutes 24 seconds
- Runtime services: none; audio and transcripts are local

See [assets/audio/README.md](assets/audio/README.md) for per-scene durations and
verification details.

## Interaction and accessibility

- Use the on-screen arrows or route points to move directly between scenes.
- Use `←` and `→` for previous and next.
- Use `1`, `2`, or `3` to answer a discovery.
- Use `R` to replay narration, `C` to toggle the exact transcript, `M` to
  toggle sound, and `P` to show or hide the story panel.
- Use `Escape` to close the transcript or information dialog.

Narration starts only after the launch button supplies a user gesture. Playback
has loading, playing, paused, complete, mute, replay, progress, and failure
states. A failed transcript fetch falls back to the shorter chapter copy.
Unavailable storage simply disables preference persistence.

The story panel starts visible. Its preference is saved when browser storage is
available. Hiding it reduces panel-side gradients and shading while leaving
navigation, progress, sound, transcript, and help controls available. A
discovery always opens and locks the panel; leaving that scene restores the
viewer’s hidden preference. `aria-pressed`, `aria-hidden`, `inert`, focus, and
polite announcements track the actual state.

The shell uses semantic landmarks, visible Golden Amber focus rings, generous
touch targets, safe-area insets, and layouts for narrow phones and short
landscape screens. `prefers-reduced-motion` removes decorative image drift,
particles, pulses, and transition motion without removing content.

## Visual direction

Nine original 16:9 scenes use a coherent “data-informed cinematic observatory”
direction:

- Graphite space and glass surfaces
- Ember primary actions
- Golden Amber navigation and focus
- chapter-specific cyan, magenta, and warm scientific-signal colors
- restrained orbit traces and a route rail rather than a spacecraft cockpit

Every runtime scene is a local 1600×900 WebP. Only the opening scene is
preloaded in HTML; later scenes warm during idle time after launch.

The visualizations are artist interpretations. Exoplanet surfaces are unknown,
multiwavelength data is translated into visible color, sizes are not to scale,
and the Sagittarius A* scene combines EHT-like radio structure with an
illustrative stellar orbit. See
[assets/images/GENERATED-ASSETS.md](assets/images/GENERATED-ASSETS.md) for the
generation prompts, focal positions, review notes, and caveats.

## Research

Facts were checked on 2026-07-29 against 14 current institutional resources
from NASA, ESA, and ESO. The in-experience information dialog links every
source. [RESEARCH-NOTES.md](RESEARCH-NOTES.md) maps the central claims to those
sources and records uncertainty and reconstruction choices.

## Files

```text
games/galaxy_center/
├── README.md
├── RESEARCH-NOTES.md
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── story.js
│   └── app.js
└── assets/
    ├── images/
    │   ├── GENERATED-ASSETS.md
    │   └── *.webp
    └── audio/
        ├── README.md
        ├── *.txt
        ├── *.mp3
        └── source-wav/
            └── *.wav
```

`story.js` owns metadata, English UI strings, sources, and scene content.
`app.js` owns interaction and media state. No external runtime dependencies
were added.

## Validation

From the repository root:

```bash
node --check games/galaxy_center/js/story.js
node --check games/galaxy_center/js/app.js
npm test -- tests/unit/galaxyCenterJourneyGame.test.js --runInBand --coverage=false
```

Do not use `npm start` as a routine smoke test. This repository’s prestart
workflow mutates generated files and database data.
