# Validation · Ember Descent

Validated locally on 2026-09-25. No production investigation, database lifecycle, deployment or production restart was performed. All implementation, test and evidence files are inside `games/rocket-lander/`.

## Automated checks

- **44/44 model tests**: gravity/2D confinement, thrust/rotation direction, both side-engine costs and cancellation, partial/empty/infinite fuel, contact/depletion order, safe start departure/return, all landing criteria, side/inside/obstacle/surface crashes, tunneling, fixed timestep at 30/60/144 Hz, pause/retry/stage/input lifecycle, grade boundaries, storage isolation/failures, all-stage flights and local-only runtime. [Output](validation/model-tests.txt).
- **70/70 Amber Isle and Sky Harbor focused tests** passed unchanged. [Output](validation/previous-games.txt).
- **87/87 tests in 13 existing Jest game suites** passed. Cache/output were redirected into this folder; coverage disabled for partial regression run. [Exact invocation and output](validation/game-regressions.txt).
- **35/35 Chromium browser checks**, seven actual goal arrivals, no unexpected page errors. Real keyboard lift/turn and correct-side exhaust; audio gesture; pause/blur/help; ordinary flight failure and retry; all six standard arrivals; practice record isolation; persistence/clear; two simultaneous touch controls/cancellation; hidden-tab handling; mobile layouts; WebGL/module/context failures; denied storage/audio; context-loss audio silence; high-altitude portrait framing; local requests; bounded draws. [Machine-readable evidence](validation/browser-results.json).

## Ordinary-control flights

Every flight starts on its normal departure pad with 160 units and normal gravity. The test-only controller produces only main/left/right button booleans, held in **0.1-second intervals (10 Hz)**. Physics runs at 120 Hz. No position/velocity/angle/fuel/state rewriting, special thrust, teleports or gameplay autopilot is used for these flights. Node runs log sampled positions and fuel; the browser independently repeats all six standard flights and Atlas practice.

| Planet / mode | Flight time | Fuel remaining | Fraction | Minimum conservative obstacle clearance | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| selene / standard | 29.92s | 147.11 | 91.94% | 22.17 m | landed |
| ochre / standard | 31.19s | 143.16 | 89.48% | 4.99 m | landed |
| verdant / standard | 28.71s | 141.89 | 88.68% | 5.95 m | landed |
| nacre / standard | 29.79s | 138.35 | 86.47% | 5.98 m | landed |
| cinder / standard | 29.65s | 134.51 | 84.07% | 5.96 m | landed |
| atlas / standard | 28.67s | 131.17 | 81.98% | 5.96 m | landed |
| atlas / practice | 28.67s | ∞ | unranked | 5.96 m | landed |

Clearance is the minimum vertical gap above the highest obstacle vertex while the conservative 1.94 m rocket radius overlaps its horizontal footprint. It is measured on the actual flown trajectory in addition to collision detection, not inferred from stage bounding boxes. Detailed trace and touchdown speed/tilt/spin: [flights.json](validation/flights.json). The narrowest tested margin was 4.99 m. Finite touchdown descents were 0.61–1.52 m/s, below the 3.4 m/s limit.

A separate ordinary main-engine-only launch leaves the sector and displays the actual failure panel. Retry resets the game; the next controller flight lands successfully. Boundary/model unit tests intentionally construct contact states to isolate edge conditions; those fixtures are never used as solvability evidence.

## Graphics and screenshots

Actual Chromium 153.0.8010.12, headless SwiftShader WebGL 2. The inspected planet snapshots used 95–135 draw calls and 2168–3028 triangles, with 130 or fewer live geometries in those snapshots. Pixel ratio is capped at 1.5, particles at 80. Scenes dispose geometry/material/texture resources when changed. No frame-rate claim is made from software-rendered automation.

- [Expedition menu](validation/01-menu.png) and [departure](validation/02-flight.png).
- [Actual main + left-nozzle exhaust during right tilt](validation/03-exhaust.png).
- [Actual failure](validation/04-failure.png), [finite touchdown/rank](validation/05-success.png), [infinite practice result](validation/06-practice.png).
- [Ochre](validation/planet-ochre.png), [Verdant](validation/planet-verdant.png), [Nacre](validation/planet-nacre.png), [Cinder](validation/planet-cinder.png), [Atlas](validation/planet-atlas.png).
- [Phone menu](validation/07-mobile-menu.png), [phone flight](validation/08-mobile-flight.png), [landscape phone](validation/09-mobile-landscape.png), [high-altitude portrait flight](validation/10-mobile-high-flight.png).

Visual review corrected a portrait guidance panel that initially obscured the departing rocket, added height/spin readouts, muted the rear skyline to distinguish solid obstacles and kept compact touch labels on one line. The final views keep departure/arrival clear of the flight guidance. Physics has no depth axis; the frontal orthographic view exactly projects the shared collision polygons.

## Practical limits and scope

The automated controller has perfect instrument knowledge and proves feasibility, not human usability. Physical iOS/Android, Safari/Firefox, hardware GPU performance and production discovery after restart remain untested. Load failures are tested explicitly. No main application start, external network API, full database suite or production restart was used. Existing game tests were read/executed without modifying their sources or evidence. No integration or shared manifest change is needed.
