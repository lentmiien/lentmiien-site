# Ember Descent · Rocket Lander

Six worlds, three engines, one careful arrival. A complete standalone game with strictly 2D rocket flight and original low-poly 3D scenes. Fly from the blue departure pad, clear the solid terrain, brake, and settle onto the gold arrival pad. Standard mode ranks fuel brought home. Practice has unlimited fuel. No build, account, backend, telemetry, API key or runtime remote asset is required.

## Launch and site discovery

From the repository root:

```sh
python3 -m http.server 8767 --bind 127.0.0.1 --directory games/rocket-lander
```

Open **http://127.0.0.1:8767/**. Serve over HTTP; `file://` module loading is unsupported. Modern WebGL 2 is required; load/context failures show a visible reload panel.

**Site URL on the documented public host: `https://my.lentmiien.com/rocket-lander/`. Exact site path: `/rocket-lander/`**, not `/games/rocket-lander/`. Read-only inspection of `app.js` confirmed `serveGames()` mounts each game folder at its name on application startup and `getAvailableGames()` discovers folders for `/games`. The existing listing will call this folder **Rocket Lander**; the game itself is titled **Ember Descent**. An already-running application receives the static mount on its next normal startup after delivery. This task does not deploy, start the main app, restart production, modify routes or edit a shared index/manifest.

## Your expedition

All six planets are available immediately. Select a stage and mode, launch, retry freely, then use Next planet after each success. Local standard personal bests mark completed worlds. The last world's Next button loops back to Selene; replay to improve fuel reserve.

| Planet | Visual identity | Gravity | Main thrust / gravity | Obstacles | Suggested crossing height |
| --- | --- | ---: | ---: | --- | ---: |
| Selene | Blue lunar shelf, silver ridge, ringed giant | 2.4 m/s² | 7.50 | One 10 m ridge | 19 m |
| Ochre | Dusk sandstone, amber light, mesa silhouettes | 3.7 m/s² | 4.86 | 14 m and 17 m fins | 24 m |
| Verdant | Jade valley, rear vegetation, pale green aurora | 5.2 m/s² | 3.46 | 12 m and 16 m outcrops | 24 m |
| Nacre | Ice needles, violet moon, polar ribbons | 6.5 m/s² | 2.77 | 18 m, 19 m and 13 m needles | 27 m |
| Cinder | Basalt ridges, ember fissures, caldera skyline | 8.2 m/s² | 2.20 | 18 m and 16 m ridges | 26 m |
| Atlas | Industrial shelf, refinery towers, golden giant | 9.8 m/s² | 1.84 | 15 m, 19 m and 12 m towers | 27 m |

These are fictional worlds with designed gravity, not scientific models of named Solar System bodies. Every flight begins at x=−27 m and targets x=27 m. Departure is 12 m wide at 3 m elevation. Arrival is 14 m wide at elevations 3/5/4/6/4/7 m respectively. The physical sector is x=−39…39 m, y=0…48 m; the whole rocket must stay inside. Dashed lines mark the boundary. Height is rocket centre above the shelf, not feet clearance.

## Controls and first arrival

| Input | Effect |
| --- | --- |
| W / ↑ / Space | Hold main engine; release to coast |
| A / ← | Tilt left by firing the right rotation nozzle |
| D / → | Tilt right by firing the left rotation nozzle |
| P / Escape | Pause/resume |
| R | Retry the selected stage and mode with a fresh tank |
| H | Open paused flight notes |
| On-screen engine buttons | Hold simultaneously for touch or mouse flight |

Use **short main burns** to lift straight up. Watch HEIGHT and the coast cue: low gravity preserves upward speed, so releasing the engine at the ridge height is often too late. Rise above the foreground obstacles before tilting. A small tilt and a burn build horizontal motion; release the turn early because spin takes a moment to damp. Tilt against your velocity and burn to brake well before the goal. Bring the rocket upright and pulse the main engine to soften the descent.

There is no autopilot, hidden hovering, self-leveling, auto-throttle, target-following or automatic airborne landing. The camera stays frontal and orthographic; depth never changes collision coordinates. On portrait screens it translates to follow the rocket, and the HUD indicates the offscreen goal. Bright outlined foreground rocks/towers, the shelf and pads are solid. Muted rear ridges and rear vegetation/crystals are scenic depth.

HUD: fuel, horizontal/vertical speed (m/s), tilt, spin (°/s), height (m), goal direction/distance and contextual tips. Color plus text/numbers signal unsafe landing instruments. Standard keyboard navigation, visible focus rings, native modal focus confinement, scrollable notes/menu and 44 px or larger main control targets are provided. Gameplay itself remains visual and is not a nonvisual accessible simulation.

## Flight, contact and fuel rules

- **120 Hz fixed physics**, rendering independent of that clock. Linear inertia with disclosed gentle drag `exp(−0.045·dt)`; angular inertia with damping `exp(−3.2·dt)`. Rotation nozzles model pure angular torque at 2.6 rad/s²; their tiny lateral translation is intentionally omitted. Main acceleration is 18 m/s² along the tilted rocket. Gravity continues when engines stop. Mass does not change with fuel.
- Opposing rotation buttons cancel both rotation engines with no side fuel cost or plumes. Main still works. Fuel cannot go negative; the final partial burn receives only its proportional impulse. An empty standard tank cannot fire any engine.
- **160 units initially.** Main uses **1.60 units/s**; either rotation engine uses **0.28 units/s**. Main and one side burn both costs. That is 100 seconds of continuous main burn before side use, versus roughly 29–31 seconds for the tested complete flights with intermittent burns.
- Safe pad contact requires downward arrival, horizontal speed **≤2.5 m/s**, descent **≤3.4 m/s**, tilt **≤12°**, angular speed **≤20°/s**, and the complete rotated hull/feet **inside the pad with 0.25 m edge clearance**. Crossing a region above a pad cannot succeed. Side/inside/bottom contacts, unsafe arrivals and obstacles crash.
- Safe contact passively seats the landing gear: velocities are arrested and the body settles upright on the pad. A goal touchdown remains in a stable contact state for **0.6 seconds**, then displays the result. This is collision response after actual contact, never an airborne assist. Returning safely to departure permits another takeoff and does not finish the flight.
- **Zero fuel while airborne or on departure fails immediately.** Contacts resolve before depletion on the same fixed step: a safe goal touchdown on the final burn counts, while an impact remains a crash. Fuel at that touchdown is used for ranking; the settling interval consumes none.
- Rendered solid silhouettes come from the exact convex polygons used by collision SAT. Spatial substeps bound hull translation plus rotation to roughly 0.08 m, avoiding tunneling even at high speed. Extreme out-of-envelope work is rejected rather than processed without limit. Frame catch-up accepts at most 100 ms; slow devices run in slow motion rather than jumping through terrain. Pause discards catch-up time.
- Switching tabs, window blur, pause, help, retry, menu and stage changes release held input. Touch release/cancel/lost capture clears individual pointers. Sound is optional, starts from a gesture and pauses with play.

## Rank and local records

`fuel fraction = fuel at safe touchdown / 160`. No time, speed, distance or landing-style bonus affects the grade.

| Rank | Remaining fuel |
| --- | --- |
| S | ≥70% |
| A | ≥50%, below 70% |
| B | ≥30%, below 50% |
| C | ≥10%, below 30% |
| D | Below 10%, including an exact final-step touchdown |

**Practice ∞** plays the identical planets and physics but never spends fuel or fails from depletion. It displays infinity and a practice completion, never a fuel percentage or rank. It cannot replace standard bests.

Only six anonymous numeric standard best fractions are retained under `ember-descent.records.v1` in localStorage. Values are validated, bounded and rendered as text. Denied/full/corrupt storage does not block play. Clear local records removes only this game's key. No personal data or server synchronization is involved.

## Implementation and assets

- `js/world.js`: six authored stage definitions and convex obstacle polygons.
- `js/simulation.js`: deterministic 2D flight, swept spatial stepping, physical contact, fuel and grading.
- `js/input.js`, `js/records.js`: input lifecycle and guarded local bests.
- `js/renderer.mjs`: original faceted rocket, terrain, planets, pads, lighting, exhaust, bounded particles, lightweight contact shadow and fixed-orientation camera.
- `js/boot.js`, `index.html`, `css/`: responsive menu/HUD, help, touch, results, pause, optional synthesized engine sound, visible failures. Local Graphite/Ember/Golden Amber theme copy.
- `vendor/`: unchanged Three.js 0.185.1, MIT license, provenance and hashes copied from Sky Harbor. No npm dependency or lockfile changes.
- `assets/`, `scripts/generate-assets.cjs`: original reproducible SVG emblem; geometry and audio source are the reproducible asset definitions. No narration, downloaded imagery or runtime API. See [asset notes](assets/GENERATED-ASSETS.md).
- `tests/`: model checks and a **test-only** 10 Hz button controller, absent from runtime imports. Browser instrumentation is injected only by the test harness; production exposes no mutable simulation/debug hook.

## Validation

```sh
node --test games/rocket-lander/tests/model.test.cjs
node games/rocket-lander/tests/fly-stage.cjs
node --test games/island-drive/tests/world.test.cjs games/sky-harbor/tests/world.test.cjs
```

Optional developer-only Playwright/Chromium, with the standalone server running:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROMIUM_PATH=/absolute/path/to/chrome \
node games/rocket-lander/tests/browser-smoke.cjs
```

`DESCENT_URL` overrides `http://127.0.0.1:8767/`. No developer browser dependency is needed to play. Evidence remains under this new folder. See [validation report and screenshots](docs/VALIDATION.md) and the [security contract](docs/SECURITY.md).

## Limits

Verified in Chromium with software WebGL, including emulated touch at 390×844 and 844×390. Physical mobile devices, Safari/Firefox and hardware GPU frame rates are unverified. The controller proves ordinary-button solvability, including 0.1-second held commands; it is not a human playtest or novice usability certification. Translational damping and torque-only side nozzles simplify spacecraft dynamics. No gamepad, narration, backend or deployment is included. Full repository/database integration tests were not run; focused game regressions were run without starting the application.
