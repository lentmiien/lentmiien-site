# Moon Landing — Tranquility

A fully public, local WebGL simulation of the last kilometre of an Apollo-style
crewed lunar landing. The application automatically discovers this folder and
serves it at `/moon-landing/`, with a link in `/games`.

## Security contract

- Feature: Moon Landing browser simulation.
- Security zone: fully-public. Interactive principals: anonymous (and all roles
  equally). Machine principals: none. Data classification: public.
- Capabilities: none; no privileged operations. Object scope: none. Admin
  override: no.
- Browser mutations / CSRF: only ephemeral, in-memory simulation and display
  controls; no server writes, account access, forms, or state-changing requests.
- Abuse controls: fixed terrain, mesh and particle budgets, fixed physics step,
  bounded playback speed, bounded camera, capped device pixel ratio; hidden tabs
  pause. No request-supplied scene data or executable content.
- Request / upload limits: static GET/HEAD assets only; no uploads or input API.
- Output contexts: authored HTML, CSS, WebGL, and textContent for instruments.
  No user HTML, inline handlers, eval, query-string settings, or remote embeds.
- Private storage / delivery: none. No cookies, analytics, persistence, or
  personally identifying data. Retention: simulation state ends with the page.
- Outbound services: none at runtime. NASA source links are ordinary optional
  links. All rendering assets and decoder dependencies are vendored locally.
- Cache: public non-personal assets, existing static-serving cache policy.
- Security logs: no new server operations to log. Client loading / WebGL errors
  present a recoverable, generic error message without sending diagnostics.
- Required negative checks: reject nonfinite / out-of-range simulation inputs;
  bounded advancement; safe failure without WebGL or missing model; no external
  asset requests, no persistence, no mutations to application data.
- Legacy dependencies: existing static game mount only. No route, middleware,
  environment variable, migration, secret, or Cloudflare exception is added.
  Rollback: remove this folder.

## Historical sources

Consulted and visually inspected before implementation:

- [Apollo 11 photographs, NASA](https://www.nasa.gov/wp-content/uploads/static/history/ap11ann/kippsphotos/apollo.html):
  AS11-40-5927 (lander structure / foil / landing gear), AS11-44-6574 (in-flight
  configuration), AS11-37-5454 (surface and shadows), AS11-40-5864 (engine bell).
- [Apollo lunar module 3D model, NASA / Michael D. Carbajal](https://science.nasa.gov/3d-resources/apollo-lunar-module/).
- [Apollo lunar descent and ascent trajectories, NASA](https://www.nasa.gov/wp-content/uploads/static/history/alsj/nasa58040.pdf).
- [Apollo post-shutdown dust observations, NASA Lunar Surface Journal](https://www.nasa.gov/wp-content/uploads/static/history/alsj/WOTM/WOTM-A17DustObscur.html).

This is an interpretive simulation, not a reconstruction of Apollo 11 telemetry
or a surveyed landing site. The procedural terrain, guidance, exhaust visibility,
and particle density are visual approximations. The crew remain inside the
pressurized cabin throughout landing.

## Run and controls

The normal application discovers games at startup. After its next normal
restart, open `/moon-landing/` or choose **Moon Landing** in `/games`.
For an isolated preview from the repository root, without database startup or
maintenance hooks:

```sh
python3 -m http.server 8095 --bind 127.0.0.1 --directory games
```

Open `http://127.0.0.1:8095/moon-landing/`. Serve over HTTP; ES modules and Draco
workers do not support opening the HTML directly with `file://`.
The Games backlink belongs to the parent application.

- **Begin descent** starts at 1,000 m above the approach terrain. The initial
  paused preview is at 24 m. Approximate flight time: 111.5 seconds, followed by
  24 seconds on the surface. Autopilot flies the complete landing.
- **Space** toggles playback; **R** restarts. Keyboard shortcuts leave focused
  form controls and buttons to their native keyboard behavior.
- **1–4** choose tracking, wide, fixed surface, and commander-window views.
  Drag / pinch / scroll orbit and zoom in tracking and wide views. **H** hides
  instruments; an explicit button restores them.
- The timeline and altitude milestones pause for inspection. Playback offers
  1×, 2× and 5× speeds. A completed flight can be replayed with Play.
- Mission notes contain the references and approximations. Fullscreen is
  available where supported. Exterior audio is silent in vacuum. Switching
  away from the tab pauses playback. There is no automatic camera movement
  or autoplay, including for reduced-motion users.

## Implementation

`physics.js` integrates translation, lunar gravity, thrust, fuel use, engine lag,
and rate-limited attitude control at 60 Hz. A finite, precomputed trajectory
makes replay and scrubbing deterministic. Altitude in the physics table is
relative to the touchdown datum; displayed radar altitude subtracts the local
height field. The initial height includes the approach terrain elevation.

`terrain.js` supplies seeded mare relief, 457 craters across local and distant
terrain, and lunar curvature. Four terrain resolutions, surface microrelief,
instanced stones, hard sunlight, regolith bounce, and locally adapted NASA
spacecraft materials make up `world.js`. All feet meet the zero-height patch.

Dust follows gravity-driven ballistic paths. Precomputed terrain collisions
end each particle's lifetime. Fast, low-angle ejecta and slower post-cutoff
outgassing populations are distinct. Soft streaks represent unresolved groups
of grains, with intentionally increased optical weight for visibility.
Particles are capped at 24,000 on desktop / 12,000 on narrow screens. The
exhaust is a faint, expanded, softened cone clipped at the surface. No wind,
buoyant smoke, stars at daylight exposure, or atmospheric sky is added.

The ship is approximately 7.04 m tall. Contact probes fold at the ground; engine
cutoff occurs near 1.15 m, followed by a roughly 2.00 m/s touchdown, a small
damped gear response, and permanent rest with zero thrust. This simplified
guidance is deliberately not advertised as authentic Apollo telemetry.

Device pixel ratio and camera motion are bounded. Paused scenes render only
when the view or time changes; hidden tabs do not render. Very slow rendering
can slow playback because elapsed-frame advancement is capped at 100 ms.
Missing assets and unavailable/lost WebGL present a reloadable error screen.

## Validation

```sh
npm test -- tests/unit/moonLanding.test.js --coverage=false
npm test -- --runInBand
```

The focused suite covers descent convergence, propellant / impulse consistency,
vacuum ballistics, engine cutoff, touchdown and rest, deterministic seeking,
bounded invalid inputs, terrain continuity, anonymous asset access, path
traversal denial, public mutation denial, and inert query-string markup.

An optional Playwright check uses a separately installed Playwright module; it
does not add a dependency to this repository:

```sh
node games/moon-landing/docs/validation/browser-check.cjs /path/to/playwright http://127.0.0.1:8095 /tmp/moon-check
```

See [the three review sessions](docs/validation/review.md) and
[browser results](docs/validation/browser-results.json). Asset origins and
licenses are in [assets/CREDITS.md](assets/CREDITS.md) and
[vendor/README.md](vendor/README.md).
