# Outer Gardens update — 2026-10-15

The existing game expands in place. All changed files are inside `games/emberwake-isles/`. No server, route, manifest, shared dependency, other game, deployment or production restart is involved. For future implementation work, start with [README-updates.md](../README-updates.md).

## Delivered content

- World grows from 1,024² to **2,048² × 80 voxels**. Original five major islands, four islets, all original terrain formulas and numeric voxel IDs are unchanged. Two large islands sit entirely beyond the former map square: **Reedglass Haven** (−665,−100; bamboo/limestone/jade) and **Honeycomb Isle** (660,220; ochre/amber). Each has a connected, mineable three-path cave network and a surface landmark. Seven islands now provide seven cave caches and seven stories.
- **22 added voxel types, 31 added item definitions, 22 added recipes**: totals **84 non-air blocks, 125 items, 88 recipes, 41 furnishing/station designs**. New construction includes bamboo boards/screens/stairs, pale and ochre brick, jade mosaics/slabs and amber lattice. Nine new furnishings include working lights, a restorative soaking pool, tea table, renewable nursery, wind organ and fossil display.
- **Two two-stage restoration projects** consume supplies, record progress and unlock the wind organ/apiary sculpture blueprints. Completed landmarks provide rest and warmth. Bamboo nurseries take 90 seconds to grow, yield stems and edible shoots, and support two new cooked foods. Replacing a nursery restarts growth, preventing instant harvest duplication.
- **Six pebble mites**, only on Honeycomb. Three barehanded hits or one owned staff/sabre hit defeat one. Melee reach is 3.2 m, walls block hits, contact damage is 2 per two seconds and health cannot drop below 25. Dry-land checks and a 13 m home leash prevent pursuit off-island. Defeats yield amber/fossils and count toward restoration. Health and five-minute respawn deadlines persist; runtime positions return home on load.
- **Edit-aware full chart and new live local mini-map**: removed land becomes sea; placed blocks form new land. Full-chart pixels cover 4 m and include off-grid edits; local pixels represent individual columns across 128 m. Local refresh is capped at 750 ms. Terrain surface queries batch edited columns per chunk and release temporary chunks. Nearby water also updates; distant terrain remains coarse.

## Compatibility and saves

The storage namespace remains `emberwake.v1.<slot>.*`; only the payload schema advances to **2**. V1 input is strictly validated against its original coordinates, items, voxel IDs and discovery IDs before migration. Migration preserves the seed, all terrain edits/builds, inventory/hotbar, stations, crops/timers, chest contents, boats, player/camp, discoveries, collectibles, crafting, stats, time and settings, adding only expedition defaults and the schema number.

Loading never rewrites the primary. The first successful updated save keeps the exact prior valid primary in the backup; subsequent writes advance that rolling backup normally. Export JSON for a permanent rollback copy. V2 saves cannot be opened by the old application. No personal saves were read: the committed v1 fixture is synthetic.

The warning, buoy and fatal radii move to **850 / 920 / 980 m**. Old terminal markers remain terminal; expansion never revives a failed voyage. Crossing the new boundary still journals terminal intent before movement, ends in a six-second storm even through pause/reload, and preserves the safe checkpoint. Explicit recovery remains available. No offline simulation is added.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Game models, saves and expansion | **99 passed** | [model-tests.txt](validation/outer-gardens/model-tests.txt) |
| Original terrain compatibility | **507 chunk byte fingerprints + 3 full-old-map sampled height/biome fingerprints unchanged** | [frozen v1 baseline](../tests/fixtures/v1-terrain.json), expansion tests |
| Full Chromium/WebGL control/render/save/storm suite | **28 passed** | [browser-results.json](validation/outer-gardens/browser-results.json) |
| Expansion browser migration, progression, combat, charts and furnishings | **12 passed** | [expansion-browser-results.json](validation/outer-gardens/expansion-browser-results.json) |
| Missing module and lost WebGL context | **2 passed** | [load-failures.json](validation/outer-gardens/load-failures.json) |
| Island Drive / Sky Harbor / Rocket Lander models | **114 passed** | [previous-games.txt](validation/outer-gardens/previous-games.txt) |
| Existing game Jest regressions | **87 passed in 13 suites** | [game-regressions.txt](validation/outer-gardens/game-regressions.txt) |
| Original local generated art | **127 assets byte-identical on regeneration** | [assets.txt](validation/outer-gardens/assets.txt) |

Model checks include cave walking both ways over ten seeds, reachable recipe/project graphs, all 88 recipes' atomic outputs, tools/reach/collision, new ore availability, nursery and cooking behavior, enemy range/occlusion/nonlethality/leash, persistent cooldowns, paused/disaster states, malformed expansion records, old-save migration, exact backups, quota failures, old terminal markers, expanded coordinates, map invalidation and chunk memory.

The normal-action browser scenario starts with an empty pack and uses the real movement, mining, crafting, placement, sailing and interaction methods. It earns copper tools and a raft, visits Mossbell, fishes/farms/cooks, then sails past the old boundary to Reedglass, gathers bamboo, crafts a staff/boards/screen/nursery, waits for and harvests shoots, walks the cave and mines jade, completes the first restoration stage, saves, and reloads that progress. **786.7 seconds simulated, 1,257.9 m sailed, 136 blocks mined, 9 objects placed, 2 harvests**. [Action log and earned state summary](validation/outer-gardens/expansion-progression.json).

No inventory, unlocks, terrain or player positions are injected in that progression controller. Its timing is accelerated for repeatability; this is not a prolonged human playtest. Scenic views, combat starting positions, and the showcase terrace are separately labeled fixtures. The combat fixture uses actual pointer lock and held mouse input, with the test controller tracking the approaching target. The ordinary full browser suite also checks actual walking/jumping/mining/placement/crafting/save inputs. Runtime code exposes no mutable test hooks.

## Visual and performance review

Screenshots were opened and inspected. Key expansion views:

- [Migrated journal](validation/outer-gardens/expansion-migrated-journal.png), [seven-island chart](validation/outer-gardens/expansion-chart.png), [recipes](validation/outer-gardens/expansion-recipes.png), [save UI](validation/outer-gardens/expansion-save-ui.png).
- [Reedglass](validation/outer-gardens/expansion-reedglass.png), [jade cave](validation/outer-gardens/expansion-jade-cave.png), [Honeycomb](validation/outer-gardens/expansion-honeycomb.png), [amber cave](validation/outer-gardens/expansion-amber-cave.png), [mite encounter](validation/outer-gardens/expansion-mite.png).
- [Nine new furnishing designs](validation/outer-gardens/expansion-furnishings.png), [built island on full chart](validation/outer-gardens/expansion-built-island-chart.png), [local map before removal](validation/outer-gardens/expansion-built-island-local-map.png), [local map after removal](validation/outer-gardens/expansion-removed-island-local-map.png).
- The full-suite evidence also includes the original beach/biomes, cave, villa, voyage, warnings, storm, game over, narrow panels and fallback.

Settled new-island/cave samples at standard view: **81 render chunks, 117–119 cached columns, empty rebuild queues, 41–69 draw calls, 69,218–96,374 triangles**. Render-call CPU timing averages **1.4–1.6 ms**, while actual median frame intervals under **Chromium SwiftShader software rendering** are **42.6–57.6 ms**. These are software-renderer observations, not a hardware-GPU performance promise. Detailed edited-water geometry is restricted to a 112 m vicinity; map queries do not increase retained world chunks.

The first concurrent browser run encountered a screenshot-capture tool failure; the final isolated full run passed. Review also corrected stale scenic readiness checks, minimap sizing, the nursery relocation shortcut, water beneath ocean platforms, and replacement-save handling of non-quota backup errors. No known test failures remain.

## Practical limits

The expansion deliberately reuses the connected cave layout generator and existing furniture shapes where suitable. Combat is a small forgiving encounter system, not a combat campaign or pathfinding simulation. The chart is an overhead surface map, not an underground cave map; the full chart is downsampled and the mini-map is hidden on narrow displays. Distant silhouettes/water are approximate; there is no fluid simulation or terrain collapse. Browser storage can be cleared or exhaust quota; export remains the durable backup option. Existing edit, pack, boat and view-distance bounds remain. Mobile/gamepad, other browsers, hardware GPU timing and long-term human balance are unverified. No full database/server suite was run.

Art remains original, deterministic Node/zlib PNG, SVG and procedural geometry. The imagegen workflow was inspected; its code-native-art guidance applied. No AI raster generation, external save service, narration or new runtime dependency was used. Session/turn URLs were not exposed in this environment and are not fabricated.
