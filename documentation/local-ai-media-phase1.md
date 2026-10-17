# Local AI immutable inputs and vision (Phase 1)

Contract pin: ai-services `2975356ab4f0111929c9b2d82fa360b891f2a625`.
Transport remains durable-local-ai v1; only image-bearing llm.chat uses operation
schema 2. No registered Comfy workflow or multiple-output UI is enabled here.

Security contract: logged-in; private data; interactive admin by default, explicit
grants for family/user; fixed-owner revocable service tokens. Capabilities are
`local_ai.jobs.use` and `local_ai.inputs.import_shared` (the latter admin-managed,
admin bundle only). No administrator override of another owner's artifacts.
Chat attachments additionally require current read/write conversation membership,
a trusted upload association and matching author/message/filename. Browser HTTP
mutations use sessionCsrf; socket uploads use the same session CSRF token with
session reload and capability checks. No filename or digest confers authority.

Inputs are private immutable bytes, never base64 in Mongo or browser storage.
Raster limits: 32 MiB, one frame, 16 million pixels, 8192 per axis; complete CPU
decode. Catalog policy further limits vision to 3 images and 6,000,000 bytes over
all selected history, including padded decoded-byte estimate. No URL inputs,
tools, autonomous actions, cloud fallback or model-card family inference.
Outbound traffic uses only the configured fixed Gateway origin, zero redirects.
Responses are private/no-store; UI uses textContent. Logs contain stable codes,
not filenames, prompts, credentials or upstream payloads.

Retention: no automatic deletion. Preparation reservations, uncertain writes and
accepted bytes remain charged independently of job admission slots. Recovery uses
original IDs and digests; it never rereads mutable library names. Ordinary public
Chat5 originals remain public: a private snapshot does not repair their historical
privacy. Legacy attachments without trusted provenance require reupload.

New models disable autoCreate/autoIndex and use explicit retryable database-ready
collection/index creation with journaled writes; no Model.init caching and no
transactions are assumed. Tests cover negative scope, forgery, CSRF/revocation,
quota races, immutable replay and interrupted publication. Windows checks model
ACL/reparse-point behavior; physical NTFS power-loss guarantees require deployment
validation. No human deployment is part of this change.

## Configuration and initialization

`LOCAL_AI_BATCH_MEDIA_ENABLED=false` is independent of the existing
`LOCAL_AI_BATCH_ENABLED` and `LOCAL_AI_BATCH_AUTO_DISPATCH` switches. It gates new
input/vision acceptance and trusted legacy-upload snapshots. No flag is enabled
by initialization. Existing v1 jobs retain their wire/manifests and sealed jobs
continue to reconcile while flags are OFF. Accepted inputs can still be read and
replayed; the flag is not a deletion or cancellation mechanism.

`LOCAL_AI_INPUT_DATA_DIR` defaults to `private_data/local-ai-inputs` on Linux and
`C:/ProgramData/LennartWebLocalAI/inputs` on Windows. Provision the Windows private
tree with SYSTEM/Administrators (and the actual service identity if distinct)
access only. Every access checks ancestors, reparse points and the native ACL
policy in `scripts/assert-gpt-image-acl.ps1`; no mode-bit substitute is used on
Windows. Linux checks trusted owners, no untrusted ancestor writes and no links.
Static aliases into the input root are denied by the shared static-media guard.
Local privileged operators remain trusted.

Default byte limits: `LOCAL_AI_INPUT_QUOTA_BYTES=2147483648` and
`LOCAL_AI_INPUT_OWNER_QUOTA_BYTES=536870912`. Each preparing record reserves
64 MiB + 64 KiB before consumption. Successful publication settles to exact bytes
plus 4 KiB journal allowance. Failed/uncertain preparations retain reservations;
accepted bytes never release on job completion/cancellation. There are 1,024 total
and 128 per-owner retained preparation records; no TTL. A single atomic Mongo
quota document admits reservations across processes. One bounded intake pipeline
and one decode slot per process prevent unbounded queued buffers. Imports and
new uploads share that slot. Quota 507 means operator capacity/retention review,
not automatic eviction or a retry with new IDs.

`LocalAiInput` and `LocalAiInputQuota` use the existing explicit initializer:
`node scripts/local-ai-admin.js initialize-by-name EXACT_ADMIN_LOGIN`.
The worker invokes the same initializer after DB readiness and retries errors.
New models are compiled before connection with autoCreate/autoIndex/buffering
OFF; initialization uses createCollection/createIndexes, not cached Model.init.
The initializer adds their indexes without rewriting history. Existing admission
index migration remains unchanged. This command is documented, **not run against
production** by this implementation.

Writes are journaled (`w:majority,j:true`). A preparation is persisted before
quota allocation, and no file is consumed until allocation exists. Publication
uses one fixed reserved scratch file, file fsync, atomic rename and POSIX directory
fsync before the ready record; only then may jobs return 202. A per-input journal
writer identity fences concurrent publication; a dead writer can be recovered
using the same host/PID/start-time proof as the coordinator. A live or ambiguous
writer is not stolen. Incomplete unaccepted scratch bytes may be rebuilt under
that fence; accepted bytes are only verified. Windows flushes the file but cannot
POSIX-fsync a directory; physical NTFS/power-loss testing remains outstanding.

## APIs

Browser prefix: `/local-ai/api/v1`; machine prefix: `/api/local-ai/v1`.
Browser mutations require `X-CSRF-Token` from `/local-ai/api/v1/config`. Machine
calls require the existing fixed-owner `Authorization: Bearer lai_...` credential;
no session CSRF is used for machine calls. Every operation reloads capabilities
and token revocation/expiry. Responses are private/no-store.

- `POST /inputs`: multipart with exactly one `file` part. Headers:
  `Idempotency-Key` (1–80 safe characters), `X-Content-SHA256` (64 lowercase hex).
  Supplied filename/MIME confer no authority. Full raster validation determines
  the descriptor. Returns 201 with `artifact_id,state,sha256,bytes,media_type,
  width,height,frames,normalization`. Invalid multipart/rasters return 422;
  size/dimension limits return 413; retained quota/disk backpressure return 507.
- `GET /inputs/by-key/:key`: recover the original preparation/receipt after a
  lost response. `state:preparing` means resend the identical bytes/key/hash.
- `GET /inputs/:id` and `GET|HEAD /inputs/:id/content`: owner-scoped integrity
  checked metadata/private content. A foreign/missing ID returns 404. Site's
  small input delivery sends full content; Gateway's tested Range contract is
  used independently and is not falsely advertised by Site.
- `POST /inputs/import`: JSON `{source:{filename,subfolder},expected_sha256}`.
  Site deliberately requires the exact revision even though Gateway permits its
  omission. Requires **both** `local_ai.jobs.use` and
  `local_ai.inputs.import_shared`. The latter explicitly grants access to the
  admin-managed shared Comfy input library. It is admin-only by default; an
  explicit grant is an intentional delegation of that library authority. Gateway
  performs its CPU import; Site verifies the receipt fingerprint, downloads from
  the constructed fixed-origin route, hashes/decodes and durably stores bytes.
  Replays use the original snapshot, never the current filename contents.
- Existing `POST /jobs` now accepts `llm.chat` messages with nonempty `images`
  arrays of `{artifact_id,sha256}` on user messages. No top-level images, URLs,
  paths, base64, tool history or arbitrary options. Image-only content is `""`.
  Existing request body cap remains 256 KiB; frozen metadata cap remains 512 KiB.
  Use the existing job key on uncertain acceptance to recover the same snapshot.

Shared-import tokens are opt-in:
`node scripts/local-ai-admin.js issue-token ADMIN_ID OWNER_ID LABEL --shared-import`.
The issuing owner must hold both capabilities; ordinary tokens keep only
`local_ai.jobs.use`. Use the existing grant/revoke commands for explicit policy.
No credentials are created by initialization.

Chat5's existing socket upload gains `uploadKey`, `csrfToken` and an acknowledgement
containing `conversationId,messageId,artifact`. The current JPEG normalization is
retained and those **exact JPEG bytes** are privately captured. Browser batching
waits for the file reader and server acknowledgement; uncertain upload keys remain
in sessionStorage across reloads, without file bytes. Reupload the same file to
repair a lost acknowledgement. New conversations/messages use deterministic
owner/key IDs; exact retries repair association instead of appending duplicates.
Only the uploader's artifacts are eligible; conversation membership alone does
not transfer ownership of another member's artifact. Hidden/window/start-message
selection occurs before resolving images. Filename edits cannot grant provenance;
already accepted jobs continue reading their frozen private IDs.

With media enabled, ordinary `/image_gen/api/files/input` uploads require the
same capability/CSRF, retain the existing 100 MiB immediate upload limit and
filename response, and add `batch_input`. Inputs above 32 MiB, unsupported types
and failed snapshots return `eligible:false` with a reason while preserving the
immediate upload. These are never represented as immutable batch inputs. No
Comfy media/workflow batch selector is enabled.

## Transport and remaining boundary

Site uses actual catalog `provider`, `upstream_model`, `allow_images`, `limits`
and `keep_alive`; transient installation/state/display fields do not freeze
execution policy. Changes in exposed policy block export; no card-family fallback
or image dropping occurs. Gateway 2975356's full internal catalog/options mapping
is frozen at Gateway operation acceptance and rechecked at dispatch. Its public
catalog does not expose every internal option or a full-policy digest, so Site
cannot attest to undisclosed options before that acceptance. Neither side hashes
Ollama weights behind unchanged tags.

The worker uploads/looks up known immutable input IDs, validates bytes and receipt
fingerprints, sizes cohorts using live capacity and the advertised reservation,
refreshes HTTP Date **after staging**, then persists schema-2 operation IDs in the
immutable run wire. All references exist before the run PUT. Sealing sends the
complete ordered accepted operation/digest list, verified against Site's canonical
request hash. Lost transfers/reservations retain IDs; no partial cohort is sealed.
Existing coordinator fencing, retry lineage, time bounds, v1 output ingestion and
projection/ack recovery remain in use. Normal 1.6-second Uvicorn Date lag is
conservatively enclosed by the existing quantization/refresh/RTT bound; stale or
large-uncertainty evidence still fails closed.

Phase 2 still owns the 20 registered Comfy policies, graph bindings, multiple PNG
outputs, MP4/audio manifests, corresponding UI and real GPU canaries. This commit
neither invents that wire nor advertises it. Human deployment remains separate.

## Offline verification record

Validated with Node **24.20.0**, a disposable MongoDB 8.0 standalone container on
loopback (no production mounts), and the pinned Gateway source extracted into
throwaway directories. The full Jest run passed **404 suites / 5,220 tests** with
coverage thresholds satisfied; 8 suites / 122 tests were skipped by their existing
conditional prerequisites. The focused Local AI run passed 205 tests before the
final full run; the Windows ACL behavior test also passed separately.

Full command (all paths/credentials are test fixtures):

```sh
PATH=/home/lennart/.volta/tools/image/node/24.20.0/bin:$PATH \
LOCAL_AI_TEST_MONGO_URI=mongodb://127.0.0.1:27029/local_ai_test \
LOCAL_AI_GATEWAY_SOURCE=/home/lennart/ai-services \
LOCAL_AI_PROTOCOL_PYTHON=/tmp/site-local-ai-protocol-venv/bin/python \
LOCAL_AI_GATEWAY_CHECKOUT=/home/lennart/ai-services \
LOCAL_AI_GATEWAY_PYTHON=/tmp/site-local-ai-protocol-venv/bin/python \
npm test -- --runInBand
```

The Python harness requires FastAPI, httpx, Pillow and python-multipart in its
isolated environment. It exercises the actual 2975356 CPU router/SQLite code for
upload, GET/HEAD/Range, schema-2 admission, canonical fingerprint, incomplete/exact/
replayed seal, whole-cohort 507 and unchanged reservation accounting on rejection
and replay. It stubs only the upstream request preparer and starts no scheduler
or model. The prior d566158 run-clock harness also remains green.

Mongo tests import the real application database module **before** connecting.
They cover explicit index initialization/retry, lost ready/lock DB replies,
interrupted scratch/rename recovery, live-writer fencing, quota races, owner and
conversation forgery, revoked credentials, copied/edited filenames, immutable
source overwrite, model policy changes, reference budgets, lost transfer/run
replies, cohort sizing and exact sealing. Rendered Pug/JSDOM tests execute the
actual upload handler and batch click through FileReader/server acknowledgement.
Raster/path tests include supported formats, full decode, malformed/animated/
oversized rasters, symlinks, hardlinks and Windows path/ACL denial behavior.

No production application initialization, inference, deployment, credential
issuance or Gateway code mutation was performed. Real Windows filesystem and
physical GPU canaries remain deployment work, not claims of this test record.
