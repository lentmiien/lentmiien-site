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

Implementation completed on 2026-10-13 on `feat/friendly-monsters-vn`. This is an implementation release after the supplied read-only review pass #1; the coordinator's independent review pass #2 and human deployment remain separate.

- Canonical route: `/games/friendly-monsters/`, linked from `/games` with the Japanese title. Compatibility route: `/friendly-monsters/`.
- 17 complete chapters, 83 staged scenes, 387 narration/subtitle beats; 27,757 spoken Japanese characters including chapter introductions (punctuation included).
- Audio: 387/387 actual MP3 files, 4,609.776 seconds (76m 49.776s at 1×), no missing clips. The finale alone has 66 beats and approximately 11 minutes of narration.
- Art: 55/55 actual WebP files: 20 location/variant backgrounds, 17 distinct event CGs, 12 lead sprites (three expressions each for Sam, Zord, Garon, Jane), and six supporting sprites (Franza, Lulu, Koron, Noro, Vald, Hana). All 18 sprites have real alpha. No placeholder assets or runtime generation.
- The entire game directory is approximately 61 MiB. All runtime files and optimized media are committed together. WAV masters and superseded audio remain in ignored `tmp_data/friendly-monsters/`; source image masters remain in Codex's generated-images directory. Neither is required for deployment.
- `scripts/friendly-monsters/inventory.json` contains machine-readable counts. `asset-integrity.json` records SHA-256, sizes, and image dimensions for all 442 runtime media assets.

### Player behavior

Manual previous/next controls, automatic audio-end progression, chapter selection, browser-local resume, repeat/stop narration, volume, four playback speeds, scalable Japanese text, keyboard controls, visible loading/failure/retry states, text-only fallback, and an explicit ending. Subtitle beats display their full text immediately; their progress indicator follows the real audio clock, and automatic advancement follows `ended`, with a 650ms pause. This is beat-level synchronization, not phoneme karaoke. When narration is disabled, automatic reading uses a clearly separate text-length delay.

Entering the menu, hiding the tab, or leaving the page stops playback and automatic advancement. Resume never restores autoplay. Old promises/events/timers cannot advance a later chapter. Only current/next-beat images are candidates for preload (maximum eight deduplicated paths); narration loads one clip at a time. Event illustrations use contain framing so the full composition remains visible.

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

Final validation: `npm test -- --runInBand` passed **379 suites / 4,842 tests**; eight suites / 117 tests were skipped by the existing suite configuration. Coverage thresholds passed. The focused game/integration run passed 57 tests before adding the complete-real-script traversal test; that additional test passed in the full run. `node scripts/friendly-monsters/verify.js` passed for all 442 media assets.

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
2. Deliver the **entire** `games/friendly-monsters/` tree, including all 55 WebPs, 387 MP3s, `story.json`, HTML, JS and CSS. Include the `app.js` discovery/alias change and the existing `/css/color-theme.css`. These files are all in git; there is no separate private-media upload or generation step.
3. In the staged release checkout run `node scripts/friendly-monsters/verify.js` and focused tests. For a clean install use the repository's normal `npm ci`; do not run `npm start` merely as an asset check because its prestart mutates data.
4. Use the normal human-approved deployment/restart procedure; verify `/games` links to `/games/friendly-monsters/`, narration byte ranges work, and assets remain public nonpersonal static files. Regeneration services are not runtime dependencies.
5. Roll back by reverting this release as a unit. Do not deploy a new manifest against an old asset set.
