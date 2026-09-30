# Emberwake Isles

**Arrive with nothing. Build a home worth sailing back to.** An original, peaceful first-person voxel survival/crafting/building game. Five large islands, four islets, fifteen connected cave paths, a finite ocean and a luxury-camp sandbox. No account, backend, telemetry, remote assets, build step or runtime AI service.

## Launch and automatic discovery

From the repository root:

```sh
python3 -m http.server 8770 --bind 127.0.0.1 --directory games/emberwake-isles
```

Open **http://127.0.0.1:8770/**. Serve over HTTP; `file://` module imports are unsupported. Desktop keyboard/mouse and WebGL 2 are required.

**Site entry: `/emberwake-isles/`**, normally **https://my.lentmiien.com/emberwake-isles/**. Read-only inspection of `app.js` confirms `serveGames()` mounts each folder at its name on application startup; `getAvailableGames()` discovers folders for the existing `/games` listing. This is **not** `/games/emberwake-isles/`. The static mount becomes available on the application's next normal startup after delivery. No shared app files, manifests, routes, indexes or other games were edited. No deployment or production restart was performed.

## A generous world, not an infinite one

Terrain occupies **1,024 × 1,024 × 80 one-metre voxels**, x/z −512…511. Play takes place inside a circular ultimate boundary of radius **490 m**. Island positions are authored for navigable channels; the seed deterministically varies relief, deposits and vegetation. The four smaller islets are at (−310,5), (35,−40), (300,−230), and (−115,280), with radii 17–24 m.

| Island | Center x,z | Main dimensions | Character and landmark |
| --- | --- | --- | --- |
| Sunwake Cay | −145,65 | 172 × 154 m | Warm sand, palms, grass, shore clay; Listening Shell |
| Mossbell Reach | −165,−170 | 176 × 164 m | Darker, denser forest and rolling meadows; Unsent Post Office |
| Saffron Atoll | 115,−175 | 178 × 152 m | Terraced sandstone mesas and cactus; Teapot Observatory |
| Cloudrest | 225,65 | 162 × 176 m | High snowy ridges, conifers and cold; Quiet Bell |
| Prism Crown | 15,260 | 164 × 150 m | Basalt uplands and underground crystals; Moon Moth Archive |

Each major island has a surface-accessible ramp leading into a mineable main tunnel, two branching passages and a chamber. Networks total approximately **148–152 m of centerline each** for the reference seed, with roughly 4 m wide / 4 m high passages and larger chambers. Floors descend to about y=4–5. The cave air stays dry below sea level. Ore seams occur in the actual mineable walls, floors and surrounding rock. All three paths were walked both ways under real collision physics across ten seeds. A permanent exploration fill light keeps caves usable; crafted torches/lanterns add local light. This is not a darkness-management game.

The chart marks entrances and landmarks. Five surface stories and five underground caches have persistent one-time rewards. Their original writing and sculptures are optional discoveries, not imported characters or franchises.

## Progression and activities

Start with an **empty pack** on a stocked natural driftwood beach. Logs yield resin. E picks renewable bushes without destroying them; foliage supplies fiber and seeds. The journal supplies ten ordered goals, then leaves the world open for building.

1. Logs → planks, a workbench and driftwood pick. Stone → a stone pick.
2. Cave copper/coal + shore clay → kiln, copper, better pick and forge. Iron feeds advanced workstations.
3. Fiber → rope, loom and cloth. Build a raft, fishing rod, garden, storage and a daybed.
4. Sail to other biomes. Island discoveries unlock regional stonework, textiles and instruments; prism seams require a copper pick or better.
5. Artisan table → refined architecture, canopy furniture, instruments, fountains, mineral bath and sculpture. Build a 95-comfort estate or a 135-comfort sanctuary.

**66 recipes**: 13 building, 4 processed-material, 9 equipment, 32 camp/station, 2 vessel, and 6 kitchen recipes. **94 item definitions**, **62 non-air voxel types**, **32 station/furnishing designs** (including six production stations). All recipes have positive consumable ingredients, reachable sources, actual outputs, and functional station/discovery checks. Crafting supports 1/5/10 batches in the UI; failed crafts consume nothing. The searchable recipe book replaces a manual crafting grid.

- **Building:** mine and place full blocks, half slabs, stairs, open window frames, railings, structural materials and shaped furnishings. Reach is 5.5 m with first-voxel line-of-sight; placement cannot overlap your body. Furniture colliders use the same box silhouettes as rendering. Asymmetric furniture and steps have fixed authored orientations. The selection outline intentionally targets the containing voxel, including the empty portions of a furnishing's cell.
- **Gardening:** garden beds alternate roots/grain by position. Seeds grow in 110 seconds of play; watering once shortens this by 40 seconds. Harvest gives three produce and two seeds. Play-time-only growth, no offline accrual.
- **Fishing:** equip rod, face low open water, press E and stay nearby for six seconds. Every fourth catch also brings a pearl. Fishing is a simple patient activity, without a timing minigame. An interrupted cast is canceled on reload; completed catches persist.
- **Cooking:** hearth cooks fish; galley makes bread, stew, preserves and feasts. Tea/feasts temporarily protect against cold. Food replenishes food/health, rather than being decorative inventory.
- **Storage:** up to 16 chests, 4,000 items each, atomic transfers within reach. Empty a chest before mining it. Pack capacity 1,800 total; each item stack at most 999.
- **Comfort:** only the first furnishing of each design contributes quality. Categories, several furnishing areas, floor construction and roof blocks contribute capped bonuses. Geometry/room scoring is intentionally simple: it does not certify enclosed rooms or structural support. Cheap duplicate chairs cannot reach estate rank.
- **Furnishings:** production stations craft; beds restore status, advance two minutes and anchor camp; baths/fountains restore health/warmth; galley/picnic can top up food; music box plays a melody when sound is enabled. Other decor contributes its specific comfort category and quality. Tools never break.

No enemies or oxygen timer. Hunger takes over two hours of active play to empty; hunger, cold and falls cannot lower health below 25. Cold highlands encourage a cloak or tea, not a punishing survival clock. Rest restores status. A disclosed **Return to camp** action helps with travel or getting stuck, available only in sheltered waters. This is a building-focused sandbox, not a combat campaign.

## Controls

| Input | Action |
| --- | --- |
| WASD + mouse | Move and look; steer/strafe under sail |
| Space / Shift / C | Jump or swim up / sprint on land / dive |
| Hold left click | Mine target; select the appropriate pick |
| Right click | Place selected block, eat food, or launch selected vessel while wading |
| E | Use bush, garden, rod, station, furniture, chest or tablet; board/moor vessel |
| 1–8 / wheel | Select hotbar slot; assign items by clicking them in Pack |
| Tab / I / B / M / J | Journal / pack / recipes / chart / journal |
| F | Eat selected food, otherwise a sunberry |
| Escape | Release pointer and pause; Return to shore resumes mouse capture |

Raft speed is **14 m/s**, upgraded cutter **22 m/s**; ordinary swims **4.2 m/s**, walking **4.7 m/s**, sprint **7 m/s**. Open channels generally take about 10–25 seconds to cross; shore-to-shore voyages and walks take longer. Vessels have direct steering rather than sailing physics, wind tacking or inertia. Shoreline step-up helps you leave the water. Vessels remain where moored and can be reboarded. There are no currents.

Native modal panels pause normal simulation, confine keyboard focus and scroll on small windows. Blur, lost pointer lock and tab hiding clear held input. The UI uses the local Graphite/Ember/Golden Amber theme, text labels, visible focus and readable panels. **Touch movement/gamepad support is not implemented**; a responsive panel is not a claim of mobile gameplay. The game itself is visual and is not a nonvisual accessible simulation.

## Outer sea: an intentional, terminal hazard

- Radius **405**: warning text, safe-save and camp-return lockout. Headwinds visibly announced in the UI slow vessels to 8 m/s.
- Radius **450**: physical amber buoys and an urgent distance-to-disaster warning. Vessels slow to 6 m/s, leaving more than six seconds from this line to the final boundary.
- Radius **490**: the game first writes a separate terminal marker, then accepts the crossing. A six-second rising-wave sequence ends the voyage. Turning, mooring, opening panels or pausing cannot cancel it. Animation/audio use slow changes, not rapid flashes.
- Reloading during the sequence shows game over, because the marker overrides the prior safe player state. Restore safe explicitly rewinds to the existing checkpoint; the fatal crossing never replaces or deletes it.
- If the browser cannot persist the terminal marker, the crossing is blocked before the player passes the line, with a storage error and advice to turn back/export. This honest restriction prevents a silently safe reload when persistence is unavailable.

Only this boundary causes game over. It is far outside the islands, not an invisible current or random novice trap. Deliberately clearing browser storage or editing JSON remains under the browser owner's control; no anti-cheat claim is made.

## Saves and recovery

Three numbered slots with editable camp names. `emberwake.v1.<slot>.save`, `.backup`, and `.terminal` are the **only** localStorage keys used. Autosave is every 30 seconds of active game time inside radius 405; manual save is available in field notes. The prior valid primary becomes the backup before writing a replacement. Corrupt primary data never replaces a valid backup. Errors never report success or silently start a new world.

Schema v1 stores seed, compact per-chunk voxel index/value edits, placed objects, inventory/hotbar, crops, active regrowth timers, chest contents, boats, player/camp position and status, discoveries, five surface and five cave collectibles, crafting history, statistics, simulation time and settings. Unmodified chunks regenerate from the seed. There is no offline survival/crop simulation. JSON import/export supports user-managed device backup; import has a strict **2 MiB** size limit and rejects unknown keys, versions, IDs, invalid coordinates/counts, inconsistent objects and unbounded arrays. Saved strings are always rendered as text. No migration is needed for this first schema; unknown future/older versions fail explicitly.

**Load** respects a terminal marker. **Restore safe** explicitly clears it and loads the primary. **Previous backup** explicitly loads the prior valid checkpoint. **New voyage** replaces only the selected slot after confirmation and keeps its prior valid primary as backup. Browser clearing/eviction can lose everything: export for durable backup. Storage-denied browsers show a recoverable error in Saves; a new persistent voyage cannot start until storage works. No guest/unsaved mode is offered.

Bounds: 45,000 modified voxel cells, 12,000 tracked placed blocks, 512 planted beds, 16 chests, 8 vessels, 4,096 active resource timers. Expired regrowth timers are pruned. Quota exhaustion is surfaced with export/recovery guidance. Near-capacity saves can exceed a browser's total quota across three slots; the game cannot promise browser storage capacity.

## Rendering, assets and practical tradeoffs

Chunk columns are **16 × 16 × 80**, backed by byte arrays. Mesh generation culls internal faces, merges all voxel/furniture faces into one indexed mesh per column, and rebuilds affected neighbors after edits. It uses face culling rather than greedy quad meshing. There is no mesh-per-solid-cube design. Shaped objects contribute multiple boxes to the shared mesh. Crop instances and the small bounded vessel fleet are separate rendered objects.

View settings maintain 49/81/121 render columns, with a one-column data margin (maximum 169 cached columns at wide view). Generation/unloading is deterministic and does not discard edits. Up to two columns are rebuilt per frame; fog follows view distance and distant coarse island silhouettes keep navigation understandable. Very fast travel on slow GPUs can briefly reveal incomplete streaming. The terrain has no gravity, collapse, fluid simulation or block-light propagation. Sea level is fixed; window frames are open geometric frames, not refractive glass. Physics and visual geometry share full blocks and furniture silhouettes; selection deliberately uses cell bounds.

Original reproducible PNG texture atlas, 94 SVG inventory swatches/illustrations, SVG chart, procedural geometry and synthesized audio are included. Rebuild assets with `node games/emberwake-isles/scripts/generate-assets.cjs`. See [asset provenance](assets/GENERATED-ASSETS.md). The imagegen skill was inspected and its code-native-art guidance followed; **no AI-generated raster art or narration is claimed**. Three.js 0.185.1 is locally vendored, unmodified and MIT licensed. No new package dependency or shared lockfile edit.

A 20-minute gentle light cycle retains readable nights. Caves have exploration fill light; the nearest six crafted lamps add actual local lights. There are no costly real-time terrain shadows. Physics clamps catch-up steps to 50 ms and bounds spatial motion; severely slow rendering slows play rather than tunneling through terrain.

## Verification and development

```sh
node --test games/emberwake-isles/tests/model.test.cjs
node --test games/island-drive/tests/world.test.cjs games/sky-harbor/tests/world.test.cjs games/rocket-lander/tests/model.test.cjs
```

Optional developer-only Playwright, with the local server running:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROMIUM_PATH=/absolute/path/to/chrome \
node games/emberwake-isles/tests/browser-smoke.cjs
```

`ISLES_URL` can override the local test URL; the harness's local-origin check is intentionally for port 8770. Playwright/Chromium are test tools only, not runtime dependencies. The harness injects its instrumentation into served responses; production source exposes no mutable debug/test API. The normal-action controller is in `tests/progression.cjs`, absent from runtime imports. It starts empty and uses actual movement, aiming, mining, crafting, placement, sailing, fishing and gardening operations. Scenic fixtures are labeled separately.

See [validation evidence](docs/VALIDATION.md), [security contract](docs/SECURITY.md), and the committed screenshots/logs. Automated verification is not a prolonged human playtest. Chromium software-WebGL was tested; physical mobile, Firefox, Safari and hardware GPU frame rates are unverified. No full repository/database suite or main-app startup was run. Long-term human progression balance and very large player-built estates remain unmeasured.
