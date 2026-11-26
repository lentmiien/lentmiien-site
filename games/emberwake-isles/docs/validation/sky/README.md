# Floating island verification

The reference voyage uses seed **741092**. Its original ocean is 3,072 × 3,072 m with the fatal storm at radius 1,500 m. Both islands and their alternate moorings fit within the existing archipelago.

| Island | Natural footprint | Lowest underside | Deck elevation | Blocks used for test ascent |
| --- | --- | --- | --- | --- |
| Kestrel Wing | 133 × 79 m | y=34 | y=46–55 | 48 |
| Vesper Lyre | 118 × 97 m | y=39 | y=51–59 | 50 |

Sea level is y=12. The height ranges describe the natural terrain before spires, vault markings or construction. Stair and tower costs depend on the starting point and design.

## Play and compatibility checks

- The Chromium run loaded a synthetic v3 save through the ordinary Load button. Its iris-stone balcony, portal, player and 3,100 carried sculpture blocks survived. Kestrel moved to **708, −804**. The original primary stayed byte-identical on disk until another save.
- In a second slot the ascent fixture supplied a raft, a pick and building stone beside each site. The controller sailed 14 m, moored, dived and built from the seabed using ordinary movement, jumping, ray targeting and placement. Both towers and discoveries survived a reload.
- The browser staged the player on a marked outcrop carrying a torch and workbench. Pointer-locked mining opened a real vault shaft. The player fell through, claimed the treasure with **E**, mined two mica blocks at a nearby staged outcrop, placed the bench, crafted two sail lamps through the recipe book and placed one. After saving through the UI and reloading, the found mantle, claim, placed lamp and spare lamp were all present.
- The model suite entered each of the four intact vaults, tested full-backpack refusal and confirmed that a reload cannot pay a reward twice. It mined and rebuilt all ten natural materials, exercised all eleven recipes, checked the mantle’s descent and landing, the sunwheel’s bearing, the carillon interaction, lamp data, edit-aware charts, ocean travel and peaceful landings.
- Frozen v3 and v4 hashes cover 338 chunks around the two sites. The v3 baseline comes from commit `b07540e` and checks the complete historical voxel layer, including its seabed. A crowded-sector fixture exercises the smaller protected volumes when all candidate moorings already have old construction.
- The previous gameplay checks include progression from the empty starter pack. The sky ascent supplies and the scenic cameras are explicit test fixtures. This was an automated desktop Chromium/SwiftShader run. Hardware GPU frame rates, mobile controls and extended human play balance were outside this run.

The final run passed **128 Emberwake model/save tests**, **114 standalone regression tests** for Island Drive, Sky Harbor and Rocket Lander, and **135 tests across 15 site game/listing Jest suites**. Five Chromium scenarios passed, covering the base game, Outer Gardens, Spectrum Shores, portals and floating islands. The base scenario exercised 28 checks, including the mid-storm reload and WebGL fallback. The full application/database suite was outside this standalone update.

## Browser views

| Island | Approach from sea level | View of the whole island | Player-height view |
| --- | --- | --- | --- |
| Kestrel Wing | [Underside and tower](kestrel-approach.png) | [Swept wingtips](kestrel-summit.png) | [Quill sails](kestrel-deck.png) |
| Vesper Lyre | [Open water through the lyre](vesper-approach.png) | [Forks and sky window](vesper-summit.png) | [Basalt pipes](vesper-deck.png) |

The chart records the two discoveries. The vault image reveals one treasure. [World chart](chart.png) · [Courier vault](courier-vault.png)

The six scenic views use staged cameras after streaming the area at the balanced setting. The overhead views are elevated for inspection. The vertical pillars at the edges are the two towers built during the ascent. Each measurement includes draw calls, triangle count, 81 normal terrain meshes, simulation cache size and a separate airborne mesh/cache count. These views used 25–89 draw calls, about 104,000–146,000 triangles and 59–70 cached airborne tiles. Median frame intervals on the software renderer were 37–41 ms. Frame intervals use the most recent 180 frames and may include travel and streaming. [Raw measurements and restored inventory](results.json)

## Reproduce

Run the static server and model command from the repository root.

```sh
python3 -m http.server 8770 --bind 127.0.0.1 --directory games/emberwake-isles
node --test games/emberwake-isles/tests/*.test.cjs
```

Run the browser check in a second shell with local Playwright and Chromium.

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROMIUM_PATH=/absolute/path/to/chrome \
node games/emberwake-isles/tests/browser-sky.cjs
```

Use `EVIDENCE_DIR` to choose a different screenshot directory. The harness creates fresh browser storage. Its private camera controls are injected into the served test page.
