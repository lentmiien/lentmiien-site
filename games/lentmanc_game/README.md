# The great adventure

**The great adventure** is a complete, English-language, story-focused 2D RPG adapted from the Swedish outline in `idea.txt`. It is designed as a 20–30 minute standalone browser adventure for keyboard and touch.

## Play

The Express application serves the game at:

```text
/games/lentmanc_game/
```

The game has no runtime network or third-party media dependency. It imports the site-wide Graphite/Ember/Golden Amber theme from `/css/color-theme.css`; every other runtime resource is stored in this directory.

## Format

- Seven compact, authored top-down maps rendered from maintainable tile data.
- A painted chart of the complete Hand with labeled HTML markers, visited-route trails, an always-available current-location view, and a dedicated travel interlude before every map change.
- Environmental inspection, optional clues, NPC conversations, and route-order consequences.
- A personal mushroom-gathering prologue, illustrated dialogue, fuller character conversations, and cinematic story scenes.
- Five choice-driven story encounters with no conventional combat, equipment, levels, or grinding.
- Clearly foreshadowed reckless choices, four recoverable game-over scenes, and eight named automatic checkpoints.
- Three source-faithful endings: **The Severed Dawn**, **A Crown of Ash and Peace**, and **The Open Sky**.
- A completion library on every ending screen with expandable profiles for eleven character entries and eleven locations across Asterra and Veyra.
- Local save/continue, checkpoint retry, pause, restart, ending replay, and graceful in-memory fallback when storage is unavailable.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | Arrow keys or WASD | Direction pad |
| Interact / advance | Enter, Space, or E | Interact / Continue |
| Select a choice | Arrow keys and Enter, or number keys | Choice button |
| Pause / cancel | Escape | Pause button |
| Open world map | M or Map button | Map button |
| Review dialogue | Transcript button | Transcript button |

All menu and dialogue controls use semantic HTML and are keyboard accessible. Settings include voice mute and volume, automatic voice playback, three text speeds, reduced motion, decorative-animation control, and high contrast. Captions and exact transcripts accompany every spoken line.

## Structure

- `index.html` — accessible standalone shell and all menus.
- `css/styles.css` — responsive presentation and accessibility states.
- `js/game.js` — exploration renderer, scene interpreter, world-map travel flow, state, save, input, and UI.
- `js/story.js` — data-driven scenes, choices, encounters, and endings.
- `js/maps.js` — tile maps, collision, spawns, NPCs, world-chart coordinates, travel legs, and interaction points.
- `js/characters.js` — recurring-character presentation and voice assignments.
- `js/audio.js` — local voice playback and graceful audio fallback.
- `docs/GAME-DESIGN.md` — mechanics, narrative structure, flags, endings, and adaptation decisions.
- `docs/CHARACTER-BIBLE.md` — definitive recurring-character visual and dialogue specifications.
- `assets/images/GENERATED-ASSETS.md` — image prompts, references, processing, continuity review, and counts.
- `assets/audio/en/audio-manifest.json` — speaker, script, format, path, and duration for each voice clip.

## Creative additions

The original outline supplies the two dimensions, Hand-shaped continent, seven crystals, destroyed village, injured knight, grieving woodcutter, desperate king, ill queen, airship, eclipse rule, and three ending outcomes. The adaptation adds the names Asterra and Veyra; protagonist Aren Vale; his parents Nessa and Tomas, shared-supper errand, and postponed courier plan; Willowmere, Greenwake, Ashfinger, Cinder Thumb, Crown City, and Frostcrown; the civilians Mira and Mara; Prince Lucen’s resistance; the Starling airship; the moonleaf cure; optional clue trails; rescue outcomes; a complete authored geography; and connective scenes that make each journey and ending a deliberate choice. Major introductions, a river-road campfire, the Starling launch, the Veyran confrontation, and all three epilogues were expanded to give motives and relationships time to land.

The ending-only **People & places** archive is also original to this adaptation. It draws stable names, portraits, roles, and map metadata from the existing data modules, while its longer character arcs and location notes remain in `js/story.js`. It does not add save-schema fields, so older completed v1 saves can open it immediately.

Artwork was generated locally with OpenAI image generation and then reviewed, corrected, cropped, and optimized for the game. Exploration tiles and sprites are deterministic canvas art so collision and silhouettes remain readable. Narrator and protagonist voice clips were synthesized locally with Piper and converted locally with FFmpeg. Generated-media disclosures and source notes are also available in the in-game Credits screen.

## Validation

Run the focused suite from the repository root:

```sh
npm test -- --runInBand tests/unit/lentmancGame.test.js --coverage=false
```

The suite checks the standalone shell, grounded prologue, expanded introductions, story graph, ending-library coverage, exploration maps, world-chart coordinates and travel legs, collision and references, ending reachability, checkpoint recovery, resumable mid-travel saves, voice restrictions, exact transcript alignment, local asset integrity, accessibility controls, responsive hooks, save fallback, and route registration.
