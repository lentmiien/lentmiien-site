# Local AI registered media release — Site Phase 2

## Explanation

This is the complete Site consumer for the **finished** Gateway contract at
ai-services `8105a1b`, `documentation/gateway/durable-batch-media.md`. Gateway
runtime source is `ab49e218040e0bf5d30a717166c1026bbbef3db5`, image tag
`ai-gateway:comfy-stage5-ab49e21`, immutable image
`sha256:bc667473ea01efd1f91f3d0ce8f42b178be86365c6923fdc133a7143e01257b1`.
The live starting versions reported for this work were Site `2208874` and Gateway
`d566`, AUTO off. This work does not deploy, restart, initialize production data,
change production flags or perform inference. CPU fixtures are not physical GPU
or Windows power-loss canaries.

The image generator at **`/image_gen`** offers registered batching alongside
immediate generation. **Queue local batch** prepares the same workflow with
`buildWorkflowPayload` that immediate submission uses. Explicit random controls
and negative seed sentinels (including colon-node TextGenerate seeds) become
concrete seeds once per attempted submission. Lost responses reuse the exact
frozen typed request and idempotency key, including after a browser reload via
**Recover uncertain submission**. Acceptance is a durable Site job, not proof that
GPU work has begun. **`/local-ai/queue`** and **`/local-ai/queue/:id`** show all final
images and playable videos with their original audio, independent of public
image galleries/favorites.

Eligibility comes from authenticated Gateway registry discovery and schema-2
feature negotiation. The server retains the exact opaque `template_sha256`;
JavaScript never recomputes Python policy digests. The shared browser/server mapper
checks every node, class, input key and fixed edge. Only enumerated scalar fields
may change; safe resource filenames follow the registry's `resource` rules.
Inactive LoRA/TextGenerate/switch branches participate in the full static affinity.
Unknown safe resource filenames isolate each operation and do not download or
approve new models. Model compatibility and installed resources still matter.
An arbitrary workflow name, extra node, computed path, changed font/expression,
cache option, sampler or link is rejected. The UI reports the rejection rather
than silently restoring a different model or option.

**Load registered batch defaults** explicitly loads the versioned sanitized graph
and exposes its permitted controls. This is useful when a legacy saved workflow
has out-of-range defaults or incompatible edits. It replaces controls only on
that explicit click. Registry defaults have blank user text and deterministic
seed zero; supply the desired prompt. Unchanged legacy graphs can map directly.
Comfy preview-widget state (`rgthree_comparer`, `video-preview`) is non-executable
and normalized as in Gateway. Final savers and audio branches are retained; the
Gateway's registered preview omissions do not remove final outputs.

**Output-prefix normalization:** the prepared legacy `filename_prefix` must be a
bounded safe literal, but it is deliberately not sent as a typed override.
Gateway forces its own private namespace and ordered slot names. Names in the
legacy UI never select a public output location. This is the documented exception
to exact scalar preservation, shared with Gateway's contract.

### Reference images and import controls

The existing upload/list/select/**Use in workflow** flow remains available. With
media enabled, an upload's Phase 1 owner-bound private receipt is associated with
the selected **node/image** field. The immediate upload still accepts up to
100 MiB; batch accepts only validated single-frame raster inputs up to **32 MiB**.
An ineligible upload displays its reason and cannot supply a private binding.
Selecting an old global filename never creates ownership.

**Private batch reference library**, **Refresh private inputs**, and **Select
private input** expose the current owner's reusable input IDs. Each registered
LoadImage slot has **Bind selected private input to NODE/image**. Bind references
in the intended slots (1, 2 or 3 image references; the video reference workflow has
2). The frozen private preview is the source for batching. Editing the filename
field afterward invalidates the binding until the slot is explicitly rebound.
Private reuse does not rewrite or promise to restore a mutable immediate-mode
Comfy filename.

Only actors with `local_ai.inputs.import_shared` see **Import selected shared file
privately** and the checkbox **I am authorized to import the selected shared-library
file into my private inputs.** Import requires this explicit UI confirmation.
The server enforces the capability independently. Gateway snapshots only its
input mount, refuses symlinks/traversal/annotations/output/temp sources, checks
concurrent source replacement, and returns an immutable receipt. Site downloads
that receipt through a constructed authenticated URL, checks the content hash and
full raster decode, and saves private bytes before a job can return 202. The
preview is that private snapshot. A later overwrite/deletion of the global source
cannot alter it. Ordinary users must upload their own source.

The optional `expected_sha256` pins an exact shared-library revision when known.
If omitted, the confirmed action imports the revision Gateway actually snapshots;
review its private preview before binding. Input preparation has a separate
idempotency key and response from generation acceptance. An uncertain import
retains its key; replay reads the original immutable receipt, never today's source.
Do not change keys to work around an ambiguous response or quota failure.

Chat5 uses the existing acknowledged upload flow. Legacy Chat5 image messages
without a trusted owner/source association must be **reuploaded into the intended
conversation by their owner**; there is no safe claim-by-filename migration. Do
not import public Chat5 paths by URL. Shared Comfy library import is a separate
admin-managed path, not automatic attribution of old Chat5 images. Attachments
with missing provenance produce an explicit eligibility error instead of silently
vanishing from the request.

### Security contract

Zone: logged-in/private. Data: private prompts, images and video. Interactive
admin has the capability bundle by default; family/user require explicit grants.
Machine principals use fixed-owner, expiring, independently revocable `lai_`
tokens. `local_ai.jobs.use` is required for registry, input and job operations;
`local_ai.inputs.import_shared` additionally authorizes the admin-managed Comfy
input library; `local_ai.scheduler.manage` controls whole-run start/stop. No admin
override allows reading another owner's jobs or inputs. Chat5 sources require
current read/write membership and trusted uploader provenance. Identity comes
from the validated principal, never request owner fields.

Browser mutations are POST with shared session CSRF; machine calls use bearer
headers, not URL secrets. Source access and token/capability checks continue before
export, publication, ACK and output delivery. Bounds are 256 KiB submission JSON,
512 KiB frozen Site context, registry-enumerated input/override limits, per-owner
and global job/input/output quotas, request rate limits, and two concurrent private
media deliveries per process. The Gateway has its own stricter intake concurrency
and disk reservation limits. Files stay outside static roots; static aliases into
private input/output roots are denied. No caller URL or local path is fetched.
Only the configured Gateway origin and constructed paths are used, with zero
redirects. UI strings use textContent/Pug escaping. Responses are private/no-store,
no analytics, with nosniff, ETag and single Range/If-Range GET/HEAD semantics.
Keep Cloudflare caching disabled for `/local-ai/*` and `/api/local-ai/*`; Access
policies are supplemental and never replace Site authorization. Logs contain
stable operational codes/opaque job IDs, never prompts or image bytes.
No automatic retention deletion, TTL, public copy or favorites fallback exists.

### Durable collection, capacity and compatibility

The coordinator chooses a bounded cohort using live Gateway capacity, existing
reservations, every template's complete output reservation, immutable input bytes,
input upload headroom and ledger allowance. An otherwise empty default **2 GiB**
Gateway store fits two video jobs, not eight. Inputs are staged before the declared
run. The run includes exact ordered `operation_ids` and `operation_budgets`.
The exact accepted ordered digest manifest is saved before seal. Network/storage
failure leaves an open schema-2 run intact for retry; it cannot drop accepted
members or seal a subset. Existing v1 wires, bodyless seal, text JSON, single PNG
result and legacy 507 stop/reclaim behavior remain unchanged.

All final descriptors must match the frozen policy's slot/node/order/type/limits.
Site validates the Gateway result fingerprint from the original JSON **number
lexemes**, preserving Python `1.0`/exponent spelling rather than reserializing
JavaScript Numbers. It then streams each fixed authenticated output route into a
bounded reserved private scratch file, checking MIME, length, ETag and full hash.
PNGs receive full sharp CPU raster decoding. MP4s retain all original bytes and
undergo bounded ISO BMFF atom checks that reject external data references. Site
trusts the authenticated, digest-verified Gateway metadata for fully decoded video
frame count, duration, codecs and audio validation. The finished Gateway image
already includes CPU ffprobe. **No new Windows ffmpeg/ffprobe installation is
required.** This trust boundary does not claim a second full Site video decode.

Publication/ACK waits for every durable artifact, complete metadata and deterministic
provenance. The descriptor, source result digest, local manifest digest, validation
version and operation identity are retained. Partial download/metadata/storage
failures remain `collecting`; malformed successful results become `needs_review`.
Neither condition triggers regeneration. Retry collection reuses verified files
and the same operation. Output files and unfinished reservations remain charged
when job admission slots are released. Owner cancellation does not delete retained
media. Operator retention tooling is not introduced here.

Windows defaults are `C:/ProgramData/LennartWebLocalAI/inputs` and `/outputs` under
that same private tree. Every access checks safe ancestors, symlinks/reparse points
and the native ACL policy through `scripts/assert-gpt-image-acl.ps1`. Atomic
publication flushes the file and renames it; POSIX additionally fsyncs the directory.
NTFS does not expose POSIX directory fsync through Node. Physical NTFS/power-loss
validation remains a deployment check, not a Linux test claim.

| Setting | Default |
| --- | --- |
| `LOCAL_AI_BATCH_MEDIA_ENABLED` | `false` (new inputs/vision/registered workflows) |
| `LOCAL_AI_BATCH_AUTO_DISPATCH` | `false` |
| `LOCAL_AI_BATCH_ENABLED` | `false`; existing v1 deployments may already set it |
| `LOCAL_AI_INPUT_QUOTA_BYTES` | 2,147,483,648 (2 GiB) |
| `LOCAL_AI_INPUT_OWNER_QUOTA_BYTES` | 536,870,912 (512 MiB) |
| `LOCAL_AI_OUTPUT_QUOTA_BYTES` | 8,589,934,592 (8 GiB) |
| `LOCAL_AI_OUTPUT_OWNER_QUOTA_BYTES` | 2,147,483,648 (2 GiB) |
| Outstanding job slots | 1,000 global / 100 owner |
| Retained input records | 1,024 global / 128 owner |
| Retained output allocations | 10,000 global |

Inputs reserve 64 MiB + 64 KiB while preparing, then bytes + 4 KiB. Output attempts
reserve twice the template's maximum output bytes + 1 MiB, then all actual bytes
+ 1 MiB after complete collection. Both include unfinished scratch files; successful
ACK never releases retained file bytes. Gateway disk accounting is independent.
Quota errors require capacity review, not deletion of accepted records.

`LocalAiOutputQuota` is additive to Phase 1's `LocalAiInput`/`LocalAiInputQuota`.
All Local AI models have autoCreate/autoIndex/buffering OFF and initialize explicitly
after database readiness using createCollection/createIndexes, never early
Model.init. `initialize-by-name` includes all these models and existing admission
index repair. No history rewrite or destructive migration is required.

Once any workflow/budget/output record exists, the minimum Site reader is **this
Phase 2 release or a compatible newer build**; `86b3d53` is Phase 1 only and
`2208874` is v1 only. Use `node scripts/local-ai-admin.js rollback-check ADMIN_ID
phase1` (or `v1`) with writers paused before considering an old binary. It refuses
incompatible retained content even with flags OFF. For Gateway the minimum is
schema-3-capable `ab49e21`/`8105a1b`; use Stage 5's rollback-check against schema 3.
Do not lower markers, remove evidence or restore stale backups over newer jobs.
Turning acceptance flags OFF still permits input reads and accepted-run/result
reconciliation; it does not cancel owned work. Unclaimed schema-2 jobs show
`batch_media_disabled` and are excluded from new dispatch while the flag is OFF,
so queued v1 jobs can continue.

### Supported registry (all 20)

| Workflow ID | Private final outputs | Reference nodes | Gateway reservation MiB |
| --- | --- | --- | ---: |
| `02_qwen_Image_edit_subgraphed` | PNG `60` | `78` | 132 |
| `Z-Anime-Workflow-v1` | PNG `93`, `95` | none | 196 |
| `anima-base-1_0` | PNG `46` | none | 100 |
| `image_krea2_turbo_t2i` | PNG `29` | none | 100 |
| `image_krea2_turbo_t2i_uncensored` | PNG `29` | none | 100 |
| `image_qwen_image` | PNG `60` | none | 100 |
| `image_qwen_image_2_1_t2i` | PNG `8` | none | 100 |
| `image_qwen_image_2_1_uncensored_t2i` | PNG `8` | none | 100 |
| `image_qwen_image_2_1_image_edit` | PNG `8` | `11` | 132 |
| `image_qwen_image_2_1_uncensored_image_edit` | PNG `8` | `11` | 132 |
| `image_qwen_image_2_1_image_edit_2ref` | PNG `8` | `11`, `12` | 164 |
| `image_qwen_image_2_1_uncensored_image_edit_2ref` | PNG `8` | `11`, `12` | 164 |
| `image_qwen_image_2_1_image_edit_3ref` | PNG `8` | `11`, `12`, `13` | 196 |
| `image_qwen_image_2_1_uncensored_image_edit_3ref` | PNG `8` | `11`, `12`, `13` | 196 |
| `z_image_turbo_example` | PNG `9` | none | 100 |
| `z_image_turbo_example_text` | PNG `9` | none | 100 |
| `video_ltx2_i2v_distilled` | MP4/audio `75` | `98` | 804 |
| `video_minimax_h3_i2v` | MP4/audio `92` | `114` | 804 |
| `video_minimax_h3_r2v` | MP4/audio `92` | `137`, `139` | 836 |
| `video_minimax_h3_t2v` | MP4/audio `92` | none | 772 |

Per final PNG: 32 MiB; MP4: 256 MiB, one video and one audio stream, at most 130
frames/six seconds. Outputs: 4096 per axis, 16 million pixels. Inputs: 32 MiB,
8192 per axis, 16 million pixels, single-frame PNG/JPEG/WebP/GIF, maximum 4:1
aspect ratio for Comfy. Individual scalar bounds may be narrower. Site integer overrides must be exactly
representable JavaScript safe integers (at most 9,007,199,254,740,991); automatic
random seeds use unsigned 32-bit values. Oversized/unsafe values are rejected,
not rounded or silently reset. No arbitrary
new graphs, custom font paths, duration expressions, output codecs, external audio,
extra savers or network/model downloads. Installed weights under unchanged names
and Ollama tags remain an operator-controlled runtime identity limitation.

### API and machine submission

Browser prefix `/local-ai/api/v1`; machine prefix `/api/local-ai/v1`. Browser uses
session plus `X-CSRF-Token`; machine uses `Authorization: Bearer <SITE_TOKEN>`.
Gateway credentials remain server-only. Existing types `llm.chat`,
`chat5.response` and v1 `comfy.image` remain; new typed **`comfy.workflow`** uses:

```json
{
  "type": "comfy.workflow",
  "request": {
    "workflow_id": "image_qwen_image_2_1_image_edit",
    "template_sha256": "<EXACT_DISCOVERED_TEMPLATE_SHA256>",
    "overrides": {"4/prompt": "A watercolor landscape", "6/seed": 42},
    "bindings": {"11": {"artifact_id": "<OWNED_INPUT_ID>", "sha256": "<INPUT_SHA256>"}}
  }
}
```

`GET /workflows` discovers versions/limits; `GET /workflows/:id/versions/:sha256`
retrieves the canonical policy. No browser raw graph endpoint is accepted.
`POST /inputs` takes multipart `file`, `Idempotency-Key` and `X-Content-SHA256`;
`GET /inputs` lists owned ready descriptors; `GET /inputs/by-key/:key` recovers
preparation; `GET /inputs/:id/content` supplies private preview. `POST /inputs/import`
uses `{source:{filename,subfolder},expected_sha256?}` and a separate idempotency
key. `POST /jobs` uses its own persistent key and returns 202 only after frozen
inputs exist privately. `GET /jobs/:id/result` returns the complete manifest for
workflows (text JSON and v1 PNG unchanged). Manifest URLs point to authorized
`GET|HEAD /jobs/:id/outputs/:slot`, supporting one byte range and matching If-Range.

For an eventual vision canary, use the **actual catalog's `gemma3:12b`** entry only
if it reports `provider:ollama`, `allow_images:true` and adequate image limits.
Upload one small local PNG through Site `/inputs`, retain its returned private
`artifact_id` and `sha256`, then submit `llm.chat` with a user message:

```json
{"type":"llm.chat","request":{"model":"gemma3:12b","messages":[{"role":"user","content":"Describe the shapes and colors.","images":[{"artifact_id":"<OWNED_INPUT_ID>","sha256":"<INPUT_SHA256>"}]}],"max_tokens":128,"think":false}}
```

No tag inference or hardcoded production vision allowlist is used. Limit all
selected messages together to three images/6,000,000 bytes and the model's limits.
To canary through Chat5, select the Local `gemma3:12b` card with tools empty,
reasoning none, standard mode, medium verbosity and text output; upload and wait
for acknowledgement before **Queue local batch**. Reupload legacy unassociated
images. This describes the later canary; none was run during source completion.

## Steps — later human rollout, AUTO stays OFF

1. Pause callers and settle active/unknown owned work; preserve Mongo, private
   inputs/outputs and Gateway ledger backups. Deploy **Gateway first** using the
   finished Stage 5 helper in ai-services: `python3
   ai-gateway/releases/2026-10-17-media-stage5/rollout.py preflight`, then
   `rollout.py deploy --callers-paused --no-active-owned-operations`, then
   `rollout.py verify`. Use the complete helper path for each command. Keep flags
   OFF for this deployment; do not blindly repeat deploy after interruption.
   Stage 5's documented `--enable-media` is for deliberate later inputs/vision/
   Comfy acceptance; shared import remains independently controlled.
2. On Windows, with the existing Site writers stopped under the established
   [Windows procedure](local-ai-windows-stage2.md), update the clean checkout to
   this pushed release and run **`npm ci`** using Node **24.20.0**. No dependency or
   lockfile change is introduced by Phase 2, but the live pre-Phase-1 installation
   must install the release dependencies (including sharp). Do not use `npm start`
   or `setup.js` for a smoke test; they mutate data. Preserve credentials privately.
3. Provision/verify the dedicated ProgramData tree and both `inputs` and `outputs`
   subdirectories. Permit SYSTEM/Administrators and only the actual service identity
   if different; deny untrusted writers on the ancestor chain and reject reparse
   points. For a **new** tree the existing ACL procedure is
   `icacls 'C:\ProgramData\LennartWebLocalAI' /inheritance:r /grant:r
   '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'`. Do not reset ACLs or delete
   content on an existing tree. Keep media/AUTO OFF and the documented quota defaults;
   retain the service's existing Gateway URL/client/token and Mongo configuration.
   Run `node scripts/local-ai-admin.js initialize-by-name EXACT_ADMIN_LOGIN` from
   the Site checkout using the service's effective environment. This adds indexes,
   including `LocalAiOutputQuota`, without deleting history or starting GPU work.
4. Start the existing Site service/console worker through its established Windows
   procedure, verify private access and passive diagnostics, and leave AUTO OFF.
   Deliberate later manual canaries require matching Gateway inputs/vision/Comfy
   flags and Site media acceptance enabled. Use the one-image vision flow above,
   image edit with ordered references, Z-Anime's two final PNGs, and a short
   audio-bearing video; verify collection/ACK before scheduling anything further.
   Physical cold/warm handoff, cutoff, cancellation and resident restoration remain
   canary gates. No automatic dispatch is enabled by this runbook.

## Offline validation

Fixtures are sanitized **committed** policies from `8105a1b`, not private local
workflow originals. Python harnesses extract exact committed source into temporary
directories. They never import live Gateway app startup, start a scheduler, acquire
a GPU or change the Gateway checkout. Synthetic PNG/short MP4-with-audio histories
exercise the actual ASGI routes, journal, materialization, output validator, ordered
manifest, exact seal, authenticated downloads and ACK. Site validates/collects those
actual response shapes. Tests also cover all twenty default/allowed mappings,
colon IDs and fixed-node attacks; rendered Pug controls, ordered refs; real Mongo
preconnection/index/restart/fencing/quota/lost response behavior; partial publication,
private gallery/ranges, scope and revocation; and previous v1/text/time/reclaim tests.

Run with a disposable loopback Mongo database, Node 24.20.0 and the isolated Python
FastAPI/httpx/Pillow/python-multipart environment plus test-host ffmpeg/ffprobe:

```sh
LOCAL_AI_TEST_MONGO_URI=mongodb://127.0.0.1:27030/local_ai_test \
LOCAL_AI_GATEWAY_SOURCE=/home/lennart/ai-services \
LOCAL_AI_PROTOCOL_PYTHON=/tmp/site-local-ai-protocol-venv/bin/python \
LOCAL_AI_GATEWAY_CHECKOUT=/home/lennart/ai-services \
LOCAL_AI_GATEWAY_PYTHON=/tmp/site-local-ai-protocol-venv/bin/python \
npm test -- --runInBand
```

The test-host tools create synthetic media; they are not a Windows production
installation requirement. Final Node 24.20.0 full suite: **408 passed suites / 5,286 passed tests**;
8 suites / 122 tests skipped by their existing conditional prerequisites. All
configured coverage thresholds passed (71.78% statements, 50% branches, 80.79%
functions, 72.64% lines). This includes the media-OFF/v1 queue regression and
rendered oversized-overwrite receipt invalidation. The focused Local AI pass
also passed 268 tests before the final full run. No production initialization, deployment, restart, production container stop, GPU
inference, credential issuance or Gateway file edit occurred.
