# Start here for future updates

This folder is the entire **Emberwake Isles** game. It is a static, local-only voxel sandbox. Keep changes here; do not modify other games or the site's routes, manifests, index, or shared dependencies. Read the repository `AGENTS.md`, `documentation/security-framework.md`, and this folder's `docs/SECURITY.md` before implementation. No production restart or deployment is needed for development.

## Run and verify

From the repository root:

```sh
python3 -m http.server 8770 --bind 127.0.0.1 --directory games/emberwake-isles
node --test games/emberwake-isles/tests/*.test.cjs
node games/emberwake-isles/scripts/generate-assets.cjs
```

Open `http://127.0.0.1:8770/`. Site auto-discovery mounts this folder at **`/emberwake-isles/`**, not `/games/emberwake-isles/`. No build/install is required. Do not use `npm start` for testing: it has unrelated data-changing prestart work.

Browser tests require separately installed Playwright and Chromium; they are not game dependencies:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright CHROMIUM_PATH=/absolute/path/to/chrome \
EVIDENCE_DIR=games/emberwake-isles/docs/validation/your-update \
node games/emberwake-isles/tests/browser-expansion.cjs
```

Run `tests/browser-smoke.cjs` the same way for the complete original control/render/save/border scenario. `ISLES_URL` defaults to the local server above. Use synthetic fixtures, never a player's browser storage. Browser instrumentation is appended to responses by the tests, not shipped in the game. The latest screenshots and checks are in [floating island verification](docs/validation/sky/README.md). Earlier runs are in [Spectrum verification](docs/validation/spectrum/README.md), `docs/VALIDATION.md` and `docs/OUTER-GARDENS.md`.

## Where to work

| Area | Files and responsibility |
| --- | --- |
| Content | `js/data.js` holds the frozen original catalog and merges append-only packs from `js/expansions.js`, `js/spectrum.js` and `js/sky-isles.js`. Packs declare islands, blocks, items, recipes and restoration projects. |
| Terrain | `js/world.js`: seeded columns, ores, vegetation, connected caves, landmarks, chunk generation, edits, raycasts. Regional `surface`, `ore`, `plant` fields apply only to their new islands. |
| Floating terrain | `js/sky-isles.js` defines footprints, moorings, materials, vault clues and recipes. `js/sky-terrain.js` generates the suspended layer, mineral formations, rooms and passages. |
| Gameplay | `js/game.js`: movement/collision, survival, atomic inventory/crafting, mining/building, farms/fishing/boats, comfort, restoration, terminal storm. |
| Encounters | `js/actors.js`: five regional species with six actors per habitat, grounded movement/leash, melee line of sight, rewards and respawn. Actor count/IDs must agree with save validation. |
| Saves | `js/saves.js`: strict schemas, migrations, three slots, backup writes, import/export bounds, terminal markers. |
| Geometry/render | `js/mesher.js`: shared box shapes and culled chunk faces. `js/renderer.js`: local Three.js, streaming, sky/ocean, lights, actors. Shapes also drive collision. |
| Maps | `world.mapColumn()` derives edited surfaces without retaining extra chunks; `js/cartography.js` samples both charts. Keep surface land detection separate from water beneath ocean bridges. `boot.js` caches full chart by world/revision and refreshes local map. |
| UI | `index.html`, `css/game.css`, `js/boot.js`: menus, input/pointer lock, journal, recipes, maps, saves. `js/load.js` handles load errors; `audio.js` synthesizes sound. |
| Art | `scripts/generate-assets.cjs` regenerates local atlas, SVG icons and cover. `assets/GENERATED-ASSETS.md` records provenance. No runtime art service. |
| Tests | `tests/model.test.cjs` covers base systems; `expansion.test.cjs` covers migration/content/maps/encounters. `progression.cjs` + `expansion-progression.cjs` exercise earned progression from an empty pack. |

## Compatibility rules — read before adding content

- **Never renumber, reorder or reuse released voxel IDs or item keys.** Save edits contain numeric IDs. Original IDs are 0–62; Outer Gardens uses 63–84, Spectrum Shores 85–125, Tideglass 126, and the floating islands 127–151. The next free ID is 152. A pack's `firstBlock` asserts its start. Append another pack rather than inserting into released arrays. Chunk storage is `Uint8Array`; deliberately upgrade storage before exceeding ID 255.
- **Never change existing seeded terrain formulas, island positions, cave paths, landmarks or natural block placement.** Unmodified terrain is regenerated, not stored. Existing players may have built anywhere in the old world, including ocean. Grow sea-level terrain outside previously released territory. For additions within an existing map, use an explicitly versioned layer, preserve old structures and retain a reference-world fingerprint. The floating islands are the worked example.
- Current bounds are x/z **−1536…1535**, height 80, sea 12; warnings/buoys/fatal boundary are radii **1380/1450/1500**. The original square was −512…511 and Outer Gardens covered −1024…1023. A future expansion must protect the **current** territory too. Update constants, validation and navigation together; keep chunk/view/edit limits bounded.
- Current save schema is **4**. **Keep the `emberwake.v1.` storage-key prefix**: it is a stable namespace, not the payload schema. `decode()` validates v1 with its original bounds/catalog, then adds expedition defaults. v2 input is validated under its released catalog, map and pack bounds. V3 permits regional actor IDs and the larger world and backpack. V2 contains projects, defeat count and per-mite health/respawn deadlines. V4 adds the world-specific `sky` layout and claims after validating v3 under its frozen wayfinding catalog. Future required fields need a new explicit migration and fixtures for every supported version.
- Loading does not rewrite the primary. The first successful newer save retains the exact prior valid primary as backup. A fatal-voyage marker always wins, including markers created before the boundary expanded. Never clear markers implicitly or silently reset invalid saves. Validate imports, coordinates, counts, IDs and unknown keys; render all saved strings as text.
- Play time advances only during play (or explicit rest); no offline growth, enemy respawn or starvation. Enemy health/cooldown persist; positions return to their home on load. Enemies cannot cause game over.
- `tests/fixtures/v1-save.json` is synthetic. `v1-terrain.json` contains **507 original chunk hashes, three full-map sampled column digests, and the original ID list**, captured before expansion. **Do not regenerate these to make a changed generator pass.** The synthetic v2 voyage and 1,849-chunk v2 digest are also frozen in that directory. The v3 balcony fixture holds a high portal and 3,100 sculpture blocks. Its companion hash covers 338 released chunks around both sky sites. Keep the digest ordering in `tests/sky.test.cjs`. The matching v4 digest also freezes the authored strata, marker formations and rooms.

For recipes, check resource acquisition, tool tier, station and discovery/project gates together; avoid cycles. New furnishing shapes need matching render/collision tests and a regenerated atlas. Recipe counts alone are not functionality: verify that outputs can be placed, used, eaten, equipped or contribute meaningful camp variety.

Finish with model tests, old-save migration/recovery tests, actual browser inputs, screenshots of changed scenes, a normal-action progression run, and a scoped diff review. `README.md` is the player/architecture overview; consult code for details rather than relying on prior conversations.

Spectrum terrain uses five shaded block IDs per island in the upper twelve metres. The island species record drives its silhouette, colors, pursuit speed and pigment drop. Run `tests/browser-spectrum.cjs` with the Playwright settings above to load a v2 voyage, earn and sail a raft to a quarry, reload a crafted brick, and render the islands and rainbow fixture. Its evidence goes into `docs/validation/spectrum/`.

Tideglass portals append voxel ID 126 in the wayfinding catalog in `js/data.js`. Their locations come directly from saved placed blocks. Schema 3 needs no additional fields. `game.js` handles entry and collision-checked travel, and `boot.js` adds map picking and a paged coordinate list to the chart. The entry latch is transient so arrival, cancellation and loading on a pad allow the player to step away.

Run `tests/browser-portals.cjs` with the Playwright settings above to exercise real pad entry, distant map picking, stacked exits and a saved arrival. Set `PORTAL_SCREENSHOT` to capture the open chart. The fixture supplies the test pier and installed pads. Crafting, placement, mining and blocked arrivals are covered in `tests/portals.test.cjs`.

## Extending the airborne layer

`EWWorld.column(x,z,seed)` describes original terrain. `world.sky.profile(x,z)` describes a suspended column. Use `world.islandAt(x,y,z)` for the player's current island, `world.waterAt()` for water under overhangs and `world.mapColumn()` for the chart. During generation, the sea layer is written first, sky second and saved edits last. The renderer uses the same airborne voxels for the distant mesh, including holes and edits.

Keep the two released entries in `sky.sites` and the numbered `sky.moorings` stable. A v3 migration selects one berth per island, preferring clear space around high edits, the player and camp. If all nine berths intersect old construction, the chosen site reserves compact 4 m clearance cells only around affected coordinates. Each cell stores a 14-bit vertical mask for y=24…79. These are bounded save data. A fresh voyage uses berth zero at both sites. New vault IDs must be unique and permanent because saves record claims by ID. When appending a site, migrate the historical two-entry berth array explicitly before validating the new length.

Run `tests/sky.test.cjs` for the old-sector digest, migration, both ascents, vault access, chart edits and recipes. Run `tests/browser-sky.cjs` with the browser settings above to exercise actual mining, treasure discovery, crafting, placement and reload. Its default evidence directory is `docs/validation/sky/`. Sky art comes from the local asset generator and the mesher’s shared shape table.
