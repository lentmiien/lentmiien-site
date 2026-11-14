# Lumenwild · The Waking Guardians

A standalone maze adventure about a lantern fox restoring a forgotten botanical world. **Play at `/lumenwild/`**, or find Lumenwild in `/games`.

No app-route changes, database migration, environment variables, dependency installation, or build step are required. The existing game directory mount serves this folder; all resources are local.

## The adventure

Five chapters open fifteen regions. Recover three heartseeds in each region and return to its waygate. The new guardian regions also require an encounter at their arena. Every expedition saves between sessions, including during a boss fight.

| Journey | Regions | Distinct exploration |
| --- | --- | --- |
| The First Light | Verdant Hollows, Moonwell Archive, Glassbloom Conservatory | Winding hedges, library aisles, and courtyards; root lanterns, memory lenses, and glass blossoms |
| The Amber Frontier | Tideweave Marsh, Saffron Orchard, Clockwork Cloister | Ferry landings, branching orchard groves, and connected clockwork chambers |
| The Far Horizon | Frostglass Grotto, Cinderroot Caldera, Astral Canopy | Crystal caves, caldera rings, and island bridges; prisms, cooling hearts, and ordered star anchors |
| **The Rainbound Wilds** | **Sunken Belfry, Mycelium Warrens, Stormglass Causeway** | **Concentric flooded ruins, connected mushroom chambers, and narrow causeways; the Bellkeeper and Tempest Roc** |
| **Where Dawn Begins** | **Sundial Desert, Velvet Labyrinth, Aurora Crown** | **Dune rings, woven hedge lanes, and crystal terraces; sun dials, silk lanterns, and the Dawn Hart** |
| The Long Way Home | The original nine regions | A saved pilgrimage with eight blessing choices |
| **All the Little Lights** | **All fifteen regions** | **A saved homecoming with fourteen distinct blessings and all three guardians** |

The First Light opens The Amber Frontier. Finishing the Frontier opens both the Far Horizon and the Rainbound Wilds. Rainbound opens Where Dawn Begins, then the fifteen-region journey. The original nine-region pilgrimage still follows the Far Horizon. Any unlocked region can be visited individually; completed regions offer optional tier II and III surveys.

## The waking guardians

Collect a region’s three heartseeds, then approach its arena and press **E**. The introduction explains the guardian before the fight begins; hearts and focus refill. Restore the region’s three landmarks first for longer attack warnings.

| Guardian | Patterns | Gifts |
| --- | --- | --- |
| The Bellkeeper | Alternating bell lanes, rising tide rings, realm-marked echoes | Bellwater pulse art; Tidekeeper’s vow heals after a successful guard |
| The Tempest Roc | A broad flight lane, targeted feathers, crosswinds; lands near you after a dive | Storm feather art; Windkeeper’s ribbon speeds dash recovery |
| The Dawn Hart | Branching roots, a crown of light, realm-marked sky attacks | Daybreak art; The dawn seed adds maximum hearts and starting seedbombs |

All three have three phases. A committed attack continues when you stand still, fold, attack, or cast an art. Read the marked ground and its countdown, then dodge or guard. A Bloom/Echo symbol means the attack only hurts in that realm, and every pattern also leaves safe ground. **Open-heart recovery windows take double damage.** Phase boundaries prevent a supply burst from skipping the rest of the encounter.

A failed attempt returns you to the entrance with full hearts and the exact supplies you entered with. The maze, findings, and expedition progress remain. The pause menu also lets you leave voluntarily. Victory restores hearts and focus, grants a tonic and starlight, and unlocks the guardian’s art and charm.

**Guardian trials** in the world atlas take you straight to a previously awakened guardian. Three tiers offer more resolve and shorter warnings, with no repeated heartseed hunt. Each first-earned seal awards 40 starlight. Trials do not advance regional survey progress.

## More reasons to wander

- **Wandering wayfarer:** trade expedition starlight for a tonic bundle, bombs and thread, or a discovery chart that reveals objectives and refills focus. One purchase per visit; camp savings are not spent.
- **Lost fireflies:** carry a firefly to the waygate for 12 starlight, a tonic, and two hearts. Three rescues unlock a charm with extra focus capacity and starting threads. A carried firefly gets priority in the guiding thread.
- **Fold looms:** interact to swap nearby Bloom and Echo shortcuts. Affected tiles appear on the atlas. Ordinary routes remain connected, and a loom cannot close a path beneath you.
- **Dreamcap travel:** restored mushrooms transport you through the warrens’ root network. New landmark secrets open shortcuts and help with guardian preparations.
- **90 memories and 45 relics:** each region has six pages and three relics. New visits prefer undiscovered finds; full exploration across three visits can complete each region’s collection.
- **45 survey medals:** bronze, silver, and gold combine completed visits, exploration, collections, and landmark secrets. Each medal awards 25 starlight.
- **27 permanent upgrade levels, nine arts, four collectible charms, and 16 expedition blessings.** Equip one art and one charm at camp for the next expedition. A continuing expedition keeps its original equipment.
- **Daily journeys:** a UTC-date seed selects three regions from across the fifteen-region world. Loadouts and discoveries are independent of camp upgrades, charms, collections, arts, and gentle settings. Scores stay local.

## Combat and controls

Fifteen ordinary enemy types use bites, targeted shots, slams, lanes, crosses, fans, and bursts. Their warning rings count down in real time. Ordinary sweeps do not interrupt them; folding, bombs, and arts can. Guardians resist these interruptions. Guard reflects either kind of attack. A short damage grace period prevents simultaneous hits.

| Input | Action |
| --- | --- |
| WASD / arrows | Move; hold to continue walking |
| Space | Lantern sweep |
| G / R | Timed mirror guard / equipped art |
| Q / Shift | Fold between Bloom and Echo / dash in your facing direction |
| E | Interact with discoveries, traders, looms, arenas, and waygates |
| 1 / 2 / 3 | Tonic / seedbomb / guiding thread |
| M / J / Escape | Atlas / journal / pause |
| Touch | Direction pad, swipes, and ten action buttons |

Every menu, reading dialog, hidden tab, and focus loss pauses combat. No offline time is replayed. Gentle journeys add hearts and tonics, lengthen warnings, and limit incoming damage to one heart. Reduced-motion preferences disable decorative movement. Optional sound uses Web Audio.

## Saves and compatibility

The existing localStorage key, `lumenwild.garden.v1`, now stores **version 3** data. Camp upgrades, starlight, collection identifiers, and previous chapter records retain their meanings. Unfinished version-one and version-two expeditions use frozen generators and keep their exact maps. They receive the new maze encounters when the player starts a new expedition.

Actions autosave after a short debounce; active combat checkpoints every two seconds. Page exit and returning to camp flush immediately. Guardian phase, warnings, landing targets, retry supplies, loom orientation, and firefly state persist. Discoveries, guardian ranks, and delivered fireflies sync to camp; starlight and completed surveys are banked on victory, defeat, or early return. Rewards cannot be awarded twice by reloading.

Progress stays in this browser. Storage failures show a notice without preventing play. Reset requires confirmation and affects only Lumenwild. There are no runtime external services, tracking, uploads, HTTP mutations, account integrations, or database operations. See [the security contract](docs/SECURITY.md).

## Art and implementation

This expansion adds **101 generated WebP assets**: 32 terrain tiles, 24 creature poses, 32 relic/landmark/encounter sprites, 12 guardian poses, and an illustrated atlas. The game now has **243 WebP assets, approximately 5.85 MiB**. Artwork used the imagegen skill’s built-in generation and editing tool; grid extraction and resizing used Sharp. See [the guardian prompts and asset record](assets/GUARDIAN-ASSETS.md), [previous expansion art](assets/EXPANSION-ASSETS.md), and [original art](assets/GENERATED-ASSETS.md).

- `js/content.js`: all region, story, creature, chapter, guardian, art, and charm definitions.
- `js/core.js`: shared geometry/random helpers, frozen version-one generator, and entry point.
- `js/world-v2.js`: frozen version-two map generator.
- `js/world.js`: fifteen layouts, encounters, and isolated trial arenas.
- `js/guardians.js`: guardian patterns, phases, recovery, retry, and save validation.
- `js/engine.js`: progression, combat, pathfinding, encounters, and versioned saves.
- `js/render.js`: Canvas artwork, fog, effects, warning shapes, and regional atlas.
- `js/game.js`: input, dialogs, camp, world atlas, workshop, journal, saving, and sound.

## Verification

Use repository-pinned Node **26.13.0**:

```sh
npm test -- tests/unit/lumenwildGame.test.js tests/unit/lumenwildExpansion.test.js tests/unit/lumenwildGuardians.test.js tests/unit/lumenwildUi.test.js --coverage=false
```

[Validation notes](docs/VALIDATION.md) distinguish simulation and DOM checks from browser checks. The optional Playwright smoke test uses a localhost-only static fixture, never app.js or prestart:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chrome node tests/browser/lumenwild.smoke.cjs
```

It writes screenshots and results to `/tmp/lumenwild-review` (`LUMENWILD_REVIEW_OUTPUT` overrides this). For a manual preview from the repository root:

```sh
node -e "const express = require('express'); const app = express(); app.use('/css', express.static('public/css')); app.use('/lumenwild', express.static('games/lumenwild')); app.listen(8098, '127.0.0.1');"
```

Open `http://127.0.0.1:8098/lumenwild/`; stop with Ctrl+C.
