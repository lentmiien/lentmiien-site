# Sky Harbor · The open-country flying club

A fully local low-poly flight game about the pleasure of a good arrival. Fly the **Kestrel**, a single fixed-gear training aircraft, between five airports. Choose a route, manually take off, navigate, fly the approach, flare, brake, and review your landing. There is no timer, fuel depletion, account, AI service, telemetry or backend.

## Launch

From the repository root:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory games/sky-harbor
```

Open **http://127.0.0.1:8766/**. HTTP is required for local ES module loading; `file://` is unsupported. The complete folder can be hosted on any static HTTP server, at any path. No build or package installation is required to play.

**Site launch URL: `/sky-harbor/`**, not `/games/sky-harbor/`. Read-only inspection of `app.js` confirmed `serveGames()` mounts every game directory at `/<folder>` on application startup; `getAvailableGames()` discovers the directory for the games listing. A running process acquires the mount at its next normal startup. This change neither deploys nor restarts the app. No integration, shared manifest, index, route or other game was edited.

## Your first flight

Choose **Haven Coast → Meadow Field**. This 7 km leg runs straight east across low, level terrain, with departure and arrival on runway 09. The tested flight takes about **2 minutes 37 seconds**, including a full stop. Allow 2–4 minutes when learning.

1. Hold **W** for 3.4 seconds to reach 100% throttle, then release. Wait for **40 m/s**.
2. Hold **↓** for about **0.9 seconds**, reaching **+8° pitch**. Release to keep that pitch and climb.
3. At the indicated cruise altitude, use **↑** to return pitch to **0°** and hold **S** until power reaches **76%**. The current cue changes as you approach the destination.
4. Join the gold approach gates. Set **40% power** and trim pitch to the displayed target (usually about **−4°**). Target **40–46 m/s**. Gold gates show position and height; they never move the aircraft.
5. At **7 m AGL**, move pitch to **+1°** (roughly half a second of ↓ from −4°), and hold **S** to idle. The aircraft slows and settles; continue to keep the wings level.
6. After touchdown, hold **Space** until stopped on the runway. Reduce pitch toward 0°. The debrief opens only after the aircraft has stopped for one second.

The HUD shows the exact pitch and throttle target. Pitch commands are *held to change the setting*, not held throughout a climb/descent. Use short taps for the last degree. Pitch moves at 9°/second; throttle changes 30 percentage points/second. The narration is optional, starts only after clicking Listen, and has a stop button and visible transcript.

## Controls

| Input | Effect |
| --- | --- |
| W / S | Increase / decrease throttle; release holds the setting |
| ↓ / ↑ | Raise / lower the nose; release holds pitch trim |
| A / D or ← / → | Bank and coordinate a turn; release levels the wings |
| Space | Wheel brakes; idle throttle before stopping |
| P / Escape | Pause; use Resume or Escape from the pause panel |
| M | Paused region chart |
| H | Paused flying lesson |
| C | Near / wide chase view |

Touch devices expose simultaneous power, pitch, bank and brake buttons. Losing focus, hiding the tab, pausing or opening help clears held controls. Restart/dispatch are available from the pause panel as well as after a crash.

## Region and airports

The terrain spans **28 × 28 km (784 km²)**, compared with Amber Isle's roughly 2 km island. Airport centres are **7–20.3 km apart**. Cruise is typically 55–68 m/s (198–245 km/h); routes are longer than centre-to-centre distance because the player joins an arrival gate. The full set of 20 tested directed flights took **2.6–11.0 minutes**; most took 4–8 minutes, with longer flights including a go-around/circuit. See the exact traces in `docs/validation/flights.json`.

| Airport | Setting | Elevation ASL | Selected runway | Reciprocal |
| --- | --- | --- | --- | --- |
| Haven Coast / HVC | Tidal coast and offshore islands | 24 m | 09 / 090° | 27 |
| Meadow Field / MDF | Patchwork agricultural plains | 24 m | 09 / 090° | 27 |
| Pine Reach / PNR | Forested hills below the ridge | 180 m | 36 / 360° | 18 |
| Sunstone Mesa / SSM | Ochre desert and rocky plateaus | 220 m | 09 / 090° | 27 |
| Northwater / NWR | Northern coast, islands and mountain views | 60 m | 18 / 180° | 36 |

Every runway is **1,400 × 64 m**, with threshold stripes, centreline, aiming marks, edge lights and heading numbers. Aprons and connecting taxi lanes are level, with five airport buildings and a windsock set to the side. The selected arrival is directional; landing on its reciprocal is reported as a safe diversion, not credited as the selected route. There is no invisible teleport onto final.

The arrival chart marks a gate **3.2 km before the threshold**. Direct navigation first points to that gate, then to the touchdown area while on final. Cruise altitude recommendations look ahead along the navigation course for terrain clearance. On higher routes, descend before joining; if too high, fast or off-centre late on final, use full power and +8° pitch, climb 300 m above the runway and circle back. The player controls the entire circuit. North is up on all maps.

## Flight model and honest assists

This is a designed training game, not a certified flight-training or aerodynamic model:

- Fixed 120 Hz simulation; 30/60/144 Hz rendering produces the same flight state for the same input history. A long frame accepts at most 100 ms of simulation. Pause discards elapsed catch-up time.
- Pitch trim stays set. Bank decays toward level only when its input is released, and coordinated turning needs no rudder. No route-following, automatic rotation, flare, terrain avoidance, auto-throttle or auto-landing exists.
- Calm wind, fixed landing-lift configuration and fixed gear keep the controls small. At or above 40 m/s, pitch 0° approximately holds altitude. Below that speed, lift fades progressively; at low speed away from the flare, the cue asks for a lower nose and more power.
- Drag progressively limits speed to approximately 75 m/s in level full-power flight. There is no sudden structural overspeed failure. Excess speed is still hazardous on landing.
- A normal guided flare loses speed to roughly 28 m/s at touchdown. The tested flare descends at about 3.39 m/s: deliberately generous training tolerance. Approach speed and touchdown speed are different.
- ASL is the aircraft reference altitude above sea level. AGL is wheel clearance above local terrain/water, using a 2 m reference offset. There is no separate ground-height model hidden from the renderer.
- A runway touchdown is accepted only inside its bounds (5 m edge margin), at no more than 54 m/s, 4.5 m/s descent, 15° heading error and 13° bank. Going off the pavement during rollout ends the flight. Wrong-airport and reciprocal touchdowns are explicitly reported after stopping.
- Water, terrain outside a runway, obstacles, hard/sideways touchdowns, runway excursions and leaving the mapped region produce a clear debrief with restart. The boundary cue appears before the limit. No countdown causes a loss.

Landing quality is `max(0, round(100 − descent×8 − |centreline offset|×0.6 − alignment error×2))`. Completion additionally requires the selected airport, selected direction, an actual touchdown and a one-second full stop. A flyover cannot count. Statistics include time, distance, maximum altitude/speed, touchdown speed/descent/alignment/offset, and ground roll. No progress is persisted.

## Implementation and bounded rendering

- `js/world.js`: deterministic terrain, five airports, seeded scenery and spatial collision buckets. The rendered 200 m terrain grid and simulation share exact triangle interpolation. Flattened runway/apron surfaces and both approach corridors reserve terrain and obstacle clearance.
- `js/simulation.js`: aircraft dynamics, contact evaluation, statistics, bounded input and guidance based only on actual flight state.
- `js/renderer.mjs`: vendored Three.js, original aircraft and airport meshes, triangle-coloured landscapes, fog, terrain shadows, approach gates and chase views. Pixel ratio is capped at 1.5. The world contains 7,948 bounded solid objects (5,803 trees, 1,654 rocks, 461 houses, 25 airport buildings and 5 windsocks). Scenery is instanced in 3 km chunks for frustum culling; repeated static airport meshes are merged by material. No expensive world shadow maps or postprocessing.
- `js/input.js` and `js/boot.js`: keyboard/touch lifecycle, menus, accessible HTML guidance, pause, debrief, maps and local narration. Required-asset, WebGL 2 and context-loss failures are visible. No production test hooks.
- `css/`: portable local copy of the existing Graphite / Ember / Golden Amber tokens and responsive game styles.
- `assets/`: original reproducible SVG/PNG artwork and an actual local Piper narration. See the asset manifest.
- `vendor/`: unmodified Three.js 0.185.1 and MIT license, copied from Amber Isle's vendored files; hashes retained.
- `tests/`: deterministic checks and a **test-only digital-input pilot**. This pilot is never imported by the game. Browser instrumentation exists solely in the test harness.

## Validation

```sh
node --test games/sky-harbor/tests/world.test.cjs
node games/sky-harbor/tests/fly-route.cjs haven meadow
node games/sky-harbor/tests/fly-route.cjs meadow pine
```

Optional developer-only Playwright/Chromium (no game dependency), with the standalone server running:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROMIUM_PATH=/absolute/path/to/chrome \
node games/sky-harbor/tests/browser-smoke.cjs
```

`SKY_URL` overrides the default localhost URL. The browser check uses software WebGL when needed. It tests actual key input, plays the local narration, completes two flights through ordinary simulation inputs, checks touch cancellation, pause/blur, restart and explicit missing-asset/WebGL/context-loss errors. Screenshots, route traces and result files live in `docs/validation/`. No app/database startup is involved. See `docs/VALIDATION.md` for the final evidence and practical limits.

## Security contract

- **Feature / zone:** Sky Harbor standalone browser game / fully-public.
- **Interactive principals:** anonymous; identical public access for admin, family and user. **Machine principals:** none.
- **Data classification:** public code/art/speech and ephemeral in-memory flight statistics.
- **Capabilities / object scope / admin override:** none; no privileged, account-bearing or object-bearing operations.
- **Browser mutations / CSRF:** game state only, in browser memory; no HTTP mutations, uploads, forms, cookies or account/session access. No CSRF-protected backend operation is added.
- **Abuse controls / request limits:** fixed world and asset counts, finite bounded numeric inputs, bounded 120 Hz work and frame catch-up. No remotely supplied content or expensive server processing.
- **Rendering:** static HTML, textContent/element creation, canvas and WebGL. No URL input parsing, runtime eval or HTML insertion. Test instrumentation is not shipped as part of runtime imports.
- **Private media:** none; all game resources are deliberately public and confined to this folder.
- **Outbound hosts/services:** none; relative same-folder static assets only.
- **Cache policy:** public static resources may be cached; no service worker or saved personal state.
- **Security logs:** generic local on-screen failures. No server operations, telemetry, private diagnostic data or production logger calls are needed.
- **Retention/deletion:** memory clears on restart/page close; no persistent state.
- **Negative tests:** invalid route IDs; non-finite and excessive input/time; no remote requests, unsafe DOM insertion or persistence; WebGL/missing module/optional audio recovery; no false completion; keyboard/pointer state clearing.
- **Legacy dependency/migration:** local MIT-licensed Three.js and copied theme tokens; no legacy authorization dependency, migration, environment variable, Cloudflare change or exception. Existing static discovery was verified by reading code only.

## Limits

Requires a modern WebGL 2 browser. Physical iOS/Android devices and hardware GPU performance have not been tested; touch is checked in Chromium emulation. No weather, fuel, ATC, gamepad, cockpit instruments beyond the compact HUD, saved progress, free runway selection, or realistic aerodynamic certification. The test pilot reacts more precisely than a novice, so its routes prove control-only feasibility, not usability certification. Calm conditions and generous touchdown tolerances are disclosed rather than concealed. All implementation and validation files remain inside this folder.
