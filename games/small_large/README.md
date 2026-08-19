# THE LONG ZOOM · From Quarks to Galaxies

`small_large` is a standalone, bilingual audiovisual presentation about physical scale. It is an entertaining guided visual essay rather than a conventional game. The repository server discovers the folder automatically, lists it on `/games`, and serves it at `/small_large/` after a server restart.

## Experience

- Nineteen navigable scenes form one continuous story: 18 scale waypoints plus a reflective finale.
- The journey moves from the smallest scale directly probed for quark structure, through protons, atoms, DNA, viruses, cells, sand, hands, people, whales, cities, Earth, the Earth–Moon gap, the Sun, the heliosphere, the nearest-star gap, the Milky Way, and a cautiously described giant galaxy.
- Three chapters include optional multiple-choice “scale pauses.” Answers persist while navigating and while changing language, but reset when the viewer restarts the experience.
- English and Japanese each have complete UI copy, accessible labels, narration, exact transcripts, quiz text, feedback, help, and disclosure text.
- The opening language choice and the compact in-experience switch both persist when `localStorage` is available. Switching language keeps the scene and answers, replaces the current transcript request safely, and starts the matching narration from the beginning.
- Every chapter has locally served narration with replay, mute/unmute, progress, error fallback, and an independent transcript panel.
- The glass story panel starts visible. `P` or the Story control hides it without removing navigation, language, sound, transcript, or help controls. An unanswered quiz temporarily reveals the panel while preserving the viewer's preference for later scenes.
- Artwork crossfades with restrained atmosphere and image drift. `prefers-reduced-motion` removes decorative movement and particles without removing information or controls.
- Only the human-scale opening artwork is preloaded. Later images warm serially after the viewer starts, using idle time when supported.

## Structure

```text
small_large/
├── README.md
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── story.js
│   └── app.js
└── assets/
    ├── images/
    │   ├── GENERATED-ASSETS.md
    │   └── 01-quantum.webp … 18-ic1101.webp
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

`story.js` is content-only. It exposes `window.SCALE_STORY` with metadata, source links, UI dictionaries, and an ordered scene array. `app.js` owns navigation, localization, quizzes, image transitions, transcript loading, narration, accessible state, preference persistence, and the decorative canvas.

## Adding another scale waypoint

1. Add one scene object to `SCALE_STORY.scenes` in the desired order. Give it a stable `id`, representative base-10 `order`, local image path, visual tone/layout/focal point, and equally complete `en` and `ja` records.
2. Add the corresponding 1600×900 WebP and document its purpose, prompt, focal point, and caveats in `assets/images/GENERATED-ASSETS.md`.
3. Add `<id>.txt`, `<id>.mp3`, and `source-wav/<id>.wav` to both language folders. Each transcript must exactly match its `narration` field.
4. If the scene is a quiz, set `kind: 'quiz'` and add a three-option localized `quiz` object. No navigation code needs to change.
5. Update the displayed duration if the total meaningfully changes, then run the focused test.

## Controls

| Action | Pointer / touch | Keyboard |
| --- | --- | --- |
| Previous / next chapter | Bottom arrow controls or progress rail | `←` / `→` |
| Replay narration | Voice button in the story panel | `R` |
| Open / close transcript | Transcript control | `C` |
| Mute / unmute | Sound control | `M` |
| Show / hide story panel | Story control | `P` |
| Switch language | `EN` / `日` control | `L` |
| Open information and sources | Information control | `I` |
| Answer a scale pause | Answer buttons | `1`–`3` |

The language control, navigation, sound, transcript, and information controls remain available in artwork-only mode. The information dialog pauses active narration and resumes it on close; hiding the story panel does not pause audio.

## Scientific framing

Values are rounded for an all-ages spoken journey. “Scale” does not always mean diameter: the story distinguishes a probed upper limit, proton charge radius, widths, representative object sizes, centre-to-centre separation, dynamic plasma boundary, and estimated luminous extent. Objects vary and several boundaries are definition-dependent.

In particular:

- Quarks are presented as point-like in current tests, not as particles with a known physical diameter.
- Atomic, quantum-field, cell cutaway, heliosphere, and whole-galaxy scenes are disclosed as artist's impressions.
- IC 1101 is described with NASA's “as much as” estimate and is not given an uncontested “largest galaxy” title.
- The institutional research links and the verification date are available from the in-experience information dialog.

## Visual system

The page imports `/css/color-theme.css`. Graphite structures the environment, Ember marks primary actions, and Golden Amber marks focus and important highlights. Topic colors—cyan at quantum scales, jade in biology, ocean blue, solar orange, and galactic violet—are decorative scene accents rather than replacements for the repository hierarchy.

All 18 runtime images are local 1600×900 WebP files at quality 86. The opening and finale deliberately reuse the human-scale scene as a visual return. See `assets/images/GENERATED-ASSETS.md` for prompts and caveats.

## Narration

English uses Piper `en_US-lessac-medium` (Lessac, male). Japanese uses Voicevox `ja_shikoku_metan_normal` (四国めたん, female, normal style). WAV masters are retained, and browser MP3s use FFmpeg `libmp3lame -q:a 2`. See `assets/audio/README.md` for durations and verification details.

## Validation

Run the focused checks without starting the mutation-heavy application pipeline:

```bash
node --check games/small_large/js/story.js
node --check games/small_large/js/app.js
npm test -- tests/unit/smallLargeJourneyGame.test.js --runInBand --coverage=false
```

Do not use `npm start` as a smoke test; the repository `prestart` process mutates generated and database data.
