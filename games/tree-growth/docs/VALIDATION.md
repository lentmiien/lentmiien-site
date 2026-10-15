# Validation — 2026-10-15

## Automated checks

- Node **24.20.0**, the repository's Volta pin.
- Focused model/security suite: **11 passed**. Covers deterministic browser/CommonJS model loading, seed-to-giant playback, pause, reset, speed changes, monotonic bounded growth, time-step limits, hidden-tab behavior, malformed input, logarithmic controls, local asset boundaries, and vendor checksums.
- Full repository suite: **386 passed, 8 skipped**; **5,005 tests passed, 122 skipped**. Coverage thresholds passed. No application startup, database lifecycle, setup pipeline, or production services were launched for this feature.
- Browser suite: **39 passed**, **0 uncaught runtime errors**, Chromium **153.0.8010.12** with headless SwiftShader. Desktop 1440 × 1000, laptop 1024 × 768, phone 390 × 844, landscape 844 × 390. Detailed results: [browser-results.json](validation/browser-results.json).
- Rendering on the sampled growth stages: **10–11 draw calls**, at most **155,124 triangles** including the measured shadow pass, **11 geometries**, **7 textures**, and a fixed allocation of **20,160 foliage planes**. Repeated scrubbing preserves those memory counts. These are workload measurements, not a physical-device frame-rate claim.
- Syntax checks and whitespace checks passed. Vendored Three.js files match the repository's installed `three@0.185.1` exactly.

## Browser coverage

Actual WebGL rendering from seed to ancient tree; seed germination; play/pause and live speed changes; scrubbing in both directions; natural completion at 3,000 years; restart; drag orbit; keyboard orbit/elevation/zoom; camera height slider and buttons; reset framing; automatic orbit; single-finger orbit; two-finger zoom and vertical movement; touch cancellation; help-dialog pause/resume; background-tab suspension; reduced motion; responsive layout and panel containment; local-only runtime requests; absent WebGL; missing renderer modules; and WebGL context loss.

Visual review covered the seed, 5-year sapling, 50-year young tree, 500-year mature tree, 3,000-year giant, closer bark view, laptop, portrait phone, and landscape phone. Ground tiling, seed framing, portrait framing, and a laptop panel overflow were corrected during review.

## Screenshots

- [Seed — desktop](validation/seed-desktop.png)
- [Ancient giant — desktop](validation/ancient-desktop.png)
- [Mature tree — mobile, full page](validation/mobile.png)

## Reproduce

Serve only this game from the repository root:

```sh
python3 -m http.server 8768 --bind 127.0.0.1 --directory games/tree-growth
```

Run the focused Jest test:

```sh
npm test -- tests/unit/treeGrowthGame.test.js --coverage=false --runInBand
```

With Playwright available in a separate developer environment:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROMIUM_PATH=/absolute/path/to/chromium \
node games/tree-growth/tests/browser-smoke.cjs
```

`TREE_GROWTH_URL` overrides the default `http://127.0.0.1:8768/`; `TREE_GROWTH_OUTPUT` overrides `/tmp/tree-growth-validation`. The browser harness instruments the model and renderer in intercepted test responses only. The shipped app exposes no test API. Browser automation is a developer-only optional tool and is not a new npm dependency.

## Practical limits

WebGL 2 is required. Physical GPU performance, real touch hardware, Safari, and Firefox have not been measured. Browser emulation verified touch interactions and responsive layout. Growth and carbon are explicitly illustrative; this is not a validated forestry model. The app deliberately does not persist progress across reloads.

The existing server discovers game folders at startup, so restart an already-running application through its usual deployment process to mount `/tree-growth/`. The dynamic `/games` listing then links to the entry automatically. No new server code, environment variables, dependency changes, or migrations are required.
