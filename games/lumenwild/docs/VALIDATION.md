# Lumenwild validation

The Returning Light was implemented and reviewed on **2026-11-18 JST**, using repository-pinned **Node 26.13.0**. The default shell resolves Node 24.22.1, so validation explicitly selects the pinned binary.

## Focused checks

```sh
npm test -- tests/unit/lumenwildGame.test.js tests/unit/lumenwildExpansion.test.js tests/unit/lumenwildGuardians.test.js tests/unit/lumenwildSeasons.test.js tests/unit/lumenwildFinale.test.js tests/unit/lumenwildUi.test.js --coverage=false
```

**Result: six suites passed, 144 tests passed, no skipped tests** (35.840 seconds). All 17 game, helper, unit-test and browser-review JavaScript files parse under Node 26.13.0. Changed text files were checked for whitespace errors.

The suite retains the previous exploration, ordinary combat, progression, guardian, DOM and migration checks. Finale coverage adds:

- Both new layouts across **40 seeds each**, with objectives and optional discoveries reachable in both worlds, no overlapping entities, bounded populations and an arena separated from ordinary enemies.
- Final chapter prerequisites, its two-region surveys, preference over the optional marathon after a new Unwritten Sky completion, and twelve pages/six relics discoverable over three visits.
- Realm-specific beacons and ordered heart blossoms opening persistent shortcuts.
- The full final chapter at two seeds with starter equipment, and the First Keeper at all three trial tiers, using ordinary timed model inputs.
- Exact membership of every required collection group. A single missing memory, relic, art or charm prevents both hidden launch and resume; duplicate IDs cannot satisfy a missing item. Medals, upgrades, vaults, currency and the hidden reward are excluded from the gate.
- Hidden entry rejected through ordinary trial, survey and daily routes. Fixed difficulty, retained equipment and camp upgrades, two-tonic/two-bomb kit, and restored supplies after failure.
- Committed three- and four-strike sequences, actual idle damage, safe ground in every phase/pattern, independent realm previews, armor outside recovery, and increased final-phase damage. Opening-only damage and shorter timings make the hidden encounter substantially harder than normal radiant trials.
- Standing and attacking fails the secret; a properly equipped pilot wins all four phases using ordinary inputs. The pilot reads the map and warnings, moves, attacks, guards and uses equipped supplies; it never changes in-flight health, position, inventory, cooldowns or enemies. It is a feasibility check, not a measure of human difficulty.
- First light's damage/mobility effect and the home lantern's recovery-only sweep reach.
- Hidden victory title, clear count, best time/hit records and once-only banking. Hidden arenas do not advance regional surveys or add normal trial seals.
- Deterministic continuation from every beat of a saved multi-strike sequence, bounded queues, rejected corrupt coordinates/realms/counts/phases/difficulty/kits, and the 180,000-character save limit.
- Synthetic **version-four** fixture with an active Night Gardener encounter and fingerprints for all **21 previous maps**. Older v1/v2/v3 fixtures and daily routes still pass; all v4 maps and its daily route remain unchanged.
- DOM execution of shipped scripts covers the collection checklist, missing-region filter, visit shortcuts, illustrated ending/replay without duplicate rewards, hidden reveal/introduction/HUD, fourth-strike preview, mastery result and persistent title.

## Artwork and native rendering

The finale adds **45 WebP files**, totaling **1,544,830 bytes**. The complete runtime asset directory contains **389 WebP files**, totaling **10,288,400 bytes** (about 9.81 MiB). This excludes documentation screenshots. All prior assets remain intact.

Built-in imagegen created terrain, props, two creature sheets, both four-pose boss sheets and the ending illustration. Two sheets needed transparency corrections through the same image editor. Mechanical grid extraction, resizing and WebP encoding used Sharp. A contact sheet composited over the dark game background was inspected to catch opaque backgrounds, clipped poses and mismatched materials. See [the complete prompt and asset record](../assets/FINALE-ASSETS.md).

Native Chromium screenshots cover both final regions, the First Keeper, the Hollow Star's numbered warnings and openings, the ending, collection tracking and the mastery result. Layout review uses 1440 × 1000 desktop, 390 × 844 portrait and 844 × 390 landscape. The arena, current/next warnings, HUD and controls remain visible. The short landscape health meter uses smaller hearts so a fully upgraded keeper's health fits on one line.

## Browser review

```sh
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chrome node tests/browser/lumenwild.finale.cjs
```

The script starts a localhost-only static Express fixture, never app.js, prestart, setup, database services or schedulers. Disposable synthetic camps unlock the relevant content. The final chapter and hidden encounter then run through actual keyboard input and shipped dialogs without editing in-flight game state. Screenshots and `results.json` are written to `/tmp/lumenwild-finale-review`; `LUMENWILD_REVIEW_OUTPUT` overrides it. `LUMENWILD_REVIEW_PART=hidden` limits a diagnostic run to the hidden encounter.

Checks cover fresh/complete/incomplete collections, both final gardens and the First Keeper, ending banking and replay, the missing-only journal, equipment and supplies, a saved second-strike reload, portrait/landscape rendering, paused timers, four-phase victory, mastery records, title persistence, replay entry, runtime exceptions and failed asset requests. Reload comparison uses deep equality of game state: serialized property order is not meaningful.

**Final result: all 25 browser checks passed**, with no runtime exceptions or failed asset requests. Both the final chapter and the four-phase Hollow Star encounter completed through real keyboard controls. The hidden encounter also resumed unchanged after saving on its second strike. Screenshots include the final landscape health-meter adjustment.

The previous broader browser smoke remains available as `tests/browser/lumenwild.smoke.cjs`. Its recorded 50-check run from the Unwritten Seasons expansion covered original chapters, the previous six bosses, touch controls, audio, storage failures, reduced motion, optional vaults and wishbeds. That longer browser script was not rerun for this finale; its model and DOM regressions are included in the six suites above.

## Scope

The full application Jest suite was not rerun for this client-only change. No tests or coverage requirements were removed. No app startup, package installation, deployment, account operation, database connection, environment configuration or route change was required. Native review uses headless Chromium and emulated viewports; physical-device ergonomics and other browser engines were not tested.
