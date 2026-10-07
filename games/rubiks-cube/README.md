# Rubik’s Cube Studio

Open `/rubiks-cube/` from the site's Games directory. The existing game-directory discovery serves this folder automatically. No build, database, environment variables, migration, or server changes are needed.

Play with the face buttons or U/R/F/D/L/B keys (Shift reverses a turn). Drag the cube to inspect it; arrow keys also change the view when the canvas has focus. Scramble makes 25 random legal turns. Undo reverses a player turn. Reset restores a solved cube.

In Show solution, use the current game or paint all six faces of a physical 3×3 cube. The fixed centers define the reference frame: white up, green front, red right, yellow down, orange left, blue back. The face-entry guide explains how to orient each face without mirroring it. A cube with a different color scheme can be entered by mapping its six center colors to these six labels, preserving the spatial relationships. The solver rejects incorrect counts, missing/duplicate pieces, flipped edges, twisted corners, and parity errors.

Solutions use a two-phase search, not a beginner layer-by-layer lesson or a guaranteed shortest solution. The player explains each turn, highlights the face, and provides play/pause, forward, backward, replay, and speed controls. Pause finishes the current turn before stopping; switching away from the tab also pauses. The initial solver-table setup may take several seconds. Work runs in one local Web Worker with a 45-second deadline and a cancel button. A timeout or cancellation terminates the worker, and retry creates a fresh one.

## Security contract

- Feature: Rubik’s Cube Studio; security zone: **fully-public**.
- Interactive principals: anonymous (admin/family/user have the same public access). Machine principals: none.
- Data classification: public game assets; entered cube state exists only in browser memory.
- Capabilities/object scope/admin override: none; no account or server data operations.
- Browser mutations and CSRF: local memory only; no state-changing HTTP routes or session writes, so CSRF is not applicable.
- Abuse controls/limits: exactly 54 allowlisted facelets; valid piece/orientation/parity checks before solving; a single worker, one request at a time, maximum search depth 22, 45-second deadline. UI bounds move history to 1,000 turns and scrambles to 25 turns.
- Output contexts: canvas plus DOM textContent and fixed element attributes; no user HTML, URL, or script interpolation.
- Private files/uploads/outbound hosts/services: none. Scripts, styles, and solver are served locally; no runtime CDN or analytics.
- Cache policy: static public assets may use the existing static-file cache policy. Cube state is never sent to the server or stored persistently.
- Security-relevant logs: no new server operations; failures are shown in the local status region without cube contents or stack traces. Existing static-server error handling applies.
- Retention: browser-memory state is discarded on reload; worker is terminated on cancellation, timeout, or page exit.
- Negative tests: malformed/oversized input, wrong counts/centers, invalid/duplicate pieces, edge flip, corner twist, permutation parity, invalid moves, worker timeout/cancel/error and malformed responses.
- Legacy dependency: existing public static-game delivery only; no legacy authorization or data access. No Cloudflare exceptions, secrets, new network endpoints, or migration. Rollback: remove this game directory.

## Implementation and dependencies

`js/core.js` contains validation, notation, scramble generation, and facelet geometry. `js/renderer.js` draws and animates cubies with Canvas 2D software projection, requiring no WebGL. `js/solver-worker.js` runs the solver; `js/solver-client.js` owns its lifecycle; `js/app.js` owns UI state and playback.

The unmodified, MIT-licensed **cubejs 1.3.2** browser files are vendored from `https://registry.npmjs.org/cubejs/-/cubejs-1.3.2.tgz`. Upstream: https://github.com/ldez/cubejs. Only `lib/cube.js`, `lib/solve.js`, and the license are included; no npm dependencies or install scripts are used. The application dependency manifest and lockfile are unchanged.

SHA-256:

- `vendor/cube.js`: `450a53a9acf5033fde7ca23be8fd08ac37d30f04c58aac63f053a1c05a7f5802`
- `vendor/solve.js`: `faa0ccffca78f80a5fe7a197a9676af02d79d8ddece9cf3506154fea616fc445`
- `vendor/LICENSE.cubejs`: `c067e8c9a595d13f5644f94388f2ad32c725bcb4a5b1851fe769b9bccd46a1fd`

## Verification

Run `npm test -- tests/unit/rubiksCube.test.js tests/unit/rubiksCubeSolver.test.js --coverage=false --runInBand` for cube, rendering-geometry, search, and worker-lifecycle checks. Run `npm test` for repository regression tests.

Run `node games/rubiks-cube/tests/browser-smoke.cjs` with an existing Playwright installation (`PLAYWRIGHT_MODULE` and optionally `CHROMIUM_PATH` may select local installations). It starts and stops an isolated static server, checks the real manual-entry and solution flow on desktop/mobile, and writes screenshots to the operating system temporary directory. No project dependency installation is needed when Playwright is already available.

For a database-free preview, serve this directory at `/rubiks-cube/` and `public/css` at `/css/` with a local static server. Do not use `npm start` just to preview this game. Browser checks should cover desktop/mobile, drag/touch and keyboard turns, scramble/undo/reset, invalid entry, physical-cube input, solution computation, pause/resume/back/replay, cancellation, and reduced motion. The game uses the shared `/css/color-theme.css`; the six conventional sticker colors are intentionally distinct from interface tokens.
