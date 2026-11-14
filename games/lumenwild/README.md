# Lumenwild · Beyond the Fold

A standalone maze adventure about a lantern fox restoring a forgotten botanical world. **Play at `/lumenwild/`**, or find Lumenwild in `/games`.

No app-route changes, database migration, environment variables, dependency installation, or build step are required. All code and artwork are local. The existing game directory mount serves this folder.

## The expanded adventure

Three chapters open nine regions, followed by a saved pilgrimage through the whole world. Recover three heartseeds in each region and return to its waygate. Explore the detours before leaving: each visit holds three journal pages, a regional relic, a rune shrine, and three landmarks. There is no expedition deadline; save and continue whenever you like.

| Chapter | Regions | Distinct exploration |
| --- | --- | --- |
| The First Light | Verdant Hollows, Moonwell Archive, Glassbloom Conservatory | Winding hedges, library aisles, and open courtyards; root lanterns, memory lenses, and glass blossoms |
| The Amber Frontier | Tideweave Marsh, Saffron Orchard, Clockwork Cloister | Ferry landings, branching orchard groves, and connected clockwork chambers; bells transport you and rootgears open permanent shortcuts |
| The Far Horizon | Frostglass Grotto, Cinderroot Caldera, Astral Canopy | Open caves, caldera rings, and island bridges; thawing prisms, cooling hearts, and star anchors activated in order |
| The Long Way Home | All nine regions | A longer expedition with eight distinct blessing choices and a resumable checkpoint |

The next chapter opens when you finish the previous one. Existing victories count as completion of The First Light, so returning players can immediately choose The Amber Frontier. You can also revisit any unlocked region on its own. After restoring it once, optional tier II and III surveys offer stronger creatures and larger rewards without adding more enemies.

- **54 persistent journal pages and 27 regional relics.** New expeditions prefer discoveries you have not found yet. The journal groups stories and relics by region.
- **27 survey medals.** Each region has bronze, silver, and gold requirements combining completed visits, exploration, relics, journal pages, and its landmark secret. Every medal awards 25 starlight. Requirements are visible in the world atlas.
- **27 permanent upgrade levels.** Five camp facilities improve hearts, supplies, sight, guarding, and focus. Higher levels require survey medals and larger starlight investments.
- **Six lantern arts.** Discoveries unlock a gale, briar binding, astral lance, healing shelter, cinder burst, and the far lantern. Equip one at camp; some require additional focus capacity from The deep well.
- **16 expedition blessings.** Choose from three after each restored region. Blessings include stronger sweeps, counterattacks, healing, exploration markers, faster recovery, and alchemy. Offers do not repeat blessings already chosen.
- **Two intertwined worlds.** Bloom opens sun paths; Echo opens moon paths. Seeds and landmarks may require a particular realm. Fold on ordinary ground to change routes and briefly daze nearby creatures.
- **Daily journeys.** A UTC-date seed selects one region from each chapter. Daily loadouts, discoveries, and difficulty are independent of camp upgrades, collections, equipped arts, and gentle settings. Scores remain local; there is no online leaderboard.

## Combat and controls

Enemies move and attack on a real-time clock. Their marked tiles and closing rings show where and when a strike will land. **Standing still does not stop them. Ordinary lantern sweeps deal damage but do not interrupt a committed attack.** Guard, move out of the warning, dash, or use a deliberate interruption from folding, a bomb, or an art. A short damage grace period prevents several creatures landing hits together.

Nine enemy types use bites, targeted shots, slams, long lanes, crosses, frost fans, and star bursts. The field guide explains each pattern. Gentle journeys add hearts and tonics, extend warning times, and limit incoming damage to one heart.

| Input | Action |
| --- | --- |
| WASD / arrows | Move; hold to continue walking |
| Space | Lantern sweep, with a short recovery between strikes |
| G | Mirror guard: time it to block and counter an incoming hit |
| R | Equipped lantern art; consumes regenerating focus |
| Q | Fold between Bloom and Echo |
| Shift | Mothstep dash in the direction you face |
| E | Use caches, springs, shrines, landmarks, and waygates |
| 1 / 2 / 3 | Healing tonic / seedbomb / guiding thread |
| M / J | Region atlas / journal |
| Escape | Pause, save for later, or finish early and bank discoveries |
| Touch | Direction pad, swipes, and ten on-screen action buttons |

Menus, reading dialogs, focus loss, and hidden tabs pause combat. No elapsed offline time is replayed on resume. Reduced-motion preferences disable decorative movement. Optional sound is generated with Web Audio.

## Saves and compatibility

The same localStorage key, `lumenwild.garden.v1`, now stores version 2 data. Existing camp upgrades, starlight, victories, and the first nine journal pages keep their meanings. Unfinished original expeditions use a frozen legacy generator so their maps, placements, collected items, and defeated creatures remain intact. New expeditions use the expanded world generator. Combat timing updates also apply to resumed original runs.

Actions autosave with a short debounce; active combat checkpoints every two seconds. Leaving the page or returning to camp flushes immediately. Starlight and completed surveys are banked on victory, defeat, or an early return. Starting a replacement journey brings the existing journey’s discoveries home after an in-game confirmation. Results cannot award twice on reload.

Progress stays in this browser, without account or device sync. Storage failures show a visible notice without preventing play. Reset requires confirmation and removes only this game’s saved data. There are no runtime external services, tracking, uploads, HTTP mutations, or database operations. See [the security contract](docs/SECURITY.md).

## Art and implementation

The expansion adds **89 generated WebP assets**: 32 terrain tiles, 24 creature poses, 32 relic/landmark icons, and an illustrated world atlas. Combined with the originals, the game has **142 WebP assets, approximately 3.35 MiB**. Art was generated with the imagegen skill’s built-in tool and mechanically packaged with Sharp. Prompts and provenance are in [the original asset record](assets/GENERATED-ASSETS.md) and [the expansion asset record](assets/EXPANSION-ASSETS.md).

- `js/content.js`: regions, stories, relics, enemies, chapters, blessings, upgrades, and arts.
- `js/core.js`: shared geometry and random helpers; frozen legacy map generation; CommonJS/browser entry point.
- `js/world.js`: nine layout styles and regional placements.
- `js/engine.js`: progression, combat clocks, pathfinding, and bounded versioned save validation.
- `js/render.js`: Canvas artwork, fog, effects, attack warnings, and the region atlas.
- `js/game.js`: input, dialogs, camp, world atlas, workshop, journal, saves, and sound.

## Verification

Use Node **26.13.0**, pinned by Volta in the repository. Run focused tests with:

```sh
npm test -- tests/unit/lumenwildGame.test.js tests/unit/lumenwildExpansion.test.js tests/unit/lumenwildUi.test.js --coverage=false
```

[Validation notes](docs/VALIDATION.md) distinguish simulation/DOM checks from actual browser checks. The optional Playwright smoke test starts a localhost-only static fixture, never app.js or prestart:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chrome node tests/browser/lumenwild.smoke.cjs
```

It writes screenshots and results to `/tmp/lumenwild-review` by default (`LUMENWILD_REVIEW_OUTPUT` overrides this). A manual static preview from the repository root is:

```sh
node -e "const express = require('express'); const app = express(); app.use('/css', express.static('public/css')); app.use('/lumenwild', express.static('games/lumenwild')); app.listen(8098, '127.0.0.1');"
```

Open `http://127.0.0.1:8098/lumenwild/`; stop the preview with Ctrl+C.
