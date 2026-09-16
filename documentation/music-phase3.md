# Music client Phase 3: ACE-Step and YuE2

## Status and primary contract

Historical Phase 3 implementation record. The user has since confirmed successful
live ACE and YuE2 generation and shared-library persistence. For the pending
full-song rollout, follow [Phase 4](music-phase4.md), which supersedes the old
duration limits and deployment/rollback order below: **Site first, then Gateway**.
Do not repeat prior-phase confirmation or revert the old Gateway artifact parser
after producing long outputs.

Development implementation only. This change does not deploy Gateway or Site,
start/stop a live container, download weights, generate audio, or establish
browser playback quality. The registry fixture comes from the public literals
in `ai-services/ai-gateway/music_models.py` at the approved Phase 2 revision
`27e4ab289ce1dff29ddf8a063879b6f117d529a9`. The authoritative operator reference
is that repository's `documentation/gateway/music-gateway-usage.md` and
`yue2/PHASE2-HANDOVER.md`.

Gateway first, Site second. The observed missing YuE2 admin card was deployment
lag: the committed Gateway already registers `yue2` even when disabled. The
Site's container cards remain dynamic; no synthetic YuE2 container or health
status is added. `/admin/ai-gateway` now presents actual `/music/models`
capabilities and `/limits.music` beside the existing generic controls and
counts both `music_generate` and historical `music_acestep15_generate` logs.
Historical logs without a model are labeled unknown.

## Security contract

- Feature: shared authenticated music library, model-aware generation and admin tests.
- Security zone: logged-in.
- Interactive principals: admin; family/user/custom roles with explicit music grants.
- Machine principals: none; outbound Gateway access uses configured trusted server networking.
- Data classification: private prompts, lyrics, generation metadata and audio.
- Capabilities: `music.library.read`, `music.library.write`,
  `music.generation.create`, `music.gateway.manage`.
- Role assignment: admin bundle has all four; family/user bundles have none by
  default. The existing group/per-user `music` grant maps, via the shared
  authorization evaluator, to read/write/generate. Explicit semantic grants
  also work. Both read and generate are required to generate on `/music`.
  The existing admin route mount still restricts administrator pages.
- Object scope: the library is one shared collection among authorized music
  members, including historical records. Read, random selection, AI examples,
  rating, deletion from the library, and played timestamps all use this same
  declared shared scope. Rating 0 removes the shared record, not the Gateway
  file. New in-memory jobs use validated immutable principal IDs and owner
  checks. Ordinary audio access requires a matching persisted shared record.
  A known but unpersisted Gateway path is insufficient authority.
- Admin override: `music.gateway.manage` allows job inspection and the confined
  finalized-output explorer. Admin test generations are saved to the same shared
  library. There is no owner fabrication or destructive migration.
- Browser mutations: POST (and existing admin DELETE), shared session CSRF token
  plus existing Origin/fetch-site checks. No mutating GET. Private no-store
  responses, no analytics, same-origin native audio playback.
- Abuse/work bounds: 32 KiB/30 fields per generation request; caption 512 ACE or
  2000 YuE2 characters, lyrics 6000; YuE2 combined NFC text 16000 UTF-8 bytes and
  ABC 4096 bytes; AI direction 2000 characters. Five submissions/user/minute;
  one active job/user, three global and one background job per Site process, at most 200
  retained jobs. Reservation occurs before discovery/AI/database awaits.
  The background unplayed gate remains shared and stops at two tracks.
- Timing: discovered queue and execution budgets, plus preparation (900 sec)
  and cleanup (600 sec) allowances and 60 sec transport margin. If later
  discovery supplies preparation/cleanup budgets, use those with bounds.
  Total transport budget is at most five hours; unsupported timing configuration
  fails before dispatch. AI prompt creation is 60 seconds, no SDK retries,
  at most 6000 output tokens. No automatic music resubmission exists.
- Lifecycle operations: stop transport 120 seconds, start/restart 900 seconds,
  using Gateway operation defaults and generic registry identifiers; one POST
  only. A lost response asks for status refresh, never retries. Manual YuE2
  start/restart reserves exclusive GPU access; normal generation starts lazily.
- Rendering: Pug escaping, `safeJson` for embedded data, escaped browser text.
  Metadata is bounded to depth 6, 512 nodes, arrays 32, strings 4096 and total
  strings 32768 characters; secret/path/URL/prompt keys are omitted. Prompt and
  lyrics are stored separately as bounded library fields. Provenance/settings
  are serialized for tracks; player shows generator, exact seed, format and
  crop/truncation state. Historical absent values remain unknown.
- Private media: Gateway output mounts remain outside Site `public`. No local
  media copy or transcoder. Proxy accepts bounded relative audio paths only,
  preserves opaque `yue2:<id>/audio.flac|wav` namespaces, disables redirects,
  forwards GET/HEAD and Range/If-Range, and retains 206/416 and relevant headers.
  Upstream bodies for errors are suppressed; stream errors/disconnects clean up.
- Outbound: only server-configured `AI_GATEWAY_BASE_URL`, with fixed music paths,
  and the existing OpenAI SDK for optional prompt creation. Browser receives no
  Gateway base URL or admin credential. Admin token stays server-side.
- Logs: shared production logger records discovery, authorization, generation,
  listing/persistence and stream failures using stage/status and opaque job ID;
  no prompts, raw provider error bodies or credentials. AI music requests opt
  out of existing API debug payload logging.
- Retention: active jobs never expire on the former one-hour timer. Terminal
  jobs expire one hour after completion/failure. Jobs are intentionally not
  durable across Site restarts; missing/foreign jobs return the same 404 and
  are never recreated or replayed. Library records and Gateway files survive.
- Required negative tests: capability/CSRF/foreign jobs, rejected provider fields,
  unsafe seed/input/path/returned output, unsupported/disabled discovery,
  output authorization, admission races, failed finalization, lost transport,
  private rendering and no retry.

## Client behavior and compatibility

`/music` and `/admin/music-test` share the catalog, validator, job runner and
controls. ACE stays the default. Switching model changes caption length,
required lyrics, available formats, duration semantics and settings. Gateway
capability defaults/limits drive controls and server validation within the
reviewed contract. ACE retains instrumental/BPM/language/duration/LM controls
and adds bounded synthesis steps/guidance/batching. YuE2 never receives those
fields, even false values.

Each provider retains its own seed when switching in either direction,
including a blank random seed and explicit zero. Manual, AI and Infinity form
submissions omit a blank seed and preserve explicit decimal values exactly.
Restoring settings never converts seed strings through JavaScript numbers;
the existing server input range validation still applies.

YuE2 requires singing lyrics; full/melody/none planning, optional ABC, FLAC/WAV
and a current testing duration **ceiling** of 8–30 seconds (default 20) are
available. This is not a target length or a whole-model inherent limit. Blank
seed means omission/random allocation once; zero is preserved. The input UI
accepts nonnegative safe JavaScript integers through 9007199254740991. Direct
ACE form requests retain -1 random semantics. Larger returned seeds, including
nested `resolved_settings.config.seeds`, are parsed from original JSON numeric
tokens using Node 24's reviver source and stored/serialized as exact decimal
strings. They are never rounded and then stringified.

AI creates only caption/lyrics. The model, seed, format, ceiling and other
settings remain those selected by the user. Infinity clearly identifies its
background generator; shared playback may include either model and historical
tracks. It suppresses overlapping submissions and pauses automatic generation
after failed/ambiguous requests or unrecoverable polling. It does not resume by
resubmitting the last request. Failed jobs also block that user's background
admission while retained. Inspect outputs before deciding on another manual
request; a page reload is not proof that an earlier generation stopped.

Only `/music/models` **404** permits ACE-only legacy fallback with an old-release
notice. Other discovery failures disable generation while retaining playback.
An explicit YuE2 request never falls back to ACE. Legacy output aliases support
both namespaces, so the playback proxy uses the historical alias on either
Gateway release. Safe non-audio listing entries are ignored; unsafe or unrelated
paths fail the job. Completion requires bounded job-filtered output listing and
all required database writes. Persistence/listing failure remains a failed Site
job even when the Gateway has generated audio; inspect via the admin explorer.
No idempotency or async Gateway job API is invented.

The `outputPath` unique index is unchanged. Existing music records are neither
renamed nor backfilled with guessed models/providers/owners. Other collection
readers keep their existing shared/historical policy. No new environment
variables, dependencies, migrations or system-wide installs are required.

## Historical Phase 3 release steps (superseded by Phase 4)

1. During a maintenance window, deploy the approved Gateway Phase 2 commit
   first, following its handover. Enable `YUE2_ENABLED=true`; preserve ACE enabled,
   output/data mounts and the installed batching override. Do not reset or
   replace those deployment settings. Stop any standalone manual generation
   before using the shared scheduler. Do not upgrade model pins opportunistically.
2. Verify actual `/containers` and `/health` include managed `yue2`,
   `/music/models` returns `yue2-3b` with the expected configured/enabled state,
   and `/limits.music` exists. Disabled remains a real registered service;
   stopped/startable is usable with automatic lazy start. No manual load/unload
   endpoint exists. Confirm private proxy auth on output GET **and** HEAD, both
   new and legacy paths, and private caching; preserve Range/If-Range headers.
3. Deploy this Site commit with Node **24.20.0** through the normal operator
   workflow. Avoid restarting while jobs are active. This development task did
   not run `npm start`/`setup.js`, which can mutate data or synchronize Dropbox.
   Ensure reverse-proxy upstream timeouts permit the documented music operation
   budgets; do not treat an HTTP timeout as permission to replay generation.
4. Open `/admin/ai-gateway`: verify dynamic YuE2 card, startable wording,
   discovery defaults/limits, and mixed-model statistics. Exercise one generic
   start/stop/restart at a time if needed; inspect status after uncertain outcomes.
   Release any manual reservation before mixed-provider generation tests.
5. In `/music`, generate ACE with default settings and explicit seed 0, then
   YuE2 with required lyrics, seed 0, full planning and 20-second ceiling. Verify
   displayed/persisted model, seed, format, settings/provenance and actual
   duration/cropping. Repeat YuE2 with WAV and an omitted seed; do not infer
   deterministic GPU output merely from seed preservation.
   Before submitting, check blank ACE seed → YuE2 seed 123 → ACE restores
   blank, and repeat with the providers reversed. Check zero and the largest
   accepted input seed (9007199254740991) also survive switching exactly.
6. Play, pause and seek native FLAC and WAV on target devices using the
   authenticated Site URLs. Check HEAD has no body; range requests return 206
   with correct Content-Range; unsatisfiable ranges return 416. Play a historical
   ACE record with unknown model and a namespaced YuE2 record. Confirm logged-out
   requests and unpersisted arbitrary paths fail. No device playback claim is
   established by the Node/JSDOM tests.
7. Select YuE2, change ceiling/planning/format, use AI-assisted generation, then
   enable Infinity: confirm those settings persist and the selected background
   generator is explicit. Test ACE AI/Infinity too. Complete one admin test for
   each provider and browse outputs by the returned job ID. Verify another
   authorized member can use the shared saved library but cannot read the
   submitter's private job; admin inspection is intentional.
8. Check production logs for actionable failures, particularly stage `outputs`
   or `persist`. Do not retry ambiguous generation blindly: inspect finalized
   outputs and Gateway logs. In-memory jobs lost to restart require operator
   reconciliation; the explorer does not automatically import orphan files.

## Rollback

- Prefer disabling YuE2 dispatch with Gateway `YUE2_ENABLED=false` and recreating
  only the Gateway according to its operator handover. Leave ACE enabled and
  retain outputs/manifests/mounts. The updated Site reports disabled state;
  previously saved YuE2 and ACE files remain playable.
- If reverting Site code, use its prior known-good commit through the normal
  deployment workflow after active jobs settle. Do not delete added MongoDB
  fields, change the output index, or remove historical files. The old UI cannot
  identify YuE2 metadata and its playback proxy lacks this Range/HEAD behavior;
  retain the updated Site when playback of mixed-model records matters.
- A Gateway rollback older than Phase 2 leaves ACE fallback, but cannot be relied
  on to serve YuE2 namespaces. Preserve Phase 2 output routing or accept that
  YuE2 playback remains unavailable until that release is restored. Never
  destructively migrate paths to work around a rollback.

## Initial development verification (2026-09-16)

- Pinned Node 24.20.0, no dependency or lockfile changes.
- Focused music/security/dashboard/OpenAI checks: 16 suites, 208 tests passed.
- Final `npm test -- --runInBand`: 300 suites passed, one skipped; 3114 tests
  passed, four skipped, zero failures; configured coverage thresholds passed.
- Final targeted template/dashboard checks after review: 23 tests passed.
- Earlier implementation/test-fixture failures were corrected; none remain.
  No existing skipped tests were enabled or removed. `git diff --check` passed.
- Tests use mocked Gateway/OpenAI/database responses, local HTTP fixtures,
  Pug rendering and JSDOM. No live generation, downloads, deployments or
  device/browser playback verification occurred. Gateway worktree stayed clean
  at `27e4ab2`.

## Seed regression verification (2026-09-16)

This follow-up fixes blank seed restoration after switching providers and
omits blank seeds from manual, AI and Infinity submissions. It supersedes the
initial Site release candidate `448c832378125ac9848db73f1c381531e0b46f07`;
release the follow-up commit containing this fix through the main-chat approval
workflow. No deployment or Ask Lennart call was made.

- Added 72 tests: repeated switching in both directions for blank, zero, 123,
  maximum safe input and larger exact decimal seeds; serialized requests for
  both providers/pages and all three submission modes; safe input acceptance
  and fractional/malformed/unsafe input rejection. Larger restored decimal
  strings remain exact, but are still rejected as new input above the safe limit.
- Before implementation, the new UI suite reproduced 14 blank-seed failures.
  A separate new test initially assumed the existing server rejects scientific
  notation; it was corrected to test fractional input without changing validation.
- Final focused run: 11 suites, 253 tests passed; zero skipped or failed.
  Coverage was disabled for this focused run because its unrelated global
  coverage targets are checked by the full suite.
- Final full run: 300 suites passed, one skipped; 3186 tests passed, four skipped,
  zero failures. All configured coverage thresholds passed. The skipped suite
  is the existing opt-in Windows private-media ACL suite, unavailable on Linux.
- Both runs used Node 24.20.0 and emitted only the expected experimental VM
  modules warning. `git diff --check` passed. No dependencies, configuration or
  migrations changed. No production actions, GPU inference or actual browser
  testing were performed.

Exact final commands:

```sh
volta run --node 24.20.0 npm test -- --runInBand --coverage=false tests/unit/musicUi.test.js tests/unit/musicGatewayService.test.js tests/unit/musicIntegration.test.js tests/unit/musicJobs.test.js tests/unit/musicOutputProxy.test.js tests/unit/musicDashboard.test.js tests/unit/adminRoleManagement.test.js tests/unit/sessionCsrf.test.js tests/unit/authorization.test.js tests/unit/openaiApiConversion.test.js tests/unit/templateService.test.js
volta run --node 24.20.0 npm test -- --runInBand
git diff --check
```

## Main implementation files

- `services/musicGatewayService.js`, `utils/losslessJson.js`: shared discovery,
  provider validation, transport budgeting, confined output listing and exact seeds.
- `services/musicJobService.js`, `controllers/musiccontroller.js`,
  `models/music_generation.js`: bounded jobs, AI/manual/admin orchestration,
  shared persistence, resolved settings/provenance and failure recovery messages.
- `services/musicOutputProxy.js`: private authorized GET/HEAD/Range streaming.
- `utils/musicAuthorizationPolicy.js`, `middleware/musicAccess.js`,
  `routes/music.js`, `routes/admin.js`, `app.js`: semantic membership mapping,
  owner-scoped job status, admin scope, session CSRF and bounded body parsing.
- `views/music_library.pug`, `views/admin_music_test.pug`,
  `views/partials/music_controls.pug`, `public/js/music_controls.js`,
  `public/js/music_library.js`: shared model-aware forms and native player.
- `controllers/admincontroller.js`, `views/admin_ai_gateway.pug`,
  `public/js/aiGateway.js`: actual registry/capabilities/limits, mixed music
  statistics, lifecycle budgets and dashboard CSRF.
- `utils/OpenAI_API.js`: opt-in bounded, private structured prompt request.
- `tests/unit/music*.test.js`, `tests/fixtures/music/models.json`, and focused
  updates to existing admin-role/OpenAI tests: contract and regression coverage.
