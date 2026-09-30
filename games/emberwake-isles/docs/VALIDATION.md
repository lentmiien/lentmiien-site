# Validation — Emberwake Isles

Verified 2026-10-01. Planned feature, entirely confined to this new module. No deployment, main-app startup, database access or production restart.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| New model/save suite | **71 passed** | [model-tests.txt](validation/model-tests.txt) |
| Actual Chromium/WebGL smoke | **28 passed** | [browser-results.json](validation/browser-results.json), [browser-log.txt](validation/browser-log.txt) |
| Missing dependency / lost WebGL context fault injection | **2 passed** | [load-failures.json](validation/load-failures.json) |
| Completed Island Drive, Sky Harbor, Rocket Lander models | **114 passed** | [previous-games.txt](validation/previous-games.txt) |
| Existing game Jest regressions | **87 passed in 13 suites** | [game-regressions.txt](validation/game-regressions.txt) |
| Reproducible generated art | **96 files byte-identical after regeneration** | Asset script: atlas, chart, 94 SVG icons |
| Vendored library | **All three hashes verified** | vendor/SHA256SUMS |

Tests cover deterministic relief, five large islands and islets, clear spawn, connected cave volume, physical walking in both directions across ten seeds, exposed ores, all 66 recipes' reachability/atomic outputs/gates, inventory caps, tool requirements, ray reach, placement body exclusion, shape/collision agreement, jumping, swimming, dry caves, vessels, shore blocking, survival, agriculture/watering, fishing, cooking, storage, duplicate-resistant camp scoring, one-time discoveries/caches, and full-pack reward behavior.

Save checks include a 12,000-block estate round trip and reconstruction, mined/built world round trips, crops, transport, discovery/settings, chunk unload/reload, slot isolation, backups, corrupt/oversized/unknown-schema data, unknown keys/IDs, bad coordinates/counts, orphan metadata, quota failure during either write, denied access, text-only rendering, terminal crossing while swimming and sailing, pause and reload during the disaster, explicit recovery and no offline simulation. Height validation includes legitimate jumps above the highest buildable cells.

## Normal-action evidence

The browser action controller began at the actual fresh empty-pack spawn, using seed 741092. It read the world to aim/navigate, then used ordinary game movement, mining, crafting, placement and interaction APIs. It did **not** grant inventory, move coordinates directly, inject terrain, unlock discoveries or override collisions. Its actions ran faster than wall time for reproducibility. This is an automated normal-action scenario, **not a claim of a prolonged human playtest**.

The route gathered the 16 starter driftwood logs and renewable berry/fiber/seed supplies; crafted planks, workbench and pick; physically walked the dry cave into its chamber and back while extracting stone/copper/coal; gathered shore clay; crafted kiln/copper/copper pick; placed lighting and a garden; crafted rope/raft/rod; launched from the real coast; sailed to Mossbell Reach, moored and walked ashore; reboarded and sailed home; caught a fish, harvested the matured garden, cooked and ate the catch. It includes ordinary camp return and portable workstation relocation. The final browser run simulated **302.2 seconds**, sailed **722.4 m**, mined **81 blocks**, placed **6 objects**, caught **1 fish**, and harvested **1 garden**. [Full action log](validation/browser-progression.json).

Additional real browser input checks obtained pointer lock, walked with W, jumped with Space, held the left mouse to mine, used the right mouse to place carried timber, clicked an actual crafting button, saved through the UI, reloaded and recovered that earned camp. Blur and pause clear input. The test-only module-response instrumentation is absent from shipped runtime code.

Later island/cave viewpoints, the furnished villa, long-distance streaming jumps and border starting positions are **explicit test fixtures**. The villa proves rendering, layout/scoring and edit survival during streaming; it was not earned through the normal progression scenario. The actual border crossing itself uses movement and the real terminal-journal path. Reloading during that sequence led to game over; explicit restore recovered the earned checkpoint.

## Visual inspection

Screenshots were opened and inspected, not merely written. Viewpoints wait for the correct chunk ring and dirty rebuilds. The following are committed:

- [Menu](validation/01-menu.png), [starter journal](validation/02-journal.png), [starter beach](validation/03-beach.png), [earned starter camp](validation/04-normal-camp.png).
- [Crafting](validation/05-crafting.png), [seeded map](validation/06-chart.png), [save UI](validation/07-saves.png), [small-window save UI](validation/16-small-window.png).
- [Tropical](validation/biome-tropic.png), [forest](validation/biome-forest.png), [arid](validation/biome-dunes.png), [highlands](validation/biome-frost.png), [volcanic](validation/biome-cinder.png).
- Five closer landmark views: [shell](validation/landmark-tropic.png), [post office](validation/landmark-forest.png), [teapot](validation/landmark-dunes.png), [bell](validation/landmark-frost.png), [moth](validation/landmark-cinder.png).
- [Dry cave interior](validation/08-cave.png), [seeded villa exterior](validation/09-luxury-exterior.png), [villa interior](validation/10-luxury-interior.png), [comfort score](validation/11-comfort.png).
- [Clear boat voyage view](validation/12-voyage.png), [warning waters](validation/13-boundary-warning.png), [storm](validation/14-storm.png), [game over](validation/15-game-over.png), [WebGL fallback](validation/17-webgl-fallback.png).

Validation found and corrected steep cave ramps, a two-block chamber exit lip, ocean buoyancy inside caves, awkward shoreline exits, fishing/boarding priority, short-jump input sampling, a sail obstructing the first-person view, premature game-over screenshot timing, and full-pack treasure/fishing reward behavior.

## Performance evidence and limits

Chromium with **SwiftShader software WebGL**, 1440×960 viewport, pixel ratio 1. No hardware-GPU claim. Balanced view settled at **81 rendered chunk columns** and **117–118 cached columns** in the recorded trips. The configured maximum is 121 rendered / 169 cached at wide view. Revisited edits survived unloading/reloading. Each column is a culled indexed mesh; furnishings are baked into it, crops instanced, fleet capped at eight.

The final combined near/far scene samples recorded **37.0–62.0 draw calls**, **41474.0–75312.0 triangles**, and **4.0–13.3 ms average CPU render-submission time**. Flat distant-water geometry was reduced: the earlier trace had roughly 176–206k triangles. Final **median frame intervals were 43.3–76.7 ms**, with p95 99.6–231.1 ms across trace windows. These rolling samples include fixture travel, mesh warmup and screenshot automation; they are not clean steady-state hardware benchmarks. CPU submission time is **not** FPS. Software WebGL did not maintain 60 fps, and very fast travel on slow devices may expose streaming briefly. The UI offers a lower view setting.

No physical mobile, Safari/Firefox, gamepad, touch movement, long human-session balance, near-limit 12,000-block camp benchmark or full repository/database suite is claimed. Furniture uses fixed authored orientations, cell-based selection and box silhouettes; windows are open frames. Sailing, light propagation, room scoring and fluids are deliberately simplified. The README documents these tradeoffs.

## Reproduction

Run the module's node:test suite and optional browser harness using the commands in the README. The 13-suite Jest command, with cache confined to this module, is recorded verbatim in game-regressions.txt. Browser tests used an existing local Playwright package and Chromium installation; no dependency was installed into the repository. The Browser skill was read and connection attempted, but no connected browser existed, so local Playwright/Chromium provided the actual browser QA. Imagegen guidance was inspected; reproducible code-native art was chosen. Git commit workflow applies only to this folder under the user's explicit scope.
