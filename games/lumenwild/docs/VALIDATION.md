# Lumenwild expansion validation

Validation used repository-pinned Node **26.13.0** on 2026-11-14. The default shell resolved Node 24.22.1, so test commands explicitly selected the Volta-installed Node 26 executable.

## Current expansion checks

The focused command is:

```sh
npm test -- tests/unit/lumenwildGame.test.js tests/unit/lumenwildExpansion.test.js tests/unit/lumenwildUi.test.js --coverage=false
```

**60 tests passed across three suites.** The focused checks cover:

- Forty seeds across all nine regions (360 generated maps): objectives reachable in both realms, unique item placements, closed borders, phase passages, and bounded enemy populations.
- Deterministic maps, valid realm-aware routes, supplies, healing, run transitions, blessing uniqueness, and negative action tests.
- A lone beetle damages an idle player without a player move. Sweeps have a cooldown and do not cancel its wind-up; repeated sweeping still allows the enemy to hit.
- Dodging locked attack footprints, timed guard and counterattacks, deliberate art interruptions, and damage grace against simultaneous attacks.
- Bounded real-time steps, no offline catch-up, and frozen state outside active play.
- Ten complete original-chapter runs and complete Frontier, Horizon, and nine-region pilgrimage runs using ordinary timed model inputs. The pilot does not grant supplies, teleport, alter enemies, or bypass cooldowns.
- Preference for unknown memories and relics; all 54 pages and 27 relics appear across three fully explored visits per region without rare-drop grinding.
- Chapter gates and automatic selection of newly opened chapters, optional survey tiers, medal requirements, upgrade caps, unlock conditions, focus capacity, and banking exactly once.
- Root lanterns, gear and prism shortcuts, remote memory-lens discoveries, safe ferry travel, ordered star anchors, and caldera vents with Echo protection and cooling-heart shutdown.
- A synthetic checkpoint saved by the original implementation: old map reconstruction matches its original SHA-256 digest; original purchases, pages, inventory, defeated enemies, and position survive migration and a second version-2 round trip.
- Expanded save round trips, long-route progress, exact future simulation outcomes, and rejection or bounding of malformed plans, regions, shortcuts, positions, attack footprints, and numeric state.
- Daily route/loot/loadout independence from a player’s permanent collection, art, difficulty, and upgrades.
- Seven jsdom checks run the shipped browser scripts: atlas and collections, workshop purchases and equipped arts, migrated camp journeys, real-time damage, paused menus, early banking, and all nine render paths. Canvas is a nonvisual context that checks finite drawing coordinates; these checks do not verify browser layout or actual raster output.

All **142 WebP assets** exist (approximately **3.35 MiB**). The 89 new assets were mechanically extracted from built-in image-generation outputs. The generated sheets and a packaged terrain/creature/relic contact sheet were visually inspected. All new creature and prop sheets have genuine alpha transparency. `git diff --check` and JavaScript syntax checks pass.

## Environment limitations

A fresh browser visual check could not run in this session. The localhost static preview was rejected with `listen EPERM`; Chromium launch was blocked; the connected browser host was unavailable. The updated Playwright smoke test is syntax-checked but **has not passed for this expansion**. Desktop/mobile layout, real Canvas appearance, browser audio, and touch ergonomics still need a browser-capable environment. Prior release screenshots are not evidence for the new interface.

The full `npm test` command was attempted with its normal coverage and worker configuration. It was stopped after repeated unrelated fixture failures: localhost listeners rejected with `EPERM` (and consequent null `server.address()`/hook timeouts), unavailable private-image storage, and a blocked `spawnSync python3`. This is not a successful full-suite run. Tests or coverage requirements were not removed to hide these failures. The attempt log is `/tmp/lumenwild-expansion-jest.log`; the focused result is `/tmp/lumenwild-expansion-focused.log`.

No app.js/prestart/setup invocation, production database access, package change, deployment, or server-route change was required.

## Suggested browser check

Run the optional `tests/browser/lumenwild.smoke.cjs` command described in the README in an environment that permits a localhost fixture and Chromium. It now covers the timed-input pilot, paused combat clock, frontier unlock, world-atlas screenshots, new marsh start, and ten touch controls, in addition to the original storage, audio, keyboard, reduced-motion, and reload checks.
