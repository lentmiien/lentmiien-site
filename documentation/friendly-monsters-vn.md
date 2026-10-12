# Friendly Monsters — production and security contract

Feature: Japanese narrated visual novel, 「ともだちと、とんでもない幸運」.
Security zone: fully-public. Interactive principals: anonymous. Machine principals: none.
Data classification: public original fiction, illustrations and synthesized narration.
Capabilities: none (read-only public game). Object scope: none. Admin override: no.
Browser mutations and CSRF: no server mutations; bounded local progress/preferences only.
Abuse controls: static files only, no generation API, uploads, remote URL parameters or database work.
Request limits: no request bodies; existing static middleware handles GET/HEAD and confined paths.
Output contexts: reviewed static HTML, escaped textContent, local allowlisted asset paths.
Storage: explicitly public production assets in games/friendly-monsters/assets; no private app media reused.
Outbound services: none at runtime. Offline original art uses built-in image_gen; speech uses local VOICEVOX.
Cache policy: public nonpersonal static assets, existing revalidation defaults; no immutable unversioned URLs.
Logs: no new server operations; browser asset errors are visible with retry/manual recovery, no personal telemetry.
Retention: browser save lasts until cleared by reader/browser; public release assets live with source history.
Negative tests: invalid stored state, blocked storage, unsafe asset paths, stale playback, failed/blocked audio, bounded preload, static traversal/no side effects.
Legacy dependencies: existing Games static discovery; no private GPT Image route or service used.
Deployment: source and committed optimized assets must ship together. No environment variables or DB migrations.
Production deployment is explicitly out of scope for this development session. Push a feature branch only; no merge/restart/deploy.
Rollback: revert the release commit in a later reviewed deployment; remove the game directory and its discovery/mount entries together.
Cloudflare: ordinary public static caching is acceptable; no Access bypass or new edge rule required.

## Content and release verification

Implementation completed on 2026-10-13 on `feat/friendly-monsters-vn`. Independent review pass #2 was completed on the same feature branch after baseline `f234678bf03b5a899f437400b1f287fed88f19e9`; its fixes and verification are recorded below. Human deployment remains separate.

- Canonical route: `/games/friendly-monsters/`, linked from `/games` with the Japanese title. Compatibility route: `/friendly-monsters/`.
- 17 complete chapters, 112 staged scenes, 388 narration/subtitle beats; 27,793 spoken Japanese characters including the book title, chapter introductions and closing sentence (punctuation included).
- Audio: 388/388 actual MP3 files, 4,615.656 seconds (76m 55.656s at 1×), no missing clips. The finale alone has 67 beats and 663.192 seconds (11m 3.192s) of narration.
- Art: 55/55 actual WebP files: 20 location/variant backgrounds, 17 distinct event CGs, 12 lead sprites (three expressions each for Sam, Zord, Garon, Jane), and six supporting sprites (Franza, Lulu, Koron, Noro, Vald, Hana). All 18 sprites have real alpha. No placeholder assets or runtime generation.
- The entire game directory is approximately 61 MiB. All runtime files and optimized media are committed together. WAV masters and superseded audio remain in ignored `tmp_data/friendly-monsters/`; source image masters remain in Codex's generated-images directory. Neither is required for deployment.
- `scripts/friendly-monsters/inventory.json` contains machine-readable counts. `asset-integrity.json` records SHA-256, sizes, and image dimensions for all 443 runtime media assets.

### Player behavior

Manual previous/next controls, automatic audio-end progression, chapter selection, browser-local resume, repeat and timestamp-preserving pause/resume, volume and separate mute, four playback speeds, scalable Japanese text, keyboard controls, visible loading/failure/retry states, text-only fallback, and an explicit ending. Subtitle beats display their full text immediately; their progress indicator follows the real audio clock, and automatic advancement follows `ended`, with a 650ms pause. This is beat-level synchronization, not phoneme karaoke. When narration is disabled, automatic reading uses a clearly separate text-length delay.

Entering the menu, hiding the tab, or leaving the page pauses the current clip and disables automatic advancement. A fresh reader gesture resumes at the same timestamp; navigation and reset discard the old clip. Resume never restores autoplay. Old promises/events/timers cannot advance a later chapter. Only current/next-beat images are candidates for preload (maximum eight deduplicated paths); narration loads one clip at a time. Event illustrations use contain framing so the full composition remains visible.

The UI uses the shared Graphite/Ember/Golden Amber theme, 44px minimum controls, responsive layouts, reduced-motion support, labeled controls, image descriptions, native dialog focus behavior, and optional live subtitle announcements when narration is disabled. No background music competes with narration.

### Review pass #1 closure

| Finding | Resolution |
| --- | --- |
| Birthday used great-grandmother kitchen | Added forest birthday background `bg20`; `bg16` is reserved for Hana's kitchen. |
| Ordinary home already decorated for festival | Added undecorated home `bg18`; `bg13` is used for the actual festival. |
| Market behind sickroom and Franza advice | Added bedroom `bg19`; advice explicitly transitions to terrace `bg05`. |
| Open treasure chest revealed before discovery | Slime rescue uses forest `bg01`; shrine `bg04` appears only after the chest is opened. |
| Mud CG showed detached bones after reassembly | Regenerated `cg02` with reassembled Sam riding Garon on the finished path. |
| Boot CG invented a fitting board | Regenerated `cg07` with a paper sole tracing and mountain oracle setting. |
| Pot left pedestal without cause | Dog follows the bread smell after the trio escapes, removes the pot, closes the gate, and exits via its own low passage. |
| Engine security/recovery unverified | Added focused negative validation, audio lifecycle, DOM interaction, complete-script traversal, and static middleware tests. |

Additional illustration review removed Jane from trio-only chapters 2, 4, 7, 10, and 15; chapter 4 now distinguishes Garon from the musical rock giant. The finale establishes a verified ceasefire, consent from affected communities, non-invasion, restitution, shared water measurements, public trade rules, relief, neutral dispute resolution, and subsequent implementation difficulties and prosperity. Kindness and luck open negotiations; they do not replace accountability or agreement.

### Asset production and reproducibility

Artwork was generated with the built-in `image_gen` tool and visually inspected, using the established first event illustration for character/style consistency. Targeted edits fixed cast and continuity. Prompt provenance is in `art-direction.json` and `art-corrections.json`; Japanese scene descriptions are in `art-descriptions.json`. Optimized final images are copied into the game, not referenced from a Codex-local directory. No image API key or AI Gateway was needed.

Narration uses the installed `generate-local-tts` skill's foreground, serialized `generate_tts.py`, Japanese female `ja_shikoku_metan_normal` (VOICEVOX:四国めたん, style 2). Each chunk is hashed with the voice identifier. FFmpeg converts the WAV to mono MP3 using `libmp3lame -q:a 2`; it never substitutes browser speech synthesis. The source WAV is retained. A long process terminated after 317 clips; bounded, resumable batches completed all remaining clips without duplicating active jobs. No generation job remains required.

Rebuild/revalidate from the repository root:

```sh
# Recompile and probe existing audio. Never invents duration or missing media.
python3 scripts/friendly-monsters/build.py
# Only after an intentional script change: synthesize missing hashed clips serially.
python3 scripts/friendly-monsters/build.py --narrate --limit 40
# Override --tts-script if the local skill is installed elsewhere.
node scripts/friendly-monsters/verify.js
```

The builder only writes `story.json` when every referenced image and narration exists. After intentionally replacing assets, use `node scripts/friendly-monsters/verify.js --write` to record the new integrity inventory, review it, then run verification without `--write`. Archive superseded unreferenced clips outside the game directory before verification. Do not commit WAV masters.

The TTS service was reachable at `127.0.0.1:50021`; no authentication intervention was necessary. For a later connection failure, the safe read-only diagnostic is `curl --max-time 5 http://127.0.0.1:50021/version`. Restarting/reconfiguring a missing engine is an operator action; do not read `.env` or print tokens. Image CLI fallback requires explicit selection and locally configured credentials per the image skill; this release requires neither regeneration service in production.

### Verification and handoff

Original implementation validation (before review #2): `npm test -- --runInBand` passed **379 suites / 4,842 tests**; eight suites / 117 tests were skipped by the existing suite configuration. Coverage thresholds passed. The focused game/integration run passed 57 tests before adding the complete-real-script traversal test; that additional test passed in the full run. `node scripts/friendly-monsters/verify.js` passed for all 442 media assets.

- Focused Jest suites cover hostile paths, malformed manifests, malformed/out-of-range storage, storage denial, source release completeness, bounded preload, real audio-clock progress, stalled/blocked/failed audio, stale promises/events, automatic/manual progression, menu cancellation, retry, resume/reset, keyboard navigation, all 387 actual story beats, and the final ending.
- HTTP tests exercise the same guarded static middleware as the application, using an ephemeral local server with no database. Anonymous GET/HEAD and both route mounts work; POST and encoded/ordinary traversal fail; WebP MIME and MP3 byte ranges work.
- `verify.js` decodes every WebP and MP3, checks no symlinks/path escapes, confirms exact narration coverage of every source paragraph plus spoken chapter headings, rejects missing/orphan assets, and verifies all checksums.
- Original art and corrected CGs were visually inspected. The available computer-use tool reported `apps: [], browsers: []`; creating an in-app browser returned `Browser is not available: iab`. Consequently this session does **not** claim desktop/mobile browser screenshots, audible listening QA, or real-browser autoplay QA. DOM tests are not a substitute for those human checks.
- No `npm start`, `setup.js`, `app.js` launch, production restart, deployment, database maintenance, or production mutation was performed.

For isolated visual/audio review:

```sh
node scripts/friendly-monsters/preview.js
# Open http://127.0.0.1:8097/games/friendly-monsters/
```

This loopback-only preview serves just the game and shared CSS. Check desktop and narrow/mobile widths, all settings, first/last chapters, chapter jumping during speech, replay after ending, app backgrounding, blocked autoplay, network failure/retry, screen-reader navigation, and representative spoken names. Stop the preview with Ctrl-C.

### Production asset delivery (human, after review #2)

1. Fetch and review the pushed feature branch; integrate its exact release commit through the normal deployment process. No database migration or new environment variable is needed.
2. Deliver the **entire** `games/friendly-monsters/` tree, including all 55 WebPs, 388 MP3s, `story.json`, HTML, JS and CSS. Include the `app.js` discovery/alias change and the existing `/css/color-theme.css`. These files are all in git; there is no separate private-media upload or generation step.
3. In the staged release checkout run `node scripts/friendly-monsters/verify.js` and focused tests. For a clean install use the repository's normal `npm ci`; do not run `npm start` merely as an asset check because its prestart mutates data.
4. Use the normal human-approved deployment/restart procedure; verify `/games` links to `/games/friendly-monsters/`, narration byte ranges work, and assets remain public nonpersonal static files. Regeneration services are not runtime dependencies.
5. Roll back by reverting this release as a unit. Do not deploy a new manifest against an old asset set.


### Independent review pass #2 — 2026-10-13

Reviewed the clean `feat/friendly-monsters-vn` baseline, root AGENTS.md, security framework, player/core/CSS, all chapters, build/verification tooling, actual media, and the Games discovery/mount code. This is a fully public static reader with no server mutation or runtime outbound service. No production app, setup pipeline, DB or scheduler was started.

Confirmed defects and fixes:

- Playback previously discarded position on stop/menu/backgrounding. Pause/resume now retains one clip and its timestamp, invalidates pending play promises/handlers, and stops autoplay on browser interruptions. Navigation still releases the old source. Mute preserves the configured volume.
- Repeated buffering events could renew the timeout indefinitely; playback now requires actual clock progress within 20 seconds. Replay during the 650ms end gap now cancels the queued advance. Regression tests cover short clips ending before `play()` resolves, stale errors/ends, and all 388 beats advancing automatically across chapters into the ending.
- Image preloading used to stop updating while the current art stayed the same, missing upcoming scene changes. It now refreshes the bounded adjacent window on every beat.
- Reset and terminal navigation could leave keyboard focus on hidden/disabled controls. Focus now returns to the start, subtitle, or ending as appropriate; ending offers restart. Shortcuts ignore links, summaries, editable elements and modified keys. Silent narration enables live subtitles; safe-area padding supports notches/home indicators.
- The book title and the closing prose existed outside the narration. The title is now included in the first clip, and the closing sentence is a final narrated beat. Existing v1 beat positions are unchanged; old settings safely default the new boolean mute field. Saves resume at a beat boundary after reload, not mid-clip.
- Audited every chapter's source staging. Added location transitions when leaving the river, town, mill, waterworks, temple or returning home; removed the intact Sam sprite during his disassembly and pot-wearing sprite while his pot is absent/damaged; removed Jane from the trio-only boot outing; delayed the chapter 4 reunion and chapter 14 illustration until the depicted cast arrives. The finale signing CG now appears at the treaty signing, while the anniversary uses the forest festival CG. Scene count increased from 83 to 112 without expanding the plot.
- Edited `cg14.webp` through the built-in imagegen skill: the cooperative resolution now shows Sam and Zord on the ground, an upright recovered cart, seedling baskets and intact vegetable beds. Inspected the generated output and shipped a 1600×900 WebP. Exact edit prompt and provenance are in `art-corrections.json`; alt text was updated.

Media provenance and delivery:

- Original production provenance is documented by the committed art-direction/correction prompts and the builder's serialized `generate-local-tts` invocation (`ja_shikoku_metan_normal`, VOICEVOX style 2). The original session's raw tool transcript was not available from its session URL in this workspace, so this review does not independently authenticate those historic tool calls.
- This review directly used built-in imagegen for the snail correction and the installed local TTS skill for two clips: replacement first clip `c01-b001-27a0bf6c73db.mp3` and new closing clip `c17-b067-0bfc29f8676f.mp3`. The builder used the WAV-to-MP3 skill's FFmpeg/libmp3lame VBR quality 2 conversion; WAV masters remain outside the release. The old first clip was archived outside the game.
- All 443 runtime media files are ordinary git blobs, not LFS pointers or external downloads. Image dimensions/alpha, complete audio decoding, confined paths, exact spoken-script coverage and SHA-256 inventory were reverified. No runtime reference uses a developer home directory, remote generation service or private media path.

Independent checks:

- Focused tests: 58 passing across the three VN suites and Games view suite. Static integration now executes the actual app Games discovery/mount/route block in an isolated Express harness, without importing app startup. It verifies the Japanese Games entry, slash redirects, both public mounts, anonymous GET/HEAD, POST denial, traversal denial, MIME and MP3 byte ranges.
- Full `npm test -- --runInBand`: **379 suites / 4,858 tests passed**, with coverage thresholds met; existing 8 suites / 117 tests skipped. Final staging-only cast adjustments were followed by the focused suites and asset verification. No dependencies were added.
- Headless **Chromium 153.0.8010.12** ran using the already installed Playwright library and cached executable. Genuine MP3 decoding/clocks, two complete naturally ending clips, a natural chapter boundary, pause/resume/menu, volume/rate/mute, reload resume, source release/no overlap, network failure/retry, a 20-second hung audio request, chapter jump during loading, and the real closing clip/finale/restart were exercised.
- Text-only traversal visited every beat and loaded every displayed image. Captured 17 chapter and 17 CG screenshots plus 1440×1000 desktop, 390×844 and 320×568 portrait, 844×390 landscape, settings, finale and touch-mobile emulation. Inspected contact sheets of all 55 actual images and selected full-size art/runtime captures. Japanese text at 150% wraps without horizontal overflow; longer mobile text scrolls vertically. Reduced-motion CSS was checked. Safe-area behavior on physical devices remains a human check.
- Browser `NotAllowedError` was deliberately mocked to test recovery into text-only autoplay. Unit tests use audio mocks for exhaustive stale-event/all-beat progression. These are distinct from genuine Chromium media playback.
- FFmpeg level analysis of all 17 chapter introductions found mean levels −25.8 to −24.3 dB and peaks −7.0 to −5.4 dB: non-silent and consistent, with no sampled peak clipping. This is automated analysis, **not audible listening or transcription**. Pronunciation, naturalness, actual speakers/headphones, Safari/iOS restrictions and assistive-technology announcements require human verification. No claim of having listened to all 77 minutes is made.

Run focused checks from the repository root:

```sh
npm test -- tests/unit/friendlyMonsters.test.js tests/unit/friendlyMonstersPlayer.test.js tests/unit/friendlyMonstersStatic.test.js tests/unit/gamesView.test.js --coverage=false --runInBand
node scripts/friendly-monsters/verify.js
```

Reproduce the browser review without committed dependencies:

```sh
node scripts/friendly-monsters/preview.js
# In a second terminal, use your existing Playwright installation and Chromium:
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROMIUM_EXECUTABLE=/absolute/path/to/chrome \
node scripts/friendly-monsters/browser-check.js
```

The browser script targets loopback port 8097 only, writes evidence to `/tmp/friendly-monsters-review2` by default (`VN_REVIEW_OUTPUT` can override it), and closes Chromium. The preview's Games page is a minimal link; the actual production Games route is tested separately by the isolated HTTP integration suite. Stop the preview when done. No `npm start` or production configuration is required for either harness.

### Deploy and verify this reviewed release (Lennart)

1. Fetch `origin/feat/friendly-monsters-vn`. Review and integrate the **full release commit hash supplied in the review handoff** through the normal deployment branch/process. Include baseline `f234678bf03b5a899f437400b1f287fed88f19e9` and the review fixes together; do not deploy only a subset of media or the manifest.
2. Ship the complete `games/friendly-monsters/` tree: 20 backgrounds, 17 event CGs, 18 alpha sprites, 388 MP3s, manifest, HTML, JS and CSS. Include the implementation's `app.js` discovery/alias changes and shared `/css/color-theme.css`. Ordinary git checkout supplies everything; **no LFS, external asset upload or generation on production** is needed.
3. Runtime uses the existing Express/static stack and Node pinned in `package.json` (24.20.0). There are no new runtime packages, env vars, migrations, builds, VOICEVOX/image APIs or FFmpeg requirements. For a fresh staged checkout use normal `npm ci`. Asset verification is a staging/development operation requiring FFmpeg on PATH and installed `sharp`: `node scripts/friendly-monsters/verify.js`. Run the focused test command above. Do not run the builder or `npm start` as a verification step.
4. Publish source/media atomically using the usual approved deployment mechanism; restart/reload the existing site process so app Games discovery includes the new game. The repository handoff does not specify a process-manager/service command: use the site's established one. No separate frontend build step exists. If an edge/proxy/browser has cached the unversioned player/manifest/images, invalidate `/games/friendly-monsters/*` and `/friendly-monsters/*` (especially `story.json`, `core.js`, `player.js`, `style.css`, `index.html`, `assets/images/cg14.webp`); hard-refresh for acceptance. Existing static cache revalidation remains in effect.
5. Verify anonymously at `/games`, follow the Japanese entry to `/games/friendly-monsters/`, and confirm images and MP3 byte ranges return 200/206 with no authorization prompts or remote-generation requests. The compatibility route `/friendly-monsters/` should also work. Public nonpersonal caching is allowed; no new Cloudflare rule or Access bypass is needed.
6. Roll back the integrated feature as a unit through the normal deployment procedure, restoring matching source/manifest/media and app mounts together; invalidate the same URLs. No DB rollback is involved.

Human acceptance checklist:

- Games entry opens the correct title; desktop, portrait and landscape show readable Japanese over clear separate art layers, with settings/controls reachable and no notch obstruction.
- Listen to title, representative dialogue/names (サム、ゾード、ガロン、ジェーン、フランザ、ヴァルド) and closing sentence. Confirm 四国めたん voice, pronunciation, comfortable volume, mute/unmute and speed on real output devices.
- Enable autoplay and let it cross a scene and chapter without a click. On Safari/iOS verify a fresh gesture starts sound and subsequent clips continue; check short clips too.
- Seek with next/back and chapter selection during loading/speech. Pause/resume mid-clip, open/close settings, and background/return: no overlap, stale advance or unexplained restart; autoplay stays off after interruption.
- Reload and use Continue; verify the saved chapter/beat and settings return without automatic sound. Clear bookmark and restart using keyboard/touch; check focus and screen-reader announcements.
- Read/listen through the extended chapter 17: signing CG at signing, anniversary in the forest, complete closing narration, stable ending and restart. Test network failure/retry and text-only fallback once.

No production deployment was performed by review #2.
