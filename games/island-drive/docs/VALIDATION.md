# Validation — 2026-09-25

## Automated result

- **25 / 25** focused Node tests pass (`node --test games/island-drive/tests/world.test.cjs`).
- **22 / 22** real Chromium browser checks pass. `validation/browser-results.json` lists each assertion. WebGL 2 was exercised through SwiftShader; this was not a DOM-only mock.
- **87 / 87** broader existing-game tests pass across 13 Jest suites, including the games view, maze, snake, memory, Rex Maze, Division Quest and narrative games. Coverage disabled for the partial run; test cache/output stayed in the module's ignored `.validation/` folder.
- JavaScript syntax checks and final diff whitespace/scope checks pass.

## World geometry

The test examines all solid footprints against all road segments, including overlapping intersection regions; it also checks every object pair for intersection.

| Measurement | Result |
| --- | --- |
| Connected road routes | 15 |
| Total road centreline length | 10.872 km |
| Checkpoint candidate road sites | 67 |
| Simultaneous checkpoint markers | 4 |
| Solid world objects | 685 |
| Buildings / trees / rocks / lamps / landmarks | 67 / 506 / 65 / 42 / 5 |
| Minimum solid-footprint gap beyond any road edge | 4.046 m |
| Maximum sampled longitudinal grade | 21.00% |
| Maximum sampled road cross-slope | 7.94% |

Longitudinal grades and road edges are sampled at two-metre intervals; terrain heights share the rendered mesh's exact triangle interpolation. The first version exposed excessive cross-slope on the eastern coast. Cut/fill roadbeds, smoothly blended shoulders and blended junction heights corrected it. Roads are surface texture, so separate elevated road meshes cannot intersect or reveal terrain through them.

Car collision uses a conservative enclosing circle and a swept segment against obstacle circles at 120 Hz. Tests cover a long sweep through a thin object, sustained contact without repeated penalties, backing away and hitting again, equivalent behavior at 30/60/144 Hz, invalid input, and all three car profiles. The model intentionally follows terrain instead of simulating suspension, jumps or rollover.

## Browser and visual checks

The in-app Browser runtime reported no available browser. Local cached Playwright and Chromium were available, so the fallback browser suite launched actual headless Chromium with software WebGL. No package or shared manifest was changed.

Desktop at **1440 × 1000**, mobile touch emulation at **390 × 844**:

- Select cars, load local textures, render original low-poly models and drive using the keyboard.
- Decode the real 11.877-second local welcome WAV and enable the optional synthesized engine.
- Pause freezes simulation; help cannot accidentally resume play; map, resume, blur-pause and clean restart work.
- Water produces the session summary and restart UI. No other terminal condition exists in the simulation.
- Actual touch events hold/release the accelerator and activate pause. The layout has no horizontal overflow.
- Missing terrain texture and disabled WebGL both produce readable errors.
- All observed requests stay within the local game folder; no page script errors.
- A pixel check rejects a mostly black rendered terrain, in addition to visual inspection. Asset generation must finish before browser validation starts.

Retained, visually inspected screenshots:

1. [Car selection](validation/01-selection.png)
2. [Harbour drive](validation/02-town-drive.png)
3. [Island map](validation/03-island-map.png)
4. [Highland drive](validation/04-highland-drive.png)
5. [Coastal drive](validation/05-coast-drive.png)
6. [Water / session summary](validation/06-water-summary.png)
7. [Mobile selection](validation/07-mobile-selection.png)
8. [Mobile driving](validation/08-mobile-drive.png)

## Scope and limits

All authored, generated, vendored and validation files belong to `games/island-drive/`. No shared routes, manifests, games index, other games or production code were edited. The normal existing mount is `/island-drive/` after a normal authorized site startup; localhost static serving works immediately and independently. No application startup, deployment, production restart or database operation was performed.

Physical mobile devices, Safari/Firefox and hardware GPU performance were not tested. Software WebGL proves rendering and interaction but is not a hardware-performance benchmark. The full backend suite was not run; the relevant broader game suites were. There is no gamepad, saved progress, traffic, rigid-body suspension or rollover. These limits do not affect the endless driving, scoring, exploration or water-only end rules.
