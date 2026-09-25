# Sky Harbor validation · 2026-09-25

All changes are confined to `games/sky-harbor/`. The starting worktree was clean. The existing `main` branch tracks `origin/main`; no app process, production restart, database lifecycle, setup pipeline, deployment or integration change was used. The game was served with Python's loopback-only static HTTP server.

## Automated results

| Check | Result | Evidence |
| --- | --- | --- |
| Deterministic game tests | **45 passed** | [model-tests.txt](validation/model-tests.txt) |
| All directed airport routes | **20/20 completed** through player inputs | [flights.json](validation/flights.json) |
| Actual Chromium/WebGL/UI | **30 checks passed**, zero uncaught desktop/mobile errors | [browser-results.json](validation/browser-results.json) |
| Amber Isle model regression | **25 passed** | [island-regression.txt](validation/island-regression.txt) |
| Existing application game suites | **13 suites, 87 tests passed** | [game-regressions.txt](validation/game-regressions.txt) |
| Runtime JavaScript syntax | Passed Node syntax checks | `js/*.js`, `js/renderer.mjs` |
| Vendored dependency integrity | All three recorded SHA-256 hashes match | `vendor/SHA256SUMS` |

The model checks include exact render/collision terrain agreement, every runway/apron/final corridor, obstacle bounds, fixed-step equivalence at 30/60/144 Hz, manual rotation, retained pitch, released-bank leveling, coordinated turns, finite/bounded inputs, pause/restart, normal touchdown/rollout, hard/fast/side/edge/off-runway touchdowns, wrong-airport and reciprocal diversions, flyover rejection, water/terrain/obstacle impacts, stall recovery, high-speed drag/control authority, guidance stages, keyboard/pointer semantics, and local-only runtime security properties.

The broader *application* Jest suite was not run: this is an isolated static addition with no app code changes. The relevant existing game regression set was run with coverage disabled and its cache explicitly directed into this new folder. No global thresholds were bypassed for a claimed full-suite run.

## Completed control-only flights

The deterministic pilot in `tests/fly-route.cjs` is **test-only**. It stages a new aircraft on the chosen departure runway once. It then only calls the public simulation update with digital pitch, bank, throttle and brake inputs. It never assigns flight state, position, speed, altitude, heading, touchdown, destination completion or a waypoint teleport. Unit tests use explicit synthetic contact fixtures for isolated failure boundaries; those fixtures are separate from the 20 complete flights.

Pitch and throttle follow the actual displayed guidance targets. The pilot reads heading, runway course, centreline offset, map/gate bearing and on-ground state; bank taps steer toward the chart/gate and then intercept the extended centreline. Releasing bank lets the same player wing-leveling assist act. The pilot does not have extra thrust, lift, turning, landing or braking authority. The game neither imports nor exposes this controller.

Every route includes **takeoff → rotation → climb → cruise → final → flare → rollout → stopped completion**. Routes needing an arrival turn, descent or go-around include those stages in their recorded traces. Actual selected-airport runway headings of 090°, 360° and 180° are covered. Both departure and arrival at all five airports are tested. Directly running the test harness for any two airport IDs reproduces a route.

- Haven → Meadow: **157.10 s**, **7.39 km** flown, centreline touchdown, approximately **3.393 m/s** descent, **28.13 m/s** touchdown speed, **41.8 m** braking roll, then a one-second stop.
- Full set: **157.10–661.58 s**. Longer results include actual circling and go-arounds, not accelerated position changes.
- Two flights also completed in the actual browser using the live gameplay simulation and the same ordinary input policy: Haven → Meadow (**156.73 s**) and Pine → Mesa (**220.99 s**). Small differences from Node come from live frames during screenshots/UI checks.
- Browser tests first exercise real W and ↓ keyboard hold/release events to prove that throttle alone stays on the ground and pitch input actually rotates. The full flights use accelerated simulation update calls to keep validation reproducible; they are not claims of a human playing twenty flights in real time.

The controller's 60 Hz observation/control is more precise than a novice. These results establish that following the public control targets can complete the routes; physical-device and novice usability studies have not been performed.

## Browser and visual checks

No connected in-app browser was available after the required discovery/troubleshooting checks. Validation used the already installed developer Playwright and Chromium, with **SwiftShader software WebGL 2**. No runtime browser dependency was added to the project.

Checks cover initial load and real graphics draw calls, gesture-started local WAV playback/stop, keyboard takeoff, scrolling suppression, pause freezing, help-modal isolation, blur pause/input clearing, restart, actual debrief and crash/retry, same-directory-only asset requests, portrait/landscape layouts, simultaneous touch pitch/power, pointer cancellation of actual held inputs, no horizontal overflow, missing renderer, unavailable WebGL, lost graphics context and optional audio failure.

The measured Meadow approach rendered **111 draw calls and 92,342 triangles** in the captured frame. This is a bounded scene measurement, not a hardware FPS benchmark. The complete terrain has 39,200 triangles; chunked instancing and static airport batching bound object draws. Pixel ratio is capped at 1.5. The world contains 7,948 solid scenery/airport objects.

All screenshots were inspected, including the menu, runway, approach, debrief, chart, hills/desert and both mobile orientations. The camera was adjusted after the first visual pass to keep the aircraft above the compact HUD.

| Screenshot | Evidence |
| --- | --- |
| [01 Dispatch](validation/01-dispatch.png) | Local illustration, airport choice, route estimate and optional briefing |
| [02 Departure](validation/02-runway.png) | Numbered runway, level apron, aircraft, buildings and takeoff cues |
| [03 Climb/cruise](validation/03-climb.png) | Airborne aircraft over fields and navigation feedback |
| [04 Chart](validation/04-chart.png) | Five airports, headings/elevations, selected route and gate |
| [05 Final](validation/05-final.png) | Gold approach gates, actual aircraft and descent targets |
| [06 Debrief](validation/06-debrief.png) | Completed destination flight with contact and rollout statistics |
| [07 Hills](validation/07-mountains.png) | Pine/mesa terrain transition and mountain side |
| [08 Desert](validation/08-desert.png) | Ochre environment, destination runway and alignment feedback |
| [09 Phone menu](validation/09-mobile-dispatch.png) | Responsive dispatch panel |
| [10 Phone flight](validation/10-mobile-flight.png) | Touch controls and readable portrait instruments |
| [11 Landscape phone](validation/11-mobile-landscape.png) | Aircraft clear of compact HUD and controls |

## Reproduction

From the repository root:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory games/sky-harbor
```

In another terminal:

```sh
node --test games/sky-harbor/tests/world.test.cjs
node --test games/island-drive/tests/world.test.cjs
node games/sky-harbor/tests/fly-route.cjs haven meadow
```

Browser checks accept `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH` and `SKY_URL`. The exact existing-game Jest invocation is recorded in `validation/game-regressions.txt`; it uses `--runInBand --coverage=false --cacheDirectory=games/sky-harbor/.validation/jest-cache` and 13 explicit game test paths. Validation output belongs to this folder; transient Jest cache is ignored by this folder's `.gitignore`.

## Remaining limits

No production or database integration was executed. Static discovery was verified by reading `app.js`, not by restarting it. Real mobile hardware and GPU frame rates are unverified. The flight dynamics are deliberately forgiving and simplified; no real-world piloting suitability is claimed. There is no weather, fuel, ATC, persistence, gamepad or separate flap/rudder control. There are no known failing focused or browser checks.
