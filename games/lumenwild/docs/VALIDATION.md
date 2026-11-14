# Lumenwild validation

Verified locally on 2026-11-14 with the repository-pinned Node **26.13.0**. The shell initially resolved Node 24; verification explicitly used the Volta-installed pinned executable. Browser checks used headless Chromium through an existing Playwright installation, without adding a dependency.

## Simulation and save tests

`npm test -- tests/unit/lumenwildGame.test.js --coverage=false`

**28 tests passed.** Coverage includes:

- 120 seeds in every biome (360 gardens): unique placements, required-objective reachability in both realms, closed map borders, bounded creature populations, and deterministic generation.
- Realm-aware route planning with legal moves and explicit safe shift steps.
- Rejected invalid inputs, wall bumps, unsafe shifts, unearned exits, incorrect blessing choices, and empty consumables.
- Realm-specific seeds, collection exactly once, healing limits, dash cooldowns, and wall-blocked attacks.
- Visible enemy wind-up, dodgeable attacks, interruption, defeat rewards, and protection from multiple hits in one turn.
- Optional rune success, recovery from a wrong note, proximity checks, and single rewards.
- Ten complete three-region expeditions using ordinary simulation inputs, without teleporting, granting supplies, or bypassing enemies.
- Exact save round trips, resumable blessing choices, invalid/oversized/incompatible saves, unsafe state, profile allowlists, and camp purchase bounds.
- A living creature occupying a defeated creature’s old position remains resumable; overlapping living creatures are rejected.
- Daily runs ignore camp bonuses and gentle mode.

An additional continuous save check completed seed 501 with **443 successful state reconstructions**, restoring after every action and garden transition, including 14 defeated creatures. The final state was a normal victory.

## Browser checks

`tests/browser/lumenwild.smoke.cjs` passed **26 checks** against a dedicated static Express fixture. It did not start app.js, run prestart/setup, connect to a database, or launch background services.

- All 52 runtime sprite/terrain images loaded, with no failed requests or browser exceptions. The title illustration and UI images also loaded. All requests stayed on the local origin.
- Real audio context resumed after a user gesture.
- Desktop keyboard input, collection, world folding, distinct canvas output, guiding thread consumption, atlas pausing, focus handling, and autosave/Continue worked.
- Ability input immediately after a held movement step was accepted; walking repeat cannot silently discard a sweep, tonic, or other ability.
- A complete expedition through all three gardens used **actual keyboard input at the shipped input cadence**, including combats, realm changes, both blessing choices, and the ending.
- Victory banked rewards once, cleared the checkpoint, survived reload, and funded a persistent camp upgrade. A subsequent daily run correctly ignored that upgrade.
- 1440×1000 desktop and 390×844 phone layouts had no horizontal overflow. All eight touch abilities fitted the phone viewport. Actual touch events moved the fox and shifted realms.
- 844×390 phone landscape retained the stage and controls. Focus loss paused play. Reduced motion and blocked localStorage still allowed play, with a visible storage warning.

Ten additional browser checks used explicit scenario fixtures for the optional shrine and defeat:

- Bloom exposed the first two rune notes; Echo exposed the third. Reopening the clue kept focus in its modal.
- A wrong note reset the song safely. The correct song granted visible rewards exactly once and persisted its completion.
- Defeat banked earned starlight and cleared the checkpoint.
- Cancelling reset retained progress; confirming reset cleared only the game's namespaced storage entry.
- No browser exceptions occurred in these flows.

Browser screenshots and detailed run results were written to `/tmp/lumenwild-review`. Selected compressed screenshots are retained below for review.

## Visual review

Inspected the title screen, in-game rendering in all three regions, both realm palettes, desktop controls, phone portrait and landscape, atlas, blessing choices, rune puzzle, victory, and defeat. The generated sheets were checked before packaging. All public assets are local WebP files with preserved sprite transparency.

- [Camp and title screen](screenshots/camp.webp)
- [Garden exploration](screenshots/garden.webp)
- [Phone controls](screenshots/mobile.webp)
- [Rune shrine](screenshots/rune-shrine.webp)
- [The ending](screenshots/ending.webp)

## Scope and practical limits

Progress is browser-local and does not sync across devices. There is no online leaderboard. The full app's startup/database lifecycle was deliberately not exercised; integration uses the existing directory-based static game mount, with no server changes. Chromium was verified; Safari and Firefox were not available for this run. Mobile checks used Chromium touch emulation rather than physical devices.

The existing repository-wide suite includes fixture-gated skipped checks; no Lumenwild tests are skipped. See the repository suite result recorded below.

## Repository-wide suite

`npm test` passed with the configured two-worker pool and full coverage enabled:

```text
Test Suites: 17 skipped, 477 passed, 477 of 494 total
Tests:       269 skipped, 7146 passed, 7415 total
Snapshots:   0 total
Time:        142.504 s
```

All configured coverage thresholds passed. The 17 skipped suites / 269 skipped tests remain governed by the repository's existing configuration and disposable integration-fixture requirements; they were not enabled or altered for this standalone game. The final focused run also verifies that a later blessing offer cannot repeat an already-owned blessing.
