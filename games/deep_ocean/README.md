# Deep sea journey

`Deep sea journey` is a 10–15 minute, bilingual audiovisual tour for young
children. It follows ocean animals from an estuary at sea level to Challenger
Deep. The app is a standalone experience served by the main site at
`/deep_ocean/`.

## Journey shape

The experience contains 12 scenes: eight core story chapters, three short
multiple-choice discoveries, and a finale.

1. **River meets sea** — estuary nurseries, shore crabs, amphipods, and young
   fish
2. **The sunlit neighborhood** — coral animals, green turtles, cleaner shrimp,
   and parrotfish
3. **Discovery: a breath at the surface**
4. **The twilight commute** — lanternfish and the enormous daily vertical
   migration
5. **Midnight listeners** — sperm whales, giant squid, bioluminescence, and
   life without sunlight
6. **Discovery: living light**
7. **An oasis without sunshine** — hydrothermal vents, giant tube worms, and
   chemosynthesis
8. **Discovery: the vent kitchen**
9. **Snow over the abyss** — marine snow, dumbo octopuses, sea cucumbers, and
   tripod fish
10. **A soft fish in a hard place** — hadal snailfish and the deepest observed
    fish record
11. **The smallest explorers** — Challenger Deep, amphipods, sea pigs, a
    scientific lander, and extreme pressure
12. **Finale: every depth is connected** — a visual and narrative return to
    the shore

The discovery scenes have three plausible choices and explain the animal fact
after any answer. They are narrative pauses rather than score challenges.

## Languages and narration

Every runtime string and scene is available in English and Japanese. The
opening screen makes the choice explicit, and the top-bar switch remains
available throughout the dive, including when the story panel is hidden.
Language preference is stored when browser storage is available.

- English narration: local Piper `en_US-lessac-medium` voice (Lessac)
- Japanese narration: local Voicevox `ja_shikoku_metan_normal` voice
  (四国めたん)
- English running time: approximately 9 minutes 23 seconds
- Japanese running time: approximately 11 minutes 18 seconds

Each scene has an exact `.txt` transcript, a browser-ready VBR MP3, and a
retained WAV master. Switching language replaces the current scene's audio and
transcript without changing the scene, visited discoveries, or navigation
progress. No external speech or media service is used at runtime.

See [assets/audio/README.md](assets/audio/README.md) for formats and durations.

## Controls and accessibility

- Use the on-screen arrows or depth-progress rings to move between scenes.
- Use `←` and `→` for previous and next.
- Use `1`, `2`, or `3` to answer a discovery.
- Use `R` to replay narration, `C` to toggle the exact transcript, `M` to
  toggle sound, `P` to show or hide the story panel, and `L` to switch
  language.
- Use `Escape` to close the transcript or information dialog.

Narration begins only after the start button supplies a user gesture. Playback
has replay, mute, progress, loading, completion, and failure states. The exact
transcript opens independently of the story panel and remains a fallback when
audio cannot play.

The story panel starts visible for a first-time visitor. Its preference is
remembered when practical. Hiding it reduces panel-side shading while leaving
navigation, progress, language, sound, transcript, and help controls in place.
A discovery always reveals and locks the panel so its question can be answered;
after leaving the discovery, the viewer's previous hidden preference is
restored. Labels, `aria-pressed`, focus, `inert`, and polite announcements track
the real state.

The shell uses semantic landmarks, visible focus treatment, generous touch
targets, safe-area insets, Japanese-aware line breaking, and a reduced-motion
mode. Only the opening artwork is preloaded; later images warm during idle time
after the journey begins.

## Visual direction

Eight original 16:9 natural-history scenes form one cinematic descent. Water
color and visibility shift with depth while the controls retain the
repository's Graphite, Ember, and Golden Amber hierarchy through
`/css/color-theme.css`. The opening estuary returns in the finale as a deliberate
visual callback.

Generated scenes are artist interpretations, not field photographs or
scale-accurate diagrams. Two generations received focused revisions: the
abyssal scene for clearer animal anatomy, and the vent scene to remove
fire-like color and an oversized crustacean. See
[assets/images/GENERATED-ASSETS.md](assets/images/GENERATED-ASSETS.md) for the
prompt and focal-position manifest.

## Research

Story facts and cautious record wording were checked on 2026-07-28 against 17
institutional sources from NOAA, NOAA Fisheries, NOAA Ocean Exploration, WHOI,
the Smithsonian Ocean Portal, the University of Tokyo/Tokyo University of
Marine Science and Technology, Schmidt Ocean Institute, and JAMSTEC. The
localized information dialog links every source and explains that ocean-zone
boundaries are conventions and animal depth ranges vary.

The most change-sensitive claims are qualified in the story: the deepest
observed fish record is tied to the 2022 Izu-Ogasawara footage, and Challenger
Deep is described using NOAA's published `10,935 ± 6 m` sonar estimate rather
than as a timeless exact number.

## Files

```text
games/deep_ocean/
├── index.html
├── css/styles.css
├── js/
│   ├── story.js
│   └── app.js
└── assets/
    ├── images/
    │   ├── GENERATED-ASSETS.md
    │   └── *.webp
    └── audio/
        ├── README.md
        ├── en/
        │   ├── *.txt
        │   ├── *.mp3
        │   └── source-wav/*.wav
        └── ja/
            ├── *.txt
            ├── *.mp3
            └── source-wav/*.wav
```

Story and localization data live in `js/story.js`; interaction and media state
live in `js/app.js`. The focused repository test is
`tests/unit/deepOceanJourneyGame.test.js`.

## Validation

From the repository root:

```bash
node --check games/deep_ocean/js/story.js
node --check games/deep_ocean/js/app.js
npm test -- tests/unit/deepOceanJourneyGame.test.js --runInBand --coverage=false
```

The coverage flag is disabled for the isolated asset-integrity suite because
the repository's global thresholds cover unrelated server modules. The normal
full-suite command remains `npm test`. Do not use `npm start` as a smoke test:
this repository's prestart workflow mutates generated and database data.
