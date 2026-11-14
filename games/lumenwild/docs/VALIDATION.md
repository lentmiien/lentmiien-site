# Lumenwild validation

Validation uses repository-pinned Node **26.13.0**. The default shell resolves Node 24.22.1, so commands explicitly select the Volta-installed Node 26 executable. Current implementation date: 2026-11-15 JST.

## Focused checks

```sh
npm test -- tests/unit/lumenwildGame.test.js tests/unit/lumenwildExpansion.test.js tests/unit/lumenwildGuardians.test.js tests/unit/lumenwildUi.test.js --coverage=false
```

**Result: 4 suites passed, 91 tests passed, no skipped tests** (18.734 seconds). All 14 game, helper, unit-test, and browser-smoke JavaScript files also passed syntax parsing under Node 26.13.0. `git diff --check` passed.

The focused suites cover:

- Forty seeds across the original nine regions and twenty across the six new regions: 480 maps with connected objectives in both realms, unique placements, and bounded populations. New arenas contain no ordinary enemies.
- Ordinary one-on-one damage, sweep cooldowns without interrupting wind-ups, guarded counters, damage grace, and no offline catch-up.
- Timed-input playthroughs of the original chapters, the nine-region pilgrimage, both new chapters, and the fifteen-region homecoming. The playthrough pilot uses ordinary public inputs, readable maps, and warning footprints; it does not grant supplies, teleport, edit enemies, or bypass cooldowns.
- All three guardians at all three tiers, with no permanent upgrades. Isolated combat fixtures separately prove idle-player damage, committed patterns, realm-specific damage, safe ground, timed reflections, three-phase health gates, and landmark preparation.
- Failed-attempt and voluntary-retreat supply restoration, arena boundaries, immediate trial completion, gifts and rematch gates, and nonduplicating seal awards. Trials cannot advance surveys.
- Loom orientations and save restoration while standing on a changed shortcut; one-time trader purchases and rejection of invalid/insufficient-currency purchases; saved firefly carrying/delivery and one-time rescue rewards.
- Ninety memories and forty-five relics distributed without overlap, discovery preference, all chapter prerequisites, equipment choices, survey requirements, upgrade caps, and reward banking. Charm bonuses persist; removing the extra-focus charm falls back to a usable art without altering an ongoing expedition.
- Synthetic version-one and version-two checkpoints retain their original map digests and camp state. Version-three active boss patterns, landing targets, retry kits, cooldowns and future simulation restore deterministically.
- Rejection/bounding of corrupt save versions, paths, coordinates, guardian states, attack footprints, retry kits, identifiers, arrays, and numeric values. Saves never provide resource URLs or HTML.
- DOM checks run shipped scripts in jsdom: assets, atlas cards, journal, workshop upgrades/arts/charms, old saves, pauses, trader purchases, guardian introduction/HUD/retreat, banking, and renderer paths. The Canvas context is nonvisual and checks finite coordinates; this is not browser layout verification.

## Artwork and drawing review

The expansion adds **101 WebP files**; all **243 game WebP assets** exist, totalling 6,137,908 bytes (about 5.85 MiB). Generated sheets and packaged sprites were inspected. Imagegen editing removed unwanted background haze from the roc and landmark sheets. Creature, guardian and prop alpha was preserved during grid extraction and resizing. Prompts and file ranges are in [the artwork record](../assets/GUARDIAN-ASSETS.md).

A diagnostic Canvas-to-SVG adapter also exercised the shipped renderer with its actual art and drawing coordinates, and the resulting images were visually inspected for the Belfry, Roc, Dawn Hart, Warrens, and Velvet Labyrinth. This can reveal artwork/camera/footprint problems, but it is **not a native browser Canvas or CSS layout check**. It was used to improve the arena layout so touch controls and the guardian HUD have reserved space.

## Browser and full-suite limitations

This environment rejected a localhost static preview with `listen EPERM`. Chromium failed during launch with `sandbox_host_linux.cc: shutdown: Operation not permitted`; the connected browser tool also reported its access host unavailable. Therefore **the current browser smoke suite has not passed**, and desktop/mobile CSS layout, native Canvas appearance, audio and real touch ergonomics require a browser-capable environment.

The optional `tests/browser/lumenwild.smoke.cjs` was updated for the guardian expansion. It includes keyboard playthroughs of all three tier-II trials, synthetic camp fixtures for unlocked content, guardian screenshots, and touch/landscape guardian checks, alongside the previous storage, audio, keyboard, chapter and reduced-motion checks. It is syntax-checked, not claimed as executed successfully.

The full application suite was not rerun for this client-only change. The previous expansion's full-suite attempt was blocked by the same sandbox's localhost/private-fixture/process restrictions; that historical failed attempt is not a passing result for this release. No tests or coverage requirements were removed. No app.js, prestart, setup, database connection, package installation, deployment, or route mutation was needed.
