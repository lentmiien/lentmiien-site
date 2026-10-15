# Validation — 2026-10-15

## Automated checks

- Node **24.20.0**, the repository's Volta pin.
- Focused model/security suite: **15 passed**. Covers deterministic browser/CommonJS model loading, seed-to-giant playback, pause, reset, speed changes, monotonic bounded growth, continued growth in old age, branch emergence, stationary camera framing and its lock, time-step limits, hidden-tab behavior, malformed input, logarithmic controls, local asset boundaries, and vendor checksums.
- Full repository suite: **386 passed, 8 skipped**; **5,009 tests passed, 122 skipped**. Coverage thresholds passed. No application startup, database lifecycle, setup pipeline, or production services were launched for this feature.
- Browser suite: **54 passed**, **0 uncaught runtime errors**, Chromium **153.0.8010.12** with headless SwiftShader. Desktop 1440 × 1000, laptop 1024 × 768, phone 390 × 844, landscape 844 × 390. Detailed results: [browser-results.json](validation/browser-results.json).
- Rendering on the sampled growth stages: **16–21 draw calls**, at most **112,146 triangles** including the measured shadow pass, **20 geometries**, **7 textures**, and a fixed allocation of **30,240 foliage planes**. Repeated scrubbing preserves those memory counts. These are workload measurements, not a physical-device frame-rate claim.
- Syntax checks and whitespace checks passed. Vendored Three.js files match the repository's installed `three@0.185.1` exactly.

## Browser coverage

Actual WebGL rendering from seed to ancient tree; seed germination; play/pause and live speed changes; visible growth during playback; stationary landmarks and branch attachments; new branches appearing; automatic camera pullbacks; framing lock and Fit; scrubbing in both directions; natural completion at 3,000 years; restart; drag orbit; keyboard orbit/elevation/zoom; camera height slider and buttons; reset framing; automatic orbit; single-finger orbit; two-finger zoom and vertical movement; touch cancellation; help-dialog pause/resume; background-tab suspension; reduced motion; responsive layout and panel containment; local-only runtime requests; absent WebGL; missing renderer modules; and WebGL context loss.

Visual review covered the seed, 1-year seedling, 5-year sapling, 50-year young tree, 500-year mature tree, 3,000-year giant, closer bark view, laptop, portrait phone, and landscape phone, plus playback comparisons in both young and ancient growth. Fixed ground texture precision, branch development, crown density, and framing were refined during this revision.

## Visible-growth regression checks

The browser suite measures the actual trunk mesh projected through the rendered camera, using ordinary playback between captures. It checks both camera position and focus stay fixed during each comparison; it does not infer visual growth from the property panel.

| Playback interval | Projected tree height | Projected base width |
| --- | --- | --- |
| About 50 → 102 years | 276.1 → 453.5 px (**+64.3%**) | 12.9 → 24.2 px (**+87.9%**) |
| About 1,500 → 2,510 years | 381.6 → 441.2 px (**+15.6%**) | 48.8 → 57.9 px (**+18.7%**) |

Both intervals produce new branches, while existing branch attachment heights stay unchanged. Ground geometry, soil texture scale, stone transforms, and the scale figure remain identical across growth. A separate playback check crosses a framing boundary and verifies the camera pulls back with the trunk and leader still inside the viewport. The lock also holds through timeline changes, and Fit releases it.

## Screenshots

- [Seed — desktop](validation/seed-desktop.png)
- [Ancient giant — desktop](validation/ancient-desktop.png)
- [Mature tree — mobile, full page](validation/mobile.png)
- Young-tree playback: [before](validation/young-growth-before.png), [after](validation/young-growth-after.png), with identical camera framing.
- Ancient-tree playback: [before](validation/ancient-growth-before.png), [after](validation/ancient-growth-after.png), with identical camera framing.

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
