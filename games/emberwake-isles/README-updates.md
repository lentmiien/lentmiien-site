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

Run `tests/browser-smoke.cjs` the same way for the complete original control/render/save/border scenario. `ISLES_URL` defaults to the local server above. Use synthetic fixtures, never a player's browser storage. Browser instrumentation is appended to responses by the tests, not shipped in the game. Existing evidence and its limitations are in `docs/VALIDATION.md` and `docs/OUTER-GARDENS.md`.

## Where to work

| Area | Files and responsibility |
| --- | --- |
| Content | `js/data.js` holds the frozen original catalog and merges append-only packs from `js/expansions.js`. Packs declare islands, blocks, items, recipes and restoration projects. |
| Terrain | `js/world.js`: seeded columns, ores, vegetation, connected caves, landmarks, chunk generation, edits, raycasts. Regional `surface`, `ore`, `plant` fields apply only to their new islands. |
| Gameplay | `js/game.js`: movement/collision, survival, atomic inventory/crafting, mining/building, farms/fishing/boats, comfort, restoration, terminal storm. |
| Encounters | `js/actors.js`: six weak Honeycomb mites, grounded movement/leash, melee line of sight, rewards and respawn. Actor count/IDs must agree with save validation. |
| Saves | `js/saves.js`: strict schemas, migrations, three slots, backup writes, import/export bounds, terminal markers. |
| Geometry/render | `js/mesher.js`: shared box shapes and culled chunk faces. `js/renderer.js`: local Three.js, streaming, sky/ocean, lights, actors. Shapes also drive collision. |
| Maps | `world.mapColumn()` derives edited surfaces without retaining extra chunks; `js/cartography.js` samples both charts. Keep surface land detection separate from water beneath ocean bridges. `boot.js` caches full chart by world/revision and refreshes local map. |
| UI | `index.html`, `css/game.css`, `js/boot.js`: menus, input/pointer lock, journal, recipes, maps, saves. `js/load.js` handles load errors; `audio.js` synthesizes sound. |
| Art | `scripts/generate-assets.cjs` regenerates local atlas, SVG icons and cover. `assets/GENERATED-ASSETS.md` records provenance. No runtime art service. |
| Tests | `tests/model.test.cjs` covers base systems; `expansion.test.cjs` covers migration/content/maps/encounters. `progression.cjs` + `expansion-progression.cjs` exercise earned progression from an empty pack. |

## Compatibility rules — read before adding content

- **Never renumber, reorder or reuse released voxel IDs or item keys.** Save edits contain numeric IDs. Original IDs are 0–62; Outer Gardens appends 63–84. A pack's `firstBlock` asserts its start. Append another pack rather than inserting into released arrays. Chunk storage is `Uint8Array`; deliberately upgrade storage before exceeding ID 255.
- **Never change existing seeded terrain formulas, island positions, cave paths, landmarks or natural block placement.** Unmodified terrain is regenerated, not stored. Existing players may have built anywhere in the old world, including ocean. New island footprints, noise margins, caves and props must lie outside all previously released territory. For a terrain redesign, add a versioned generator instead of silently changing old worlds.
- Current bounds are x/z **−1024…1023**, height 80, sea 12; warnings/buoys/fatal boundary are radii **850/920/980**. The original world was −512…511. A future expansion must protect the **current** territory too. Update constants, validation and navigation together; keep chunk/view/edit limits bounded.
- Current save schema is **2**. **Keep the `emberwake.v1.` storage-key prefix**: it is a stable namespace, not the payload schema. `decode()` validates v1 with its original bounds/catalog, then adds expedition defaults. v2 contains projects, defeat count and per-mite health/respawn deadlines. Future required fields need a new explicit migration and fixtures for every supported version.
- Loading does not rewrite the primary. The first successful newer save retains the exact prior valid primary as backup. A fatal-voyage marker always wins, including markers created before the boundary expanded. Never clear markers implicitly or silently reset invalid saves. Validate imports, coordinates, counts, IDs and unknown keys; render all saved strings as text.
- Play time advances only during play (or explicit rest); no offline growth, enemy respawn or starvation. Enemy health/cooldown persist; positions return to their home on load. Enemies cannot cause game over.
- `tests/fixtures/v1-save.json` is synthetic. `v1-terrain.json` contains **507 original chunk hashes, three full-map sampled column digests, and the original ID list**, captured before expansion. **Do not regenerate these to make a changed generator pass.** Add new golden fixtures before the next expansion.

For recipes, check resource acquisition, tool tier, station and discovery/project gates together; avoid cycles. New furnishing shapes need matching render/collision tests and a regenerated atlas. Recipe counts alone are not functionality: verify that outputs can be placed, used, eaten, equipped or contribute meaningful camp variety.

Finish with model tests, old-save migration/recovery tests, actual browser inputs, screenshots of changed scenes, a normal-action progression run, and a scoped diff review. `README.md` is the player/architecture overview; consult code for details rather than relying on prior conversations.
