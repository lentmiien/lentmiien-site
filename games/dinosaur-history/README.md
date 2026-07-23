# The history of the dinosaurs

`dinosaur-history` is a standalone, bilingual cinematic journey for children. It follows dinosaur history through changing ecosystems rather than presenting one timeless “dinosaur age.”

The main server discovers the directory automatically, lists it on `/games`, and serves it at:

```text
/dinosaur-history/
```

No route or dependency change is required. The server must restart before a newly added game directory is discovered.

## Experience

- Thirteen navigable scenes: nine story chapters, three short discoveries, and one reflective finale.
- Ten original 1600×900 cinematic WebP scenes, with three quiz callbacks to the relevant chapter art.
- Complete English and Japanese localization for content, controls, metadata, accessibility labels, quizzes, feedback, help, disclosures, source titles, narration, and transcripts.
- English narration uses the local Piper `en_US-lessac-medium` voice (Lessac, male).
- Japanese narration uses the local Voicevox `ja_shikoku_metan_normal` voice (四国めたん, female).
- Narration totals about 7:08 in English and 7:30 in Japanese. The opening describes the journey as about eight minutes.
- One user gesture starts the experience and unlocks audio. Every scene then supports replay, mute/unmute, audio progress, and a matching transcript.
- A language change keeps the current scene, quiz answers, panel preference, captions, and navigation state while replacing the scene’s narration and transcript.
- The information panel can be hidden for an image-and-narration mode. Discoveries force it open, disable hiding, and restore the saved preference after the viewer leaves.
- Only the opening art is preloaded in HTML. Remaining images warm after the start action without blocking first render.
- Crossfades, slow image drift, tone-colored atmosphere, and panel transitions honor `prefers-reduced-motion`.

## Story map

1. Deep-time scale and the Triassic–Jurassic–Cretaceous map.
2. Small, uncommon dinosaur beginnings on Pangaea.
3. Discovery: place the three periods in order.
4. Jurassic giants, including real neighbors Diplodocus and Stegosaurus.
5. Feathers before flight and the theropod branch leading to birds.
6. Separated Cretaceous worlds and the changing Spinosaurus reconstruction.
7. Real, small, feathered Velociraptor and clues from eggs and nests.
8. The genuine overlap of Tyrannosaurus rex and Triceratops—and famous dinosaurs that could not meet.
9. Discovery: choose the real contemporaries.
10. Fossils, trackways, uncertainty, and how reconstructions are tested.
11. Discovery: identify the clue that directly records movement.
12. Chicxulub, environmental aftermath, extinction, and bird survival.
13. Finale: living birds carry the dinosaur story into the present.

Dates use the December 2024 International Chronostratigraphic Chart, rounded for listening: Triassic 252–201 million years ago, Jurassic 201–143 million years ago, and Cretaceous 143–66 million years ago. See [SOURCES.md](SOURCES.md) for the evidence map and the 143.1-million-year boundary note.

## Controls

- `←` / `→`: previous or next scene
- `1`–`3`: answer the current discovery
- `R`: replay narration
- `C`: open or close the transcript
- `M`: turn narration on or off
- `P`: show or hide the story panel
- `L`: switch between English and Japanese

The same actions are available through visible, touch-friendly controls. Language, navigation, sound, transcript, progress, and help remain available while the story panel is hidden.

## Structure

```text
dinosaur-history/
├── README.md
├── SOURCES.md
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
        ├── en/
        │   ├── *.txt
        │   ├── *.mp3
        │   └── source-wav/*.wav
        └── ja/
            ├── *.txt
            ├── *.mp3
            └── source-wav/*.wav
```

`js/story.js` is content-only and exposes `window.DINO_HISTORY`. It contains the shared scene definitions, bilingual copy, interface dictionaries, art descriptions, focal positions, and source ledger. `js/app.js` owns rendering, navigation, language changes, quizzes, media, panel state, image transitions, accessibility announcements, local preference handling, and the decorative atmosphere.

All runtime assets are local. The application has no new package dependency and contacts no speech or media service while running.

## Visual system

The standalone page imports `/css/color-theme.css`. Graphite is the base, Ember is reserved for primary actions, Golden Amber is used for focus and highlights, and Jade marks quiz answers. Scene tones—Triassic copper, Jurassic green, lagoon blue, river teal, Gobi ochre, and impact ember—are decorative accents only.

Each image has a stored focal point used by `object-position`. Desktop layouts alternate the glass panel while mobile uses a center-safe crop. Hidden-panel mode reduces the story-oriented wash and vignette so the art becomes meaningfully clearer, including at phone widths.

The generated scenes are artist’s reconstructions, not photographs. Image prompts, dimensions, focal positions, and scientific caveats are in [assets/images/GENERATED-ASSETS.md](assets/images/GENERATED-ASSETS.md).

## Validation

Focused checks:

```bash
node --check games/dinosaur-history/js/story.js
node --check games/dinosaur-history/js/app.js
npm test -- tests/unit/dinosaurHistoryGame.test.js --runInBand --coverage=false
```

The repository’s plain focused `npm test -- <file>` form still enables global coverage and can exit nonzero because unrelated critical modules are not exercised. `--coverage=false` isolates the focused contract. Do not use `npm start` as a smoke test; its prestart pipeline mutates generated data.

