# Experimental Models admin lab

## Delivery status

`/admin/experimental-models` is the permanent admin Tools entry. The implemented
adapters support all seven verified WeVis tasks and reference-free Ming
`VOICE_DESIGN` / `FREEFORM`. Forms, private inputs/results, asynchronous Site jobs,
polling, request/response inspectors, audio playback/download, optional region
overlays, session clear and absolute expiry are implemented and tested locally.
These are experimental integrations, not live model qualification.

Ming reference-conditioned `TTS`, `MULTILINGUAL`, `BASIC`, `EMOTION` and `DIALECT`
remain disabled. The UI contains a disabled reference upload/transcript/consent
and controls draft. **The one-shot ephemeral reference endpoint contract is still
required.** Site never registers persistent voices, lists the private catalog,
accepts existing voice IDs or deletes voices. No temporary Gateway reference
cleanup claim is made. There is no task named `CLONE`.

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
- Quotas: eight files/results and eight jobs per session; 32 MiB/session,
  64 MiB/admin, 256 MiB/global; two sessions/admin, sixteen global. Queued/active jobs
  reserve maximum result bytes and a file slot. All accounts/logins count. Manifests
  are capped at 256 KiB; requests/diagnostics are bounded. Reference uploads consume
  no storage because their adapter is disabled.
- Storage: `private_data/experimental-models`, outside all static mounts, UUID names,
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

Set `MING_ADMIN_TOKEN` on the **Site server** when provisioned. It is sent solely as
`X-Ming-Token` on `/tts/ming/*` requests; never substitute `LLM_ADMIN_TOKEN`, the
batch token or an API key entered in the browser. No usable default exists. Missing
Ming configuration returns 503 before any network request, including discovery.
Rotation takes effect through the process environment on restart. No secret value
belongs in docs or git.

Reuse `AI_GATEWAY_BASE_URL` (existing default `http://192.168.0.20:8080`). It must be
an HTTP(S) origin with no embedded credentials, path, query or fragment. The new
`EXPERIMENTAL_MODELS_TIMEOUT_MS` defaults to 2,000,000 ms; allowed 1,800,000–2,400,000.
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

Reference draft documents the future requirements without forwarding any upload:
TTS zh/en no controls; MULTILINGUAL ja/ko/de/fr/es no tags/controls; BASIC zh/en a
nonempty subset of speed/pitch/volume; EMOTION zh/en emotion; DIALECT zh only dialect.
Exact Chinese values are preserved behind translated UI labels: speed 慢速/中速/快速,
pitch and volume 低/中/高; emotion 高兴/悲伤/愤怒/恐惧/厌恶/惊讶/中性; dialect
`chuanyu dialect` / `cantonese`. No mixed task controls or arbitrary reference IDs.
The draft WAV/transcript/consent limits reflect the supplied existing reference
format, **not** a claim that the forthcoming multipart contract is implemented.

Success requires HTTP 200, no-store, audio/wav and `X-Generation-Complete: true`.
RIFF/WAVE length and chunks, PCM16LE mono, actual 16–48 kHz sample rate, positive
≤60-second duration and ≤6 MiB are validated. The pinned runtime is 44100 Hz; Site
parses the actual rate. Budget exhaustion or invalid/nonterminal audio is an error,
not partial success. No invented transcripts, model/latency headers, seed or streaming.

## Discovery and inspectors

The explicit availability buttons call public passive
`GET /perception/wevisone-vl/capabilities` or `GET /tts/ming/capabilities`, then
`GET /limits`. `/limits` never receives the Ming token. Discovery exposes available,
recognized container state, optional-installation boolean, experimental status and
numeric limits under the two successors plus queue/upstream timeouts. Verified
controls/tasks live in the replaceable registry; unknown provider fields never create
UI operations. `runtime_verified` remains false: installation is not qualification.
No private `/voices` catalog or `/queue`/`/gpu` inference is used. OCR model metadata
is optional and is not fetched.

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
polls the owned session list until it disappears. Busy sessions refuse new runs and
uploads. Results received after clear/expiry are discarded. A restart cancels queued
jobs and records in-flight jobs interrupted/unknown, without replay; the old process
has no remaining local writers/streams, so private files can be cleaned. Remote
inference might still finish independently. Timeout/disconnection also gives unknown
completion and no retry. It never proves the GPU stopped. No remote voices exist in
this implementation to delete or reconcile.

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
| GET | `/api/sessions/:id/files/:fileId` | Private PNG/JSON/WAV stream/download |
| POST | `/api/sessions/:id/experiments/:experimentId/runs` | Strict task JSON → 202 owned job |
| GET | `/api/sessions/:id/jobs/:jobId` | Owned job state and sanitized inspector metadata |

Unknown experiments/routes/fields/query parameters and guessed endpoint controls
fail closed. No voice catalog, registration, delete, client proxy or active cancel route.

## Operations and validation

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
No browser is connected in this environment, so visual screenshot validation is
unavailable; Pug/DOM behavior is tested.

## Validation recorded 2026-10-30

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
