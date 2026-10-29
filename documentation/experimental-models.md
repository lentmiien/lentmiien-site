# Experimental Models admin lab

## Delivery status

`/admin/experimental-models` is the permanent admin Tools entry. The implemented
adapters support all seven verified WeVis tasks and all seven Ming tasks. Forms,
private inputs/results, asynchronous Site jobs,
polling, request/response inspectors, audio playback/download, optional region
overlays, session clear and absolute expiry are implemented and tested locally.
These are experimental integrations, not live model qualification.

Ming reference-conditioned `TTS`, `MULTILINGUAL`, `BASIC`, `EMOTION` and `DIALECT`
are implemented, with a runtime gate requiring Site credentials and Gateway
`ephemeral_reference.version === 1`. The supplied contract is Gateway commit
`0a1b33ba6d357c1c2a896ffe444b82f1f85e147c`, documented there in
`documentation/gateway/ming-ephemeral-reference.md`. **Both Gateway and Ming worker
must be updated; that deployment is not part of this change.** Missing advertisement
or HTTP 404 means unsupported Gateway; HTTP 501 means worker update required.
Reference-free tasks remain available independently of this gate.

Site never registers persistent voices, lists the private catalog, accepts existing
voice IDs or deletes voices. There is no task named `CLONE`, podcast generation,
speaker-embedding operation or multilingual control/tag support.

The supplied verified Gateway contracts are the implementation authority. No live
Gateway fetch, inference, GPU operation, deployment, database mutation or personal
sample was needed for this source/mocked-test phase.
## Security contract

- Zone: **logged in**, true authoritative admin role plus
  `experimental.models.manage`; admin bundle only, family/user empty. Per-user
  grants cannot bypass the role gate. No machine principals or admin override.
- Scope: account ID **and** opaque server-side browser-session binding for every
  session, input, job and result. GETs issue bindings but never infer or mutate jobs.
  Dispatch rechecks the live login session, cookie expiry, current database account
  and semantic capability, with a 10-second deadline and bounded DB query.
- Mutations: shared `sessionCsrf` header before bounded parsers. No GET mutations.
  Runs require strict UTF-8 JSON with unique keys, at most 16 KiB; unknown fields,
  query parameters, compressed bodies and caller-selected destinations fail closed.
- Limits: 120 API reads/requests per minute/admin, 12 mutations/minute/admin; one
  upload parser and storage/decode operation at a time; 30-second upload/JSON receive
  deadline. Storage contention returns 429; the single worker waits for the lock.
- Images: exactly one PNG/JPEG/WebP part, at most 8 MiB plus 8 KiB multipart overhead,
  extension/MIME/decoded format agreement, one frame, 16 million decoded pixels,
  sides 32–16384, aspect ratio ≤200, ten-second decode limit. Sharp applies EXIF
  orientation, converts to RGB, strips metadata and re-encodes PNG without resizing.
  The PNG must also fit 8 MiB. TIFF/BMP/GIF/PDF/SVG, URLs and base64 are not accepted.
- References: exactly one WAV part on the Site upload route, at most 6 MiB plus
  8 KiB multipart overhead. Content must be PCM16LE mono/stereo, 16–48 kHz, 1–30
  seconds. RIFF size, chunks, format, byte rate, alignment, duration and truncation
  are checked; a `.wav` filename alone is insufficient. No automatic MP3 conversion
  or recording. Transcript and consent are submitted separately with each run.
- Quotas: eight files/results and eight jobs per session; 32 MiB/session,
  64 MiB/admin, 256 MiB/global; two sessions/admin, sixteen global. Queued/active jobs
  reserve maximum result bytes and a file slot. All accounts/logins count. Manifests
  are capped at 256 KiB. Actual manifest bytes (including sanitized prompts and
  transcripts) count toward quotas, with 2 KiB reserved for terminal job metadata
  growth. References, raw JSON and WAV results all count, including across restarts.
- Storage: `EXPERIMENTAL_MODELS_STORAGE_ROOT` (default `private_data/experimental-models`), outside all static mounts, UUID names,
  0700 directories/0600 files, ancestor/ownership/symlink checks, bounded single-link
  reads and atomic synced manifests. No original filenames or browser paths persisted.
- Delivery: account and login checks on files and polls; two simultaneous bounded
  streams, 30-second idle timeout, backpressure/disconnect cleanup, correct PNG/JSON/
  WAV MIME, attachment, nosniff, sandbox CSP and private/no-store. Page CSP restricts
  scripts/connections/media to Site. Analytics are disabled.
- Rendering: escaped Pug and DOM textContent; no model HTML or inline SVG strings.
  Region geometry is validated server-side and again before creating SVG elements;
  labels are inert titles. Full sanitized JSON/raw model text are private downloads;
  inspector previews truncate at 65,536 characters. Audio is binary WAV, not a
  fabricated Gateway JSON response; displayed metadata is explicitly Site-parsed.
- Outbound: fixed configured HTTP origin, fixed endpoints, no redirects/proxies,
  no browser URLs/headers/tokens. Explicit Run forwards input to AI Gateway. Capability
  checks are passive GETs only and cannot enable unimplemented tasks. No chat, history,
  document, embedding or model-default workflows are used.
- Secrets/errors: Ming credential never enters browser state, manifests, request
  inspectors or logs. Known credentials and common token patterns are redacted from
  text inspectors/results. Arbitrary Gateway `detail` strings, objects and validation
  inputs are deliberately omitted (they can contain private inputs and host paths).
  Safe HTTP status messages, recognized batch-busy code and allowlisted headers remain.
  Logs use `utils/logger`, category `experimental_models`, stable failure messages,
  status/code only; never request/client config, provider exceptions or model text.
- Retention: absolute 24-hour TTL; reads deny immediately on expiry, never slide it.
  Sweep every minute independent of DB readiness. Clear marks delete-pending, stops
  admission and cancels local queued jobs. Active request/download leases defer purge
  until no local file use remains. Closing the browser does not cancel or clear.
- Deployment topology: one Site process owns this filesystem store and queue. Multiple
  processes must not share it. Distributed ownership/locking is required before scaling.
  Existing Windows private-storage ACL checks also apply; failure disables storage.

## Verified WeVis boundary

All tasks use `POST /perception/wevisone-vl` multipart with exactly one each of
`file`, `task`, `query` and `max_new_tokens`. Generic `/ocr` is never used.

| Task | Query |
| --- | --- |
| `ocr` | Literally empty, including no whitespace |
| `detection` / `point` | Required object descriptions; multiple labels separated by newlines |
| `referring` | Required expression; commas/phrases are preserved |
| `count_box` / `count_point` | Required description of what to count |
| `ocr_grounding` | Required text to find |

Queries are capped at 1024 before trim and reject angle brackets and controls other
than newline/tab. Maximum new tokens is integer 1–4096, default 1024. The actual
input plus output budget must fit 8192; Gateway can still reject it. Multipart is
capped at 8,404,992 bytes. No visual prompts, boxes as input, arbitrary prompt, video,
batch, segmentation, masks, matting or crop/rotation parameters.

Success requires HTTP 200, no-store, JSON ≤1 MiB, schema v1, `complete: true` and
`finish_reason: stop`. There is **no** WeVis X-Generation-Complete requirement.
Schema/model/task, original dimensions, resizing metadata, supported shapes,
normalized/fractional pixel geometry, count consistency, ≤1024 regions and
≤262144 raw-text characters are checked. Coordinates/preview use EXIF-oriented
original image space. OCR text order is model generation order, never sorted.
No fake confidence, layout, processed image, masks, timing or token usage.
Nonterminal/rejected output creates no partial artifact; Gateway does not return
failed raw model output, so the lab does not pretend it exists.

## Verified Ming boundary and configuration

Set `MING_ADMIN_TOKEN` privately on the **Site server**, matching the existing
Gateway Ming credential. Never copy the value into the repository or browser.
It is sent solely as
`X-Ming-Token` on `/tts/ming/*` requests; never substitute `LLM_ADMIN_TOKEN`, the
batch token or an API key entered in the browser. No usable default exists. Missing
Ming configuration returns 503 before any network request, including discovery.
Rotation takes effect through the process environment on restart. No secret value
belongs in docs or git.

Reuse `AI_GATEWAY_BASE_URL` (existing default `http://192.168.0.20:8080`). It must be
an HTTP(S) origin with no embedded credentials, path, query or fragment. The new
`EXPERIMENTAL_MODELS_TIMEOUT_MS` defaults to 2,000,000 ms; allowed 2,000,000–2,400,000.
It bounds the complete outbound request, including connection/queue/preparation/
inference/read, alongside axios byte limits. A 900-second queue plus 120-second
preparation plus 630-second upstream budget and cleanup are why a two-minute proxy
or 900+630 end-to-end assumption is unsuitable. Browser HTTP runs return 202 quickly;
no browser request must stay open for inference.

`POST /tts/ming/tasks` JSON ≤16384 bytes:

- `VOICE_DESIGN`: `language` explicitly `zh`/`en`, nonblank `text` ≤500,
  required `controls.style` ≤512, no instruction/reference or other controls.
- `FREEFORM`: `language` explicitly `zh`/`en`, nonblank `text` ≤500,
  required `instruction` ≤512, empty/omitted controls, no reference.
- `max_decode_steps`: integer 8–400, default 200; booleans rejected.
- Length checks precede trim; angle brackets and controls except newline/tab rejected.
  Text accepts only the fourteen documented case-sensitive tags, inserted at cursor
  by UI buttons. Unknown/malformed square brackets fail. Inactive fields are omitted.

`POST /tts/ming/tasks/ephemeral` has exactly four multipart parts, serialized by
Site with a library-generated boundary and known bounded Content-Length:

| Part | Contract |
| --- | --- |
| `file` | Validated owned WAV bytes; fixed transport filename `reference.wav`, never a Site ID or path |
| `request` | UTF-8 JSON **text part**, ≤16,384 bytes; only `task`, `text`, `language`, `controls`, `max_decode_steps` |
| `transcript` | Nonblank, ≤2048 Unicode characters AND ≤8192 UTF-8 bytes; no angle brackets or controls except newline/tab |
| `consent` | Text exactly `true`, derived from the user's affirmative unchecked-by-default checkbox |

Whole Gateway multipart body is ≤6,320,128 bytes. Gateway upload read timeout is
30 seconds and its pending ephemeral limit is four, including queued requests;
Site still forwards only one job globally. Site validates task JSON before admission
and before serialization. The `fileId` in the browser's Site request is only a lookup
in that same account, login and test session. It never enters Gateway JSON. The
bounded private file is read through a checked handle; no external URL/path or
cross-session asset can select a source. Generated audio may be downloaded and
manually uploaded if it fits the reference limits; affirmative consent is still needed.

| Task | Languages | Controls |
| --- | --- | --- |
| `TTS` (default) | zh/en | None |
| `MULTILINGUAL` | ja/ko/de/fr/es | None; no speech tags |
| `BASIC` | zh/en | At least one of speed/pitch/volume |
| `EMOTION` | zh/en | Exactly emotion |
| `DIALECT` | zh | Exactly dialect |

Explicit language and nonblank text ≤500 are required. Decode steps are integer
8–400, default 200; booleans are rejected. The existing zh/en tag rules also apply.
Exact enum values behind translated UI labels: speed 慢速/中速/快速; pitch and volume
低/中/高; emotion 高兴/悲伤/愤怒/恐惧/厌恶/惊讶/中性; dialect `chuanyu dialect` /
`cantonese`. Unknown keys, mixed controls, instructions, `reference_id`, `voice_id`,
`reference_language`, URLs and paths are rejected. `VOICE_DESIGN` and `FREEFORM`
remain JSON-only and reject reference inputs. There is no persistent fallback.

Fictional Site run (IDs are placeholders from an owned upload/session; include the
current login cookie and shared `X-CSRF-Token`, never a Ming token):

```http
POST /admin/experimental-models/api/sessions/11111111-1111-4111-8111-111111111111/experiments/ming-tts/runs
Content-Type: application/json

{"task":"BASIC","language":"en","text":"Synthetic demonstration.","controls":{"speed":"慢速"},"max_decode_steps":200,"fileId":"22222222-2222-4222-8222-222222222222","transcript":"Synthetic reference.","consent":true}
```

After scope and capability checks, the complete logical Gateway form is:

```text
POST <server-configured AI_GATEWAY_BASE_URL>/tts/ming/tasks/ephemeral
X-Ming-Token: <server-injected; never shown in inspectors>
Content-Type: multipart/form-data; boundary=<library-generated>
Content-Length: <computed bounded byte count>

file (filename=reference.wav, Content-Type=audio/wav): <owned validated WAV bytes>
request (text): {"task":"BASIC","text":"Synthetic demonstration.","language":"en","controls":{"speed":"慢速"},"max_decode_steps":200}
transcript (text): Synthetic reference.
consent (text): true
```

This example's consent represents an explicit user action, not a default. Request
inspectors show sanitized structured field values and WAV metadata, never binary,
base64, credentials or filesystem paths. Failed responses never become WAV files.

Success requires HTTP 200, no-store, audio/wav and `X-Generation-Complete: true`.
RIFF/WAVE length and chunks, PCM16LE mono, actual 16–48 kHz sample rate, positive
≤60-second duration and ≤6 MiB are validated. The pinned runtime is 44100 Hz; Site
parses the actual rate. Budget exhaustion or invalid/nonterminal audio is an error,
not partial success. No invented transcripts, model/latency headers, seed or streaming.

## Discovery and inspectors

The explicit availability buttons call passive
`GET /perception/wevisone-vl/capabilities` or `GET /tts/ming/capabilities`, then
`GET /limits`. `/limits` never receives the Ming token. Discovery exposes available,
recognized container state, optional-installation boolean, experimental status and
numeric limits under the two successors plus queue/upstream timeouts. Verified
controls/tasks live in the replaceable registry; unknown provider fields never create
UI operations. `runtime_verified` remains false: installation is not qualification.
No private `/voices` catalog or `/queue`/`/gpu` inference is used. OCR model metadata
is optional and is not fetched.

Discovery has a bounded two-model, 60-second cache (including failures) with
concurrent request coalescing; no periodic warm-up or inference. Ming configuration
is checked before cache access. Reference admission and dispatch recheck capability
support through that cache; browser controls only enable after a successful check.
An unsupported backend, a failed availability check, supported-but-unavailable Ming,
and a runtime job failure have distinct UI messages. HTTP 501 asks for the worker
update and leaves other adapters usable. All controls remain experimentally
unqualified until separately tested on the deployed runtime.

Safe raw response headers: Content-Type, Content-Length, Cache-Control,
X-Generation-Complete, and numeric Retry-After bounded to one day. No header dumps.
For error bodies, the safe recognized `gpu_batch_session_busy` code and retry delay
are retained; other arbitrary detail content is omitted. No unbounded automatic retry
or force-stop of somebody else's work.

## Site jobs, clear and restart

One globally forwarded request and four locally pending jobs, at most one active/
pending job per session. Existing Local AI and EmbeddingGemma job facilities were
inspected: they carry persistent feature/provider semantics unsuitable for this
small isolated lab. The local queue uses the existing private store and manifests.

States: `queued` (Site only), `waiting_gateway` (queue/preparation/inference cannot
be distinguished), `succeeded`, `failed`, `cancelled` (never forwarded), `interrupted`
(completion unknown). Site elapsed time starts at admission. No upstream job ID,
position, progress, active-cancel endpoint, GPU-free badge or release claim exists.

Clear returns 200 when removed or **202 deletePending** when leases remain. Browser
polls the owned session list until it disappears. Delete-pending sessions refuse new
runs and uploads; a session with a pending job refuses another run. Results received
after clear/expiry are discarded. A restart cancels queued
jobs and records in-flight jobs interrupted/unknown, without replay; the old process
has no remaining local writers/streams, so private files can be cleaned. Remote
inference might still finish independently. Timeout/disconnection also gives unknown
completion and no retry. It never proves the GPU stopped. No remote voices exist in
this implementation to delete or reconcile.

Gateway owns bounded request memory and the worker's private 0600 anonymous memfd.
There is no registry entry, disk spool, transcript journal, scratch file or persistent
voice artifact. Normal completion closes the descriptor; cancellation/failure retains
ownership for reclamation. Unknown termination can leave cleanup pending, with no
hard memory-erasure deadline. HTTP 200 and Site clear do not prove GPU shutdown,
immediate remote cleanup or secure forensic erasure. Site deletes its own WAV
references, manifests (prompts/transcripts/job records), raw results and outputs when
local leases close. Browser clear removes drafts, consent and media sources too; no
object URLs, localStorage or permanent history are used. Logout denies access and
queued dispatch; inaccessible data still expires under the same 24-hour policy.

## Routes

All relative to `/admin/experimental-models`, with the same admin/capability guards,
private/no-store policy and owner+login scope on objects:

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/` | Lab forms, inspectors, results and cleanup UI |
| GET | `/api/experiments` | Verified static registry and Site limits; no discovery |
| GET | `/api/experiments/:experimentId/capabilities` | Bounded passive availability/limits |
| GET / POST | `/api/sessions` | List / create owned sessions |
| GET / DELETE | `/api/sessions/:id` | Inspect / clear (200 or 202 pending) |
| POST | `/api/sessions/:id/files` | Private image staging |
| POST | `/api/sessions/:id/references` | Private PCM16 WAV staging, one `file` part |
| GET | `/api/sessions/:id/files/:fileId` | Private PNG/JSON/WAV stream/download |
| POST | `/api/sessions/:id/experiments/:experimentId/runs` | Strict task JSON → 202 owned job |
| GET | `/api/sessions/:id/jobs/:jobId` | Owned job state and sanitized inspector metadata |

Unknown experiments/routes/fields/query parameters and guessed endpoint controls
fail closed. No voice catalog, registration, delete, client proxy or active cancel route.

## Replacing or removing models

Keep the permanent navigation and lab page. `services/experimentalModels/registry.js`
is the admission/catalog authority: remove an entry to deny new runs/discovery and
hide its form, or replace the entry and its fixed Gateway path, parser and renderer
contract. Reuse the existing `wevis`/`audio` form renderer when its semantics match;
new semantics require a reviewed adapter rather than arbitrary provider metadata.
Update the model enum/recovery schema in `policy.js` when IDs change, account for
existing sessions, and run the contract, HTTP lifecycle and DOM suites. Drain work
and clear/expire sessions before removing support for their stored model IDs. Never
turn a registry change into a client-controlled proxy or persistent voice operation.
The permanent navigation/page shell does not need replacement when models rotate.

## Operations and validation

### Optional protected storage root

`EXPERIMENTAL_MODELS_STORAGE_ROOT` is a server-only optional absolute directory,
captured once when the storage module initializes. Unset preserves the checkout's
`private_data/experimental-models` default for existing installations/Linux development.
Setting it to blank, whitespace, a relative path, a control-character-containing
path or a path with `.`/`..` components fails closed. Configuration is never accepted
from clients or returned as a server path; inspectors redact the configured root.
Restart is required after changing it. No public-storage fallback exists.

Use a protected external directory when checkout ancestors are broadly writable.
All existing checks still apply: no overlap in either direction with `public`,
`games`, `node_modules`, `VUE_PATH` or their canonical aliases; no symlink/junction
root or ancestors; trusted ownership and ancestor permissions. Static delivery
guards also deny file aliases and compressed aliases into the configured store.
POSIX paths must be absolute; private directories/files retain 0700/0600 modes.
Windows accepts fully qualified drive paths (backslashes or forward slashes) and
UNC share paths. Drive-relative/root-relative paths, device namespaces, alternate
streams, reserved device names and trailing-dot/space components are rejected.
Use canonical directory names; short-name aliases whose real path differs are rejected.

On Windows, **pre-provision** the directory for the actual WinSW service identity
(`LennartWeb`, currently LocalSystem), SYSTEM and Administrators, subject to the
**existing** read-only `scripts/assert-gpt-image-acl.ps1` policy. The root and every
ancestor must pass that checker **under the actual service identity**. An elevated
interactive administrator check alone does not establish that result. The application
does not chmod Windows directories or weaken the checker. Do not broaden or rewrite
ACLs across `C:\Projects` to make the checkout pass. A proposed path such as
`C:\ProgramData\Lentmiien\ExperimentalModels` is only a candidate: the separate
production inspection must establish its safety. If the existing policy rejects it,
record the precise failed condition and choose a compliant location before rollout.

Every upload, output, quota, recovery pass and expiry sweep uses the configured
root. **Changing roots does not migrate, inspect, expire or delete the old store.**
Clear old test sessions and let active requests/download leases finish before a
planned switch. If that is impossible, retain the old store and make its eventual
inspection/removal an explicit operator action after confirming no process uses it.
Switching back similarly requires operator intent; do not use root changes to evade
quotas or assume the old data's TTL still has an active sweeper. Use one process per store.

### WinSW deployment (one checked operator helper)

Use the [first-rollout Windows operator runbook](experimental-models-windows-release.md)
and `scripts/deploy-experimental-models.ps1` after the separate Gateway/Ming backend
release. It includes one safe fetch/fast-forward bootstrap, private dotenv validation,
passive Ming auth/capability checks, atomic protected creation of only the two new
dedicated folders, maintenance, a bounded LennartWeb-only restart, local readiness
verification and safe receipts. It refuses existing folders and configuration drift.

The Site `.env` must contain the approved external storage root and a corrected
`MING_ADMIN_TOKEN` matching the **existing** Gateway secret; no rotation is needed.
The earlier passive GET returned 401, so the presence of a token alone is not proof
of authentication. The helper requires both HTTP 200 and ephemeral capability v1.
The actual LocalSystem storage context is exercised by normal Site initialization
and the single combined admin browser check, not an installed SYSTEM validation task.
No production actions were performed while preparing this source helper.

No DB migration, dependency change or curated OpenAPI change. Foundation manifests
remain compatible (`jobs` defaults to empty). The shared cleanup scheduler and
static guards remain. Cloudflare must preserve application authorization and no-store;
no cache/public access exception is needed. Rollback removes navigation/routes/scheduler
and private lab files separately after all local requests/streams finish. Do not run
`npm start` for verification: prestart mutates generated data and can synchronize Dropbox.

Tests use temporary private directories, synthetic CPU images/audio and mocked
Gateway requests, plus real local Express HTTP and jsdom browser interactions.
They cover form contracts, output schema/geometry, WAV metadata, auth/CSRF/IDOR,
credentials/redaction, MIME/traversal/symlinks, quotas/reservations, global queue,
clear/TTL/download leases, restart, revoked dispatch authority and inert rendering.
Pug/DOM behavior is tested. Deployment and a human browser check remain separate
from these local synthetic tests.

## Foundation validation recorded 2026-10-30 (before ephemeral completion)

- Focused lab plus authorization/CSRF/navigation/body/private-storage suites:
  **262 tests passed across 10 suites**.
- Full Jest coverage run in an isolated source-only copy, including pending source
  changes, a local Git index for ignore-policy tests, clean environment and no `.env`
  or runtime data: **6,213 passed, 261 skipped, 5 failed**; 442 suites passed,
  17 skipped, 5 failed. Command equivalent to `npm test -- --maxWorkers=2
  --workerIdleMemoryLimit=256MB`, with a 4 GiB worker heap cap. Coverage thresholds passed.
- The five failures are the unchanged missing ignored WAV-master checks in
  `lentmancGame`, `galaxyCenterJourneyGame`, `dinosaurHistoryGame`,
  `deepOceanJourneyGame` and `kardashevGame`. Generated assets and those tests were
  not changed. The initial isolated run also lacked a Git index for an existing
  `embeddingGemma2Files` policy test; initializing the snapshot and rerunning the
  complete suite resolved that setup failure.
- `git diff --check` passed. No live Gateway inference/capability calls, production
  application startup, deployment, GPU operation or database mutation was performed.
- Screenshot validation remains unavailable because no browser is connected;
  local Express HTTP, Pug rendering and jsdom interaction tests passed.


## Ephemeral completion validation — 2026-10-30

- Security review checked owner/login scope, CSRF before parsing, fixed outbound
  operations, exact multipart fields, explicit consent, private-file permissions,
  redaction, metadata/output quota reservations and clear/expiry/restart races.
- Functionality review checked all 14 tasks, conditional languages/controls/tags,
  passive v1 capability gating, unsupported Gateway versus worker-update errors,
  binary WAV results, browser draft removal, and preserved WeVis behavior.
- Final focused command covers all six `experimentalModels*.test.js` suites plus
  `sessionCsrf`, `accountSurfacePolicy`, `accountSurfaceBody`,
  `gptImageStorageReadiness` and `gptImageWindowsStorage`, with
  `--coverage=false --maxWorkers=2`: **373 passed, 4 platform skips** (10 passing
  suites and one skipped suite). The new ephemeral suite has 106 CPU-only cases.
- Full coverage run in a source-only snapshot with no `.env` or runtime data:
  **6,325 passed, 261 skipped, 5 failed**; 443 suites passed, 17 skipped, 5 failed.
  Coverage thresholds passed. Only the same five missing ignored WAV-master checks
  listed above failed; no generated game assets or those tests were changed.
  The final UI-only input/draft guards were subsequently covered by the complete
  14-test DOM suite and the final focused run above.
- Real Express HTTP exercised the actual router, session store, dispatch authority,
  CSRF middleware, private storage and worker queue against a localhost mock Gateway
  that validates the four multipart parts and returns synthetic binary WAV.
  Successful references made zero voice-registry calls; clear removed all local
  files/manifests and discarded late output after pending deletion.
- Local headless Firefox 157 / geckodriver exercised capability enabling, BASIC
  selection, exact request preview, unchecked consent and responsive layout against
  mocked capability/session endpoints. Desktop and narrow layouts had no horizontal
  overflow. Screenshots contain fictional IDs and synthetic text only:
  [desktop reference form](assets/experimental-models/reference-desktop.png),
  [narrow reference form](assets/experimental-models/reference-narrow.png).
- `git diff --check` passed. No live Gateway calls, GPU jobs, production startup,
  deployment, config-secret inspection or database mutation occurred.

Deployment coordinator: update Gateway **and** Ming worker, deploy this Site code,
retain the private matching `MING_ADMIN_TOKEN` (already present on the current Site), verify the configured
`AI_GATEWAY_BASE_URL`, then perform the consolidated human browser/runtime check.
No database migration or dependency installation is needed. Until that deployment,
reference controls remain capability-gated; reference-free Ming and WeVis retain
independent operation. This source change has no remaining implementation blocker.

## Storage override validation — 2026-10-30

- Pinned, already-installed Node 26.13.0; CPU-only synthetic tests, no live Gateway calls.
- `npm test -- tests/unit/experimentalModels tests/unit/sessionCsrf.test.js
  tests/unit/accountSurfacePolicy.test.js tests/unit/accountSurfaceBody.test.js
  tests/unit/gptImageStorageReadiness.test.js tests/unit/gptImageWindowsStorage.test.js
  tests/unit/gptImageMedia.test.js --coverage=false --maxWorkers=2`:
  **442 passed, 4 Windows integration skips**, 12 passing suites, one skipped suite.
- Full `npm test -- --maxWorkers=2 --workerIdleMemoryLimit=256MB` in a source-only
  snapshot with a Git index, no `.env`/runtime data and a 4 GiB worker heap cap:
  **6,372 passed, 261 skipped, 5 failed**; 444 passing suites, 17 skipped, five failed.
  Coverage thresholds passed. Failures are only the same missing ignored WAV masters
  in the five game suites listed above.
- Config tests cover Windows/POSIX syntax, literal ACL-checker arguments and denial,
  static/canonical aliases, custom-root restart/quotas/ownership/expiry/lease cleanup,
  keeping the previous store untouched, client override denial and path redaction.
  Windows mocks do not qualify a real production directory or its ACLs.
- `git diff --check` passed. No production files, ACLs, configuration, service state,
  database, dependencies or Node installation were changed. Runtime/browser/GPU
  qualification remains a separate operator task.
