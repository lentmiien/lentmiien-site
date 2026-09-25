# Amber Isle · Island Drive

A complete, fully local, endless low-poly driving game. Follow the coast, explore the harbour town, climb through Pine Valley, and find the highland lookout. No race, damage, fuel, traffic, timer limit or backend. **Entering the sea is the only game-over condition.**

## Launch

From the repository root:

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory games/island-drive
```

Open **http://127.0.0.1:8765/**. Serve over HTTP; module imports are not supported by a `file://` launch. No build or package install is needed to play.

The existing site's `serveGames()` automatically mounts game folders at `/<folder>/`, so the normal site URL after an authorized deployment/start is **`/island-drive/`**, not `/games/island-drive/`. No route, games index or shared manifest was changed. An already-running production process will not acquire the new static mount until its normal next startup. This implementation does **not** deploy or restart it. Alternatively, any static host can publish this folder at any path; all resources are relative.

## The island

- Roughly 2 km across, on a 2.6 km terrain mesh, with approximately **10.87 km of connected roads** and a summit over **125 m**.
- **67 town buildings**, 12 grid crossroads, **506 trees**, **65 rocks**, **42 street lamps**, a lighthouse, lookout, upland farm, chapel and beach café; **685 solid placed objects** in total.
- Fifteen road routes: a closed coastal circuit, a dense harbour street grid, and connected longer forest, ridge, summit and descent routes. No unconnected road endings.
- Four active gold exploration markers, randomly selected from 67 clear, dry road-centre sites. Collected markers move at least 220 m away from the car and remain separated from other markers. Collection has **no score, speed, grip or resource benefit**.
- Full island map, minimap, car heading, landmark names, and a bearing/distance to the nearest marker. Bearings are direct; use the road map to plan the route.

## Cars and driving

| Car | Character | Road top speed | Off-road cap |
| --- | --- | --- | --- |
| Pebble | Forgiving hatchback; strongest grip and lowest pace | 79 km/h | 36 km/h |
| Meridian | Balanced tourer; more inertia and moderate grip | 133 km/h | 47 km/h |
| Comet | Fast coupe; brake early, with pronounced corner understeer | 205 km/h | 58 km/h |

Use **WASD / arrow keys**, **Space** to brake, **P / Escape** to pause, **M** for the map, and **C** to change chase-camera distance. Holding reverse first brakes, then backs up. Touch devices have simultaneous steering/pedal controls; landscape gives more road visibility. Losing window focus or hiding the page pauses driving and clears held input.

Quality is `clamp(on-road distance percentage − 5 × collisions, 0, 100)`. The HUD starts at 100 until distance is travelled; idling earns nothing. Sustained contact counts once, with re-contact counted only after separation. Collisions slow/deflect the car but never end play. Statistics include time, distance, road percentage, quality, collisions, discoveries and maximum speed. Restart clears the entire session. State is intentionally not persisted.

## Geometry and implementation

- `js/world.js`: seeded placement, authored roads, shared terrain and checkpoint candidates. Exclusion tests use the union of **all** road segments with round endpoint/intersection clearance. Every solid reserves a bounding circle that includes roofs, canopies and lamp arms, plus at least four metres beyond road edges. Objects also reserve two metres between footprints.
- Terrain roadbeds flatten cross-sections, blend junction heights, and smoothly transition through cut/fill shoulders. Roads are baked into the terrain texture at exactly the same world coordinates: no separate surface can float, overlap at junctions, or allow terrain to poke through. Driving elevation uses the rendered mesh's exact triangle interpolation.
- `js/simulation.js`: 120 Hz fixed steps, bounded timing/input, speed-dependent steering, lateral grip/inertia, slope resistance, reverse/brake behavior and swept-circle obstacle collision. The car uses a conservative 2.9 m bounding circle. A slow frame accepts at most 100 ms of simulation to avoid runaway catch-up; returning from pause never advances hidden time.
- `js/renderer.mjs`: local Three.js, batched instanced objects, original car meshes, fog, low-poly lighting, terrain, coastline, chase camera and exploration markers. Pixel ratio is capped at 1.65; no expensive full-island shadow map.
- `js/boot.js`: accessible HTML controls, focus lifecycle, map, statistics, optional audio and visible required-asset/WebGL/context-loss failures. No production debug hooks.
- `css/`: local copy of the site's Graphite/Ember/Golden Amber base tokens plus game-specific layout. Local theme delivery keeps the standalone folder portable.
- `assets/`: actual generated SVG/PNG imagery and optional local Piper speech; see the asset manifests. `vendor/`: Three.js 0.185.1 and its MIT license.

## Validation

```bash
node --test games/island-drive/tests/world.test.cjs
```

The **25 focused tests** cover clearance against every road, object separation, connected routes and endpoints, dry road widths and grade limits, exact terrain interpolation, reachable/random checkpoints, no checkpoint gameplay benefit, quality, contact debouncing, high-speed sweeping, three-car handling, 30/60/144 Hz equivalence, water-only end, pause, restart and invalid inputs/local-only security properties.

Browser checks require optional developer-only Playwright and Chromium. With the static server running:

```bash
# If Playwright is installed and its browser is available:
node games/island-drive/tests/browser-smoke.cjs
# Otherwise point to existing local installations (no project dependency changes):
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROMIUM_PATH=/absolute/path/to/chromium \
node games/island-drive/tests/browser-smoke.cjs
```

`ISLAND_URL` may override the default localhost URL. The browser script uses software WebGL when hardware rendering is unavailable, exercises actual desktop/phone layouts and controls, and records screenshots/results in `docs/validation/`. Test-only instance instrumentation is injected by the browser test; it is not exposed by the shipped game. See `docs/VALIDATION.md` for the final results and limitations.

For a broader regression check, 13 existing game suites were run with **87 passing tests** using `npm test -- --runInBand --coverage=false --cacheDirectory=games/island-drive/.validation/jest-cache --runTestsByPath ...`. Coverage is disabled for this partial run to avoid unrelated global thresholds. No app startup, database integration or production behavior was exercised.

## Boundaries

The module requires WebGL 2 and a modern browser. It is a designed driving approximation, not a rigid-body vehicle engineering simulator: it does not model suspension travel, jumping or rollover; the car follows the terrain and cannot suffer damage. Touch controls are verified in Chromium emulation, not on physical iOS/Android hardware. No gamepad support or persistence is included. All art, code, audio, tests and documentation are inside this folder; no telemetry, AI calls, credentials or runtime internet dependency.

## Security contract

- Feature: Amber Isle standalone driving simulation.
- Security zone: fully-public. Interactive principals: anonymous (same access for admin, family, user). Machine principals: none.
- Data classification: public artwork, code and ephemeral local session statistics.
- Capabilities: none; no privileged operations. Object scope: none. Admin override: no.
- Browser mutations and CSRF: game state changes only in memory; no HTTP mutations, cookies, account/session access, forms, uploads or backend.
- Abuse controls and limits: fixed world/asset counts, bounded input values, bounded elapsed time and fixed simulation substeps; no remotely supplied content.
- Output contexts: static HTML, textContent, local canvas/WebGL. No evaluation of URL input or user HTML.
- Private storage/delivery: none. Outbound services: none; same-directory static resources only.
- Cache: deliberately public static resources may be cached. No service worker or persistent personal state.
- Logs: local generic on-screen failures; no server operations, telemetry or personal diagnostic data.
- Retention: memory cleared on restart/page close. No saved progress.
- Required negative tests: non-finite/oversized simulation input; invalid car selection; no remote requests, unsafe DOM insertion or persistence; missing graphics and optional audio recovery.
- Legacy dependency/migration: copied, MIT-licensed Three.js 0.185.1 from the repository's installed dependency; no shared manifest or integration changes.
