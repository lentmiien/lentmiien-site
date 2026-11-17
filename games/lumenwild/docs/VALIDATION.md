# Lumenwild validation

Validation uses repository-pinned Node **26.13.0**, selected explicitly because the default shell resolves Node 24.22.1. Implementation date: **2026-11-17 JST**.

## Focused checks

```sh
npm test -- tests/unit/lumenwildGame.test.js tests/unit/lumenwildExpansion.test.js tests/unit/lumenwildGuardians.test.js tests/unit/lumenwildSeasons.test.js tests/unit/lumenwildUi.test.js --coverage=false
```

**Result: 5 suites passed, 114 tests passed, no skipped tests** (33.467 seconds). After improving the landscape arena layout, the 12-test UI suite passed again (1.943 seconds). All 15 game, helper, unit-test and browser-smoke JavaScript files passed syntax parsing under Node 26.13.0. Changed text files, including untracked additions, were checked for whitespace problems.

Coverage includes:

- Connected objectives in both realms, unique entity placement and bounded enemy populations across the existing regions, plus **180 maps** across the six new regions (30 seeds each). The new arenas have no ordinary enemies, and vaults and wishbeds are reachable without solving optional shortcuts.
- Real-time one-on-one damage, committed ordinary attacks, guarded counters, damage grace and no offline catch-up.
- Timed-input completions of the original chapters and long expeditions, the previous guardian chapters, and all three new trails. The Hidden Seasons, The Unwritten Sky and The Long Tomorrow each complete at two seeds without camp upgrades. The pilot uses public movement/combat inputs, readable maps and warning footprints; it does not grant supplies, teleport or edit enemies.
- All six guardians at all three tiers. New combat fixtures prove first- and second-strike damage against an idle player, independent realm effects, safe ground, double-damage recovery, and deterministic future behavior across a mid-sequence save. Attacks, folding, bombs and arts do not interrupt committed patterns.
- Retry supplies, voluntary retreats, arena boundaries, rematch gates, new arts and charms, trial seals, and idempotent banking. Trials do not advance surveys; daily loadouts ignore camp equipment.
- Realm-specific key collection, saved keys and vault state, one-time vault rewards and persistent regional discovery. Wishbeds charge once, grow through movement, preserve progress, and yield one harvest. Waiting does not grow them.
- Ordered landmarks, shortcuts, restored transport, looms, firefly rescues, trader purchases and resource limits.
- **126 memories, 63 relics and 63 possible survey medals**, with the new collections discoverable over three visits without rare drops. Existing collection identifiers, chapter prerequisites and upgrade caps are retained.
- Synthetic version-one, version-two and version-three save compatibility. The version-three fixture includes an active Dawn Hart fight and digests for all fifteen old maps. Existing maps and old daily routes are unchanged.
- Rejection or bounding of corrupt save versions, paths, coordinates, arrays, guardian footprints and realms, strike numbers, retry kits, wishbed growth, vault/key inconsistencies, and old-generator routes into new regions. Saved fields cannot provide URLs or markup.
- DOM tests execute shipped scripts in jsdom: assets, atlas, journal, workshop, old saves, chapter unlocks, interactions, pauses, guardian introductions/HUD/retreat, banking and renderer paths. The Canvas mock checks finite coordinates; native appearance is reviewed separately below.

## Artwork and native rendering

The Unwritten Seasons adds **101 WebP files**, totalling **2,605,662 bytes**. All **344 game WebP assets** exist and total **8,743,570 bytes** (about 8.34 MiB). Generated sheets and the packaged assets were visually inspected, including a dark-background alpha contact sheet. Grid extraction and resizing preserve the generated transparency. The [artwork record](../assets/SEASONS-ASSETS.md) contains the complete built-in imagegen prompt set and shipped file ranges.

Native Chromium screenshots were reviewed for all six new region styles and all three new guardians. Supplemental visual fixtures load synthetic checkpoints to expose specific landmarks and warning patterns; these are drawing/layout checks, not additional playthroughs. They cover 1440 × 1000 desktop, 390 × 844 phone portrait, and 844 × 390 and 667 × 375 landscape layouts. The latter revealed an undersized arena, so short, wide screens now place the guardian banner beside the arena. All three new bosses were rechecked after the change, with no horizontal overflow and the action deck inside the viewport.

## Browser smoke test

```sh
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chrome node tests/browser/lumenwild.smoke.cjs
```

The smoke test uses a localhost-only static Express fixture, not the application server. It exercises keyboard and touch controls, audio activation, storage/reloading, reward banking, atlas/workshop navigation, the original three-region chapter, all six tier-II guardian trials, The Hidden Seasons, planting and harvesting a wishbed, collecting both realm keys, and opening a vault. Unlocked-content camp fixtures are synthetic; maze and combat playthroughs use real browser controls without editing in-flight health or supplies. It also checks reduced motion, blocked storage, phone layouts, browser exceptions and resource requests.

**Result: all 50 browser checks passed**, with no browser exceptions, failed asset requests or external runtime requests. The final run includes the corrected guardian-name expectation and the landscape layout improvement. Screenshots and `browser-results.json` are written to `/tmp/lumenwild-seasons-review`; the default output path is `/tmp/lumenwild-review` and can be overridden with `LUMENWILD_REVIEW_OUTPUT`.

## Scope

The full application Jest suite was not rerun for this client-only change. No tests or coverage requirements were removed. No app.js, prestart, setup, database connection, package installation, deployment or route change was needed. Browser review uses headless Chromium with emulated touch; physical-device ergonomics and other browser engines were not tested.
