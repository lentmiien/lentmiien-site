# Seed to Sky

A standalone, fully public 3D giant-sequoia growing simulation. Open **`/tree-growth/`** on the site; the existing game discovery automatically lists this folder. No build step, account, network services, or database is needed.

For an isolated preview, run `python3 -m http.server 8768 --bind 127.0.0.1 --directory games/tree-growth` from the repository root, then open `http://127.0.0.1:8768/`. Do not use the application startup pipeline just to preview this game.

## Experience

Start with a seed and grow through 3,000 years. Pause, change the continuous speed slider (0.1–200 simulated years per second), or scrub the lifetime at any point. Drag to orbit; scroll or pinch to zoom; right-drag, Shift-drag, or use the elevation slider to move the camera's focus up and down the tree. Two-finger dragging also changes elevation. The camera automatically follows growth while preserving the chosen angle, elevation, and relative zoom. Reset view restores the whole-tree composition. A separate reset returns the simulation to the seed.

The scene uses local Three.js, procedural bark and soil textures, a ridged tapering trunk, branching limbs, thousands of instanced evergreen sprays, soft shadows, atmospheric fog, and subtle wind. Geometry and draw counts remain bounded throughout the lifetime. Reduced-motion preferences disable wind and automatic orbit. Hidden tabs stop advancing time.

## Model and sources

This is an illustrative healthy-tree model under favorable conditions, not a forestry prediction. Height approaches 92 m; the trunk thickens throughout the lifetime. Crown proportions and branch retention change with age. Carbon is an estimate from tapered trunk volume × 420 kg/m³ dry wood density × 50% carbon; it excludes branches, foliage, roots, soil, decay, and disturbance. Displayed diameter is at the trunk base, not breast height. Growth rings are completed model years, not a rendered cutaway. The timeline uses a logarithmic scale to make early growth accessible.

Species references: [NPS giant sequoias](https://www.nps.gov/seki/learn/nature/bigtrees.htm), [NPS General Sherman measurements](https://www.nps.gov/seki/learn/nature/sherman.htm). These inform the species, scale, bark, and changing silhouette, rather than validating the simplified growth equations. Three.js: [InstancedMesh documentation](https://threejs.org/docs/pages/InstancedMesh.html).

## Security contract

- Feature: Seed to Sky, an entirely client-side public game.
- Security zone: fully-public. Interactive principals: anonymous, admin, family, and user all have the same public access. Machine principals: none.
- Data classification: public assets and ephemeral local simulation state. Capabilities: none required for public reads. Object scope: none. Admin override: no.
- Browser mutations / CSRF: no server mutations, forms, API calls, or sockets. Controls only change in-memory scene state; CSRF is not applicable.
- Abuse controls / limits: numeric inputs reject non-finite and non-number values, age is bounded to 0–3,000 years, speed to 0.1–200 years/s, time steps to 0.1 s, camera and pixel ratio are bounded, and geometry uses fixed budgets. No upload or user-supplied resource URLs.
- Output: fixed HTML, external scripts/styles, DOM updates through textContent and numeric properties. No inline handlers or user HTML.
- Private storage / delivery: none. Outbound services: none; all runtime dependencies are local. Source links only navigate after an explicit user click.
- Cache: static non-personal public assets may use the existing public static-server cache policy. No personalized responses, analytics, cookies, localStorage, or service worker.
- Logs: no new server operations or operational logging path. Renderer/module failures and WebGL context loss display generic actionable reload guidance locally, without disclosing internals.
- Retention: state is discarded on reload; reset deletes the current in-memory tree age. No persisted personal data.
- Negative checks: malformed and excessive numeric input, bounded geometry, hidden-tab timing, local-only requests, missing renderer modules, absent WebGL, and context loss.
- Legacy dependency / migration: existing static game discovery only. No new application routes, environment settings, credentials, migrations, or Cloudflare exceptions. Roll back by removing this folder.

## Validation

Run the model and security tests using the pinned Node version:

```sh
npm test -- tests/unit/treeGrowthGame.test.js --coverage=false --runInBand
```

Browser validation instructions and results are in `docs/VALIDATION.md`. The vendored renderer is the same pinned Three.js release already used by this repository; its license and provenance are in `vendor/`.
