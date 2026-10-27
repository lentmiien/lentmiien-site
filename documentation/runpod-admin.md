# Runpod REST API v2 admin integration

## Scope

`/admin/runpod` is an administrator-only dashboard for monitoring and managing
Runpod Pods and network volumes. All provider requests use the production REST
API v2 origin:

```text
https://api.runpod.io/v2
```

The catalog and billing monitor uses:

- `GET /v2/catalog/gpus?include=AVAILABILITY&product=POD&cloud=<SECURE|COMMUNITY>`
- `GET /v2/catalog/cpus?include=AVAILABILITY&product=POD`
- `GET /v2/catalog/datacenters`
- `GET /v2/catalog/templates?source=official`
- `GET /v2/billing?bucketSize=<allowlisted>&lastN=<1..366>`
- `GET /v2/billing` with an explicit UTC monthly range for the durable account ledger
- `GET /v2/billing/pods` with the same range for exact per-Pod compute and disk charges

Pod management uses:

- `GET` and `POST /v2/pods`
- `GET`, `PATCH`, and `DELETE /v2/pods/{id}`
- `POST /v2/pods/{id}/action` with `start` or `stop`
- `GET` and `POST /v2/templates`
- `PATCH /v2/templates/{id}`

Network-volume management uses:

- `GET` and `POST /v2/network-volumes`
- `GET`, `PATCH`, and `DELETE /v2/network-volumes/{id}`

Management REST v1 is not used. Catalog, billing, template, volume, Pod, and
standalone Secret bootstrap operations use REST API v2. Secrets use
`GET /v2/account/secrets?name=...` and `POST /v2/account/secrets`; values are
write-only and an existing name is never overwritten. Workload paths such as
`/v1/chat/completions` belong to llama.cpp's OpenAI-compatible API and are unrelated
to retirement of the Runpod management API.

The account owner supplied Runpod's provider email confirming **Monday October 19,
2026** as the start of GraphQL limits, explicitly eight days earlier than the
previous October 27 notice: **180 requests/minute, 3,600/hour, 43,200/day per user**.
The email states that the same limits apply to REST v2 and recommends exponential
backoff on HTTP 429. Equal quotas do **not** establish whether GraphQL and REST v2
consume one shared bucket. It also confirms management REST v1 stops November 15,
2026 and external GraphQL ends January 2027, and links the
[agent skills](https://docs.runpod.io/get-started/agent-skills).

The older [public Q3 announcement](https://www.runpod.io/blog/runpod-q3-2026-releases),
retrieved again on 2026-10-20, still says October 27; this is public-document lag,
not uncertainty about the owner's provider notice. The public OpenAPI schema was
also retrieved on 2026-10-20 to verify correlation fields and pagination contracts.
REST v2 limits are per user across multiple windows; the transport reads
`RateLimit-Policy`, `RateLimit`, and `Retry-After` and retains the known local ceilings.
References: [rate limits](https://docs.runpod.io/api-reference-v2/rate-limits),
[public schema](https://api.runpod.io/v2/openapi.json),
[secret creation](https://docs.runpod.io/api-reference-v2/account/create-a-secret),
[secret listing](https://docs.runpod.io/api-reference-v2/account/list-secrets).

## Request coordination and diagnostics

All default clients share a bounded priority queue and cooldown in the same Node
process. Stop/termination requests and pod reconciliation reads precede catalog,
billing and log work that has not started. Urgent work can displace a queued
lower-priority request when the bounded queue is full. Already running requests are bounded
but not preempted. After eight urgent admissions, the oldest ready background
request gets a turn; each class is FIFO. Every request respects the longest exhausted quota window or
Retry-After delay, including HTTP dates. Valid long delays are never shortened to
fit a local budget. Malformed metadata receives a conservative 60-second cooldown
and a bounded warning. A request whose cooldown exceeds its budget fails with
`RUNPOD_COOLDOWN`, `retryable`, `retryAt` (epoch milliseconds), and `retryAfterMs`
instead of sleeping indefinitely. Operation polling propagates cooldowns longer
than 30 seconds rather than sleeping for hours; saved lifecycle deadlines remain.

Independent rolling windows cap all admitted attempts at 180 in 60 seconds,
3,600 in 3,600 seconds, and 43,200 in 86,400 seconds, even without headers.
Reservations are atomic within this coordinator and include retries, all methods,
and SSE connections; local validation failures may conservatively count too.
Fixed timestamp rings use at most 46,980 entries (about 367 KiB).
Server remaining counts additionally restrict admission and are decremented locally;
concurrent or out-of-order responses cannot replenish a still-active restriction.
Longer server cooldowns win. Higher server allowances do not raise the conservative
local ceilings; lower configuration can leave headroom for external tools.
No exhausted window is bypassed for a stop. An hour/day exhaustion returns a defer
immediately when it cannot fit the request budget (30 seconds by default).

Only GET reads retry 429, 408, 500, 502, 503, 504 and transport timeout/network
failures. The default is two retries, with exponential backoff starting at 250 ms
and up to 100% jitter, capped at 5 seconds before jitter. Backoff/cooldown consumes
no active request slot. Cancellation and the total budget cover queue time,
connection, and streamed response reads. The cost guard performs expired stops
before background observation; coalesced creation recovery runs independently
and does not block the next guard tick. Writes (including start, restart, PATCH,
and delete) are never automatically replayed. Mutation 429 is a typed retryable
error; a new operation must renew its preconditions. Provider error payloads are
bounded and Secret bootstrap errors suppress them entirely.

| Configuration | Default | Bounds |
| --- | ---: | --- |
| `RUNPOD_API_TIMEOUT_MS` | 10000 | 250–120000 ms per attempt |
| `RUNPOD_API_CACHE_TTL_MS` | 30000 | 0–300000 ms |
| `RUNPOD_API_BUDGET_MS` | 30000 | 1000–180000 ms total |
| `RUNPOD_API_CONCURRENCY` | 4 | 1–16 active requests |
| `RUNPOD_API_QUEUE_LIMIT` | 64 | 1–256 waiting requests |
| `RUNPOD_API_READ_RETRIES` | 2 | 0–4 retries |
| `RUNPOD_API_MINUTE_LIMIT` | 180 | 1–180 attempts / rolling 60 seconds |
| `RUNPOD_API_HOUR_LIMIT` | 3600 | 1–3600 attempts / rolling hour |
| `RUNPOD_API_DAY_LIMIT` | 43200 | 1–43200 attempts / rolling day |
| `RUNPOD_POLL_INTERVAL_MS` | 5000 | 2000–60000 ms |
| `CODEX_RUNPOD_STATE_MAX_AGE_MS` | 180000 | 120000–600000 ms |

Cached catalog/billing reads share results by credential within the process.
Mutation preflights explicitly bypass cached and already in-flight results.
Overlapping billing syncs coalesce. Pod/volume lists reject malformed IDs and
incomplete pagination rather than infer absence from truncated evidence. Accounts
above the bounded list sizes need an explicit pagination implementation before
management is enabled; the site fails closed rather than silently truncating.
The guard still runs at startup and every 60 seconds, including when idle. This
change does not reduce the approximately 1,440 idle pod-list reads per day.

The admin page exposes aggregate request, HTTP status, retry, failure, and queue
counts. Counters and rolling windows reset on process restart; there are no per-success request logs.
Throttling warnings include bounded aggregates at most once a minute. These are
**in-process controls**, not an account-wide quota guarantee: other Node processes,
CLI invocations and clients with a different injected fetch/coordinator have
independent queues and may consume the same user/account capacity. Restarts do not
recover earlier local consumption; server headers/cooldowns remain essential for
usage outside this process. Same-process default clients share limits even across
keys, conservatively assuming those keys could belong to one user. The earlier implementation
review reported one Node process but did not establish exclusive account use. No
Runpod Gateway change is part of this work.

## Durable creation and cost-guard recovery

Before a billable pod or volume create, MongoDB must accept a creation intent.
The new `runpod_creation_intents` collection contains at most one current record
per resource kind (`_id: pod` or `volume`); its built-in unique `_id` index prevents
concurrent unresolved creations even across app processes. Records contain only
an operation UUID, provider name/ID, state, start time and intended stop deadline,
never environment payloads or credentials. Resolved records can be replaced by
the next authorized operation; unresolved records are never automatically expired.
Pods carry the UUID in the supported `env.LENTMIIEN_CREATION_OPERATION` field;
volumes use the supported `name` field with a UUID suffix. These are correlation
identifiers, **not provider idempotency keys**. Existing pod names remain unchanged.

A lost creation response becomes `unknown` and blocks another creation of that
kind. Every guard tick reconciles unresolved intents. A crashed in-flight request
has a 10-minute recovery lease; an explicitly failed request can reconcile
immediately. Recovery uses an exact identifier match, then a fresh detail read.
A successfully persisted managed pod is retained with its original deadline. An
untracked correlated resource is rolled back; attached volumes are not deleted.
Cleanup remains unresolved until an exact detail 404 and a complete provider
list corroborate absence after a persisted deletion request. A known create ID
missing from a list alone never proves rollback succeeded.
There is no fuzzy-name deletion or automatic create replay. This durable gate
covers application-managed creates. Standalone `--execute` smoke/provisioning
provider-only scripts and external account tools remain operator-owned and do not
participate in the MongoDB gate (the downloader/gateway scripts use it when running
through the application manager with MongoDB). Provider-only scripts print a random
exact pod environment/volume-name correlation **before** each create and the provider
ID when observed. Save the output: these are operator records, not durable claims.
There is no automatic create retry. Unknown outcomes explicitly warn that billing
may have started and require reconciliation before rerun; failed cleanup exits
nonzero and identifies the resource. A process kill can still prevent cleanup.
Retained network volumes/templates are intentional and reported, not proof of zero
remaining storage charges. Never delete by a similar name or use a standalone
script to bypass an unresolved application intent.

If no ID was ever observed and no exact match exists, the dashboard continues to
show **unknown**. Absence at one instant cannot prove that a delayed create will
never finish. For operator remediation: pause new creates of that kind, inspect
the displayed operation UUID and exact provider name/environment metadata, and
confirm the outcome with Runpod support if necessary. Do not delete by a similar
name or repeat creation from another tool. Only after the provider confirms the
original request cannot still create a resource (or its exact resource has been
removed) may an administrator mark that **specific `_id` plus `token`** resolved
in MongoDB. Keep an operational audit of that decision. No automatic timeout
unlocks unknown creations, and no web route bypasses this gate.

Starts save the requested deadline **before** sending the billable action. A
failed database write blocks the start; a lost provider response leaves that
deadline active. Manual stops persist `stopRequestedAt` before the request, and
the guard retries those requests even if their original runtime deadline is in
the future. A RUNNING acknowledgement is reported as pending, never as stopped.
Failed/nonterminal stops retain the original deadline. Confirmed inactive states
can clear it. Synchronization repairs missing active deadlines from the observed
start/creation time, without extending valid deadlines, and guards updates
against concurrent local actions. Old records need no destructive migration:
`stopRequestedAt` is nullable and deadline repairs occur during observation.

Codex uses the local RUNNING mirror only while its provider observation is fresh
(default three minutes, allowing two delayed 60-second ticks). Missing, malformed,
stale or implausibly future timestamps make the model unavailable with an
explanation; no provider HTTP request is made for each Codex turn. Finishing a
long model setup does not refresh an old provider observation; readiness may
wait until the next guard observation.

Application safeguards still depend on a functioning database, process, provider
API and account authority. Provider outages or long account cooldowns can delay
stops; they cannot be guaranteed while the app is down. Pending failures remain
visible for operator follow-up. No paid-resource test was performed for this
release; remote eventual consistency and live quota enforcement were not exercised.

## Follow-up release validation (2026-10-20)

Independent follow-up review corrected the missing multi-window fallback, tightened
pagination validation and concurrent lifecycle updates, propagated long cooldowns,
and made standalone unknown/cleanup outcomes explicit. Exact pod correlation uses
`env.LENTMIIEN_CREATION_OPERATION`; the public schema says template environment is
merged per key, so adding correlation preserves inherited settings. Volume
correlation uses its exact UUID-suffixed name. Existing mounted authentication,
semantic capabilities, admin scope, CSRF, bounded forms and private-cache controls
remain in place and their negative tests pass.

Node 24.20.0 validation: 28 focused suites / 399 tests passed; full coverage run:
409 suites / 5,333 tests passed, 17 suites / 261 tests skipped. Final lifecycle and
index-schema assertions also passed (2 suites / 106 tests). Skips cover disposable
MongoDB integrations, pinned external gateway/Python fixtures (including one
partially skipped clock suite), and Windows-only storage prerequisites; they did
not run. Configured coverage thresholds passed. No paid-resource test, secret
bootstrap, production mutation, or live MongoDB index/restart validation was run.
No local `mongod` was available; actual deployment index readiness remains an
operator check below. No concrete code findings remain open from this review.

## Safe deployment verification

1. Fetch `origin`, review and merge `origin/fix/runpod-review-safeguards` into the
   normal release branch (PR or your normal reviewed merge), then update the deployment
   checkout to that resulting release commit with a clean fast-forward. If a host
   intentionally tracks the fix branch, use `git switch fix/runpod-review-safeguards`
   and `git pull --ff-only origin fix/runpod-review-safeguards`. Verify the checkout
   with `git rev-parse HEAD` and confirm `git merge-base --is-ancestor <reviewed-sha> HEAD`
   exits zero before restarting. Use Node 24.20.0 and
   `npm ci` for the normal release build; restart through the existing service manager.
   Do not use `npm start` as a smoke test: prestart performs maintenance.
   No existing secrets need to be replaced. Keep the new defaults unless measured
   behavior justifies a change. Existing `RUNPOD_API_KEY`, application MongoDB and
   session configuration are required; there are no new required secret values.
   New quota variables are optional and default to the confirmed ceilings above.
   Leave the existing cost/runtime ceilings and semantic capability assignments in
   place. Do not print `.env` or secret values during checks.
2. Confirm MongoDB readiness and permission to create/write
   `runpod_creation_intents`, and that the existing pod collection accepts nullable
   `stopRequestedAt`. The creation gate relies on MongoDB's automatic `_id` index;
   no manual backfill or destructive migration is required. Mongoose adds the
   non-unique `{ stopRequestedAt: 1 }` index named `stopRequestedAt_1` on
   `runpod_pods`. If automatic index creation is disabled, have the DBA create that
   additive index with `db.runpod_pods.createIndex({stopRequestedAt: 1},
   {name: "stopRequestedAt_1"})` during the release; do not run `syncIndexes()` or
   drop existing indexes. Verify `db.runpod_creation_intents.getIndexes()` contains
   `_id_` (the collection can be provisioned by the DBA when creation permission is
   restricted) and `db.runpod_pods.getIndexes()` contains `stopRequestedAt_1` and
   existing `runpod_provider_pod_id_1`. No new unique secondary index is required.
   External MongoDB JSON-schema validators, if installed, must allow the intent
   model's fields and nullable Date `stopRequestedAt`; Mongoose-only deployments
   accept the additive fields without migration. Stop claims use existing
   `autoStopClaimedAt` with a five-minute stale lease; pending creation recovery
   waits ten minutes after a crash, then uses exact correlation. No TTL expires
   unresolved intents. These code paths have mocked restart/race regression tests;
   an actual MongoDB restart/index build was not exercised in this review.
3. Open `/admin/runpod` with an authorized session. Review the bounded request
   counters, any unknown intents, and the next two guard observations in logs.
   With no active pods, leave them absent; do not create a resource to test this.
4. Optionally run each Secret bootstrap with **`--check` only** to verify metadata
   and read permission. It never returns values or creates/overwrites a secret.
   Exact read-only commands (use the deployment's existing secret injection):
   `npm run bootstrap:runpod-cloudflare-secret -- --check` and
   `npm run bootstrap:runpod-llm-api-secret -- --check`.
   `npm run test:runpod-api-v2` is an optional read-only catalog/billing connectivity
   check without Express/DB startup. None of these creates a paid resource, but
   they consume API quota. Do not run provisioning scripts with `--execute` or
   either bootstrap without `--check` as release verification.
5. Confirm stale or stopped Runpod models are unavailable in Codex and that an
   account without Runpod capabilities cannot access the monitor. Investigate
   pending cleanup/cooldown warnings before authorizing new billable work.
6. If rollback is required, disable new creates first and resolve any pending
   intent and stop request before reverting: older code does not understand the
   new durable safeguards. Preserve the records for review.

## Ollama workflow

1. In **Download an Ollama model to a volume**, an administrator selects a
   network volume and types any valid Ollama model tag. The common path contains
   only those two choices plus the temporary-public-endpoint acknowledgement;
   GPU override, cost ceiling, container disk, and download window are collapsed
   under Advanced settings.
2. The app derives Secure Cloud and the exact data center from the selected
   volume, re-fetches current stock, and selects the cheapest compatible single
   GPU below the confirmed hourly limit. It creates or repairs a reusable private
   `lentmiien-ollama-model-downloader-v2` template automatically.
3. The temporary Pod mounts the volume at `/workspace`, streams Ollama
   `POST /api/pull`, verifies the exact tag in `GET /api/tags`, records the tag
   on the local volume, and permanently deletes itself. Its local Pod record is
   retained as a model-download audit record with running time and cost.
4. In **Create an Ollama Pod**, choosing a volume automatically fixes Secure
   Cloud and the volume's data center, filters GPUs to compatible stock, and
   offers model tags previously verified on that volume. The Pod name, volume,
   model, GPU, and auto-stop duration remain prominent; filters, cloud, GPU count,
   placement, disks, global networking, and cost ceiling are under Advanced.
5. Runpod creates one serving Pod from the selected private Ollama profile. The
   preferred `ollama-cloudflare` profile binds Ollama to `127.0.0.1:8080`, starts
   the named tunnel connector, and exposes no Runpod proxy port. The diagnostic
   profile retains the original `11434/http` proxy. The local record receives
   an automatic stop deadline immediately. A stopped Pod must be given a new
   bounded “Start for” duration each time it is resumed.
6. Background setup waits for `RUNNING`, checks either the exact configured
   Cloudflare hostname with its Access service-token headers or the fixed Runpod HTTPS proxy,
   calls Ollama `POST /api/pull` as a bounded progress stream, and verifies the model in
   `GET /api/tags`. For the managed Qwen3.8 profile it then preloads the selected
   context with `POST /api/generate` and confirms the effective allocation in
   `GET /api/ps`. A model already present on the network volume completes this
   step without downloading its blobs again.
7. The dashboard exposes the stable authenticated hostname (or diagnostic
   public proxy URL) only after setup succeeds.

The preferred template uses `ollama/ollama:latest`, publishes no Runpod ports,
sets `OLLAMA_HOST=127.0.0.1:8080`, downloads a pinned/checksummed AMD64
`cloudflared` binary during the first container boot, and runs Ollama plus the
tunnel connector under a bounded wrapper command. The diagnostic template
exposes `11434/http` and sets `OLLAMA_HOST=0.0.0.0:11434`. Both normally persist
models under `/root/.ollama`.
When a network volume is selected, the Pod mounts it at `/workspace` and
overrides `OLLAMA_MODELS` to `/workspace/ollama/models`. Pin the image to a
digest in the UI when reproducible deployments are required.

The downloader and serving templates deliberately share the same on-volume
Ollama layout. Changing the model or volume does not require changing either
template: those are bounded per-job/per-Pod inputs. The downloader template is
for transfer and verification only; it is not kept running as an inference
server.

The live v2 handoff check populated the retained 50 GB Standard volume
`ollama-qwen3-8-27b-cache` in `EU-RO-1` with `qwen3.8:27b` (an 18 GB Ollama
package). A fresh Pod mounted the same volume, found the tag without a second
pull, and completed an inference without downloading the model again.

### Cloudflare Tunnel version for new Pods

The Qwen/Ollama creator and GLM quick-launch form both expose **Cloudflare Tunnel
version**. The default is `2026.10.4`; `2026.8.3` remains available for rollback.
Select the version before starting a new Pod. This does not change a currently
running Pod or its automatic-stop deadline. A stop/start retains that Pod's
original startup command; create a replacement Pod to apply a new selection.

Both starters share `services/runpodCloudflaredCatalog.js`. To offer a future
release, add its version and official **cloudflared-linux-amd64 SHA-256** to
`CLOUDFLARED_RELEASES`, then update `DEFAULT_CLOUDFLARED_VERSION` if desired.
The current default checksum comes from the [Cloudflare 2026.10.4 release](https://github.com/cloudflare/cloudflared/releases/tag/2026.10.4).
No `.env` setting or database migration is required. Deploy/restart the web app
to load code changes. The Qwen creator overrides even an older saved template's
startup command for the new Pod; GLM synchronizes its serving template on launch.
The installer reuses only an executable with the selected checksum, otherwise
downloads and verifies a replacement before installing it. Failed verification
halts startup. GLM context reloads retain a version selected at creation.

Security contract extension: this selector stays within the existing logged-in,
admin-managed Runpod feature. Qwen requires `runpod.pod.create`; GLM requires
`runpod.llama_cpp.create`. The admin
bundle grants these; family/user have no default grants. Existing POST, session
CSRF, private/no-store, form limits, cost limits, object checks, and production
failure logging apply. The new field accepts only catalog version strings;
URLs and hashes cannot be submitted by the browser. Downloads use fixed GitHub
release paths, HTTPS redirects, bounded time/retries, and SHA-256 verification.
Version metadata is non-secret and uses the existing provider environment/template
retention; no new personal data, private media, credentials, or endpoints are
introduced. Tests cover rejected versions before provider work, both launch
paths, stale saved templates, binary replacement, checksum/download failures,
and the existing mounted authorization/CSRF protections.

### Qwen3.8 27B context profiles

Qwen3.8 27B advertises a 262,144-token native window. The managed Ollama
profiles below assume its current Q4_K_M package, one loaded model, one parallel
request, Flash Attention, and the high-quality f16 KV cache. Context means the
combined prompt, image/input tokens, thinking, and answer; a client-side output
limit can still stop an answer before this total window is full.

| GPU VRAM | Comfortable context | Tighter reviewed ceiling | Guidance |
| --- | ---: | ---: | --- |
| 24 GB | 65,536 | 98,304 | Suitable for ordinary long prompts; the tighter tier leaves less room for vision/runtime workspace |
| 32 GB | 196,608 | 229,376 | Recommended RTX PRO 4500 profile; 196K is the live-verified balance |
| 48 GB | 262,144 | 262,144 | Comfortably reaches the model's full native window |
| 80+ GB | 262,144 | 262,144 | Native Ollama maximum is unchanged; use the margin for concurrency or a higher-precision model |

The 2026-09-03 RTX PRO 4500 Blackwell test used Ollama 0.33.2 and loaded
196,608 tokens in about 36 seconds. Ollama reported the requested context in
`GET /api/ps`, and a real chat request completed. Provider logs projected about
27.9 GiB of CUDA allocations on the 32,125 MiB device, leaving roughly 4.2 GiB
of nominal margin; this included about 12 GiB of target-model KV cache, 0.75 GiB
of draft/MTP KV cache, and recurrent-state/runtime allocations. A 229K window
is available as an explicit tighter option, but 262K consumes the remaining
32 GB margin and is reserved for 48 GB or larger GPUs in automatic selection.

New `qwen3.8:27b` Pods select the comfortable tier automatically from aggregate
VRAM, or an administrator can choose a reviewed size explicitly. A running Pod
can be changed in place: the app PATCHes its environment through REST v2,
resets the container, reloads the already-cached model, and verifies the
effective context with `/api/ps`. The Pod ID, GPU allocation, network volume,
and stable Cloudflare hostname remain unchanged. Active responses are
interrupted, the automatic-stop deadline does not move, and the app refuses to
start the reload when less than 15 minutes remain. Open WebUI should leave its
per-model context override unset or set it to the same value; otherwise its
request-level `num_ctx` can cause Ollama to reload a different allocation.

These are measured operating profiles, not an architectural guarantee. Ollama
KV use grows with context and parallelism, and vision or concurrent work needs
additional margin. If more concurrency is needed later, first move to a larger
GPU; changing `OLLAMA_NUM_PARALLEL` multiplies the effective context allocation.
For context beyond 262,144, use a separately tested vLLM/SGLang YaRN profile
rather than stretching this Ollama profile beyond the model's native window.

References: [Qwen3.8 27B model card](https://huggingface.co/Qwen/Qwen3.8-27B),
[Ollama qwen3.8 package](https://ollama.com/library/qwen3.8),
[Ollama context-length guide](https://docs.ollama.com/context-length), and
[Ollama FAQ memory controls](https://docs.ollama.com/faq).

Network volumes are independent, regional Secure Cloud resources. A Pod must be
created in the volume's data center. Stopping a Pod leaves the volume attached;
delete the old Pod before attaching the writable Ollama volume to replacement
hardware. The manager deliberately prevents a second provider Pod from sharing
the same writable volume because concurrent writers can corrupt data. Deleting
a Pod does not delete its network volume; volume deletion is a separate,
exact-name-confirmed operation.

Runpod's diagnostic proxy URL is public and Ollama has no application-level
authentication. The preferred path is the named tunnel protected by Cloudflare
Access. Stop releases GPU
compute, but retained storage may still incur charges; delete permanently
terminates the Pod and removes its attached Pod disk. An independent network
volume continues billing until it is explicitly deleted.

## Local persistence

MongoDB creates six collections:

- `runpod_workload_templates`: local setup recipes linked to private Runpod
  template IDs.
- `runpod_pods`: provider IDs, running/stopped/archived lifecycle state, hardware,
  confirmed rates, setup state, public URL, auto-stop deadline, the latest bounded
  operation/provider error summary, observed running and stopped durations, and
  provider-billed/estimated cost aggregates. `podPurpose` separates serving Pods
  from temporary `model_download` jobs; downloader records also retain automatic
  cleanup state and errors after the provider Pod is gone.
- `runpod_network_volumes`: provider IDs, region, tier, size, estimated monthly
  price, attached-Pod count projection, provider presence, latest bounded
  operation error, active/archived lifecycle state, and the normalized Ollama
  tags that this app has successfully verified on the volume.
- `runpod_operation_events`: bounded create/setup/start/stop/extend/delete/sync/template
  audit events without API keys, raw provider response bodies, or environment secrets.
- `runpod_billing_periods`: one durable account-wide UTC month from November
  2025 onward, including explicit zero rows for closed months omitted by Runpod
  and a provisional zero for an omitted current month.
- `runpod_pod_billing_periods`: exact monthly v2 compute and disk charges keyed
  by provider Pod ID and linked to the retained local Pod record.

Provider deletion archives local Pod and volume records instead of deleting
their audit history. Manual sync controls import untracked provider resources
and archive local records that no longer exist in the account.

The once-per-minute provider observer accrues durations between observations.
These times are operational estimates because v2 exposes current Pod state, not
a historical state-transition ledger. Provider billing is authoritative for
dollars and may lag recent usage. Billing records that predate local lifecycle
tracking create view-only `billing_history` Pod archives with exact available
costs and an explicit “time not recorded” state; no runtime is fabricated.
Observed estimates snapshot the documented Pod storage rates of $0.10/GB/month
for running container/volume disk and $0.20/GB/month for stopped volume disk,
using 730 hours/month; the provider ledger remains authoritative if prices or
billing rules change.

## Cost and failure controls

Defaults are deliberately conservative and can be tightened with environment
variables:

- At most two active provider Pods.
- At most 16 GPUs in a UI-created Pod by default (the provider's current
  per-machine catalog maximum still applies).
- A hard server ceiling of `$100.00` per hour by default; the UI defaults its explicit
  confirmation to `$1.00`.
- Network volumes are limited to 2,048 GB and an estimated `$150.00` per month
  by default. Each creation requires an explicit per-request cost confirmation
  and acknowledgement that storage bills until deletion. Standard storage uses
  the documented tiered estimate. High-performance volume creation is disabled
  unless `RUNPOD_HIGH_PERFORMANCE_STORAGE_USD_PER_GB_MONTH` is configured with
  the current regional rate; existing provider volumes can still be listed and
  attached.
- A mandatory 60-minute default auto-stop deadline and a maximum selectable
  unattended window of 24 hours. Stopped Pods expose bounded start durations;
  running Pods expose +30 minute, +1 hour, +4 hour, and custom extensions. An
  extension can never move the deadline beyond the configured maximum from now.
- Three Pod creation attempts per hour and 30 Runpod control requests per minute.
- Ten-minute serving provisioning and thirty-minute ordinary model-pull
  deadlines. Dedicated downloader jobs default to a four-hour auto-stop window,
  a `$1.00` hourly confirmation ceiling, and a six-hour bounded pull/retry
  deadline (the four-hour stop remains authoritative unless extended through
  configuration). Large pulls retain Ollama's partial blobs and retry transient
  Runpod proxy timeouts.

The server validates fresh provider availability and price immediately before
creation. If Runpod returns a total rate above the administrator's confirmation
or the server ceiling, the newly created Pod is deleted before local persistence.
Setup failure records a safe error code and attempts to stop the Pod. A live
browser countdown warns at ten minutes and becomes urgent in the last minute;
the server-owned deadline and scheduler remain authoritative. The automatic-stop
worker claims an expired deadline atomically so it cannot race a simultaneous
extension. A scheduler observes provider state and checks expired deadlines once
per minute while the application is running; a second scheduler refreshes account and per-Pod billing every six hours. An
operator should still keep provider billing alerts enabled as defense in depth.

After downloader verification, provider deletion and local archival are a
separate cleanup phase. A cleanup failure does not relabel a successfully cached
model as a failed download: it records a visible provider error, attempts to stop
the temporary Pod, and leaves manual stop/delete controls available. Pending
cleanup is resumed after process restart.

Runpod may be unable to resume a stopped Pod whose original host-local GPU is no
longer available. Start failures distinguish this capacity case and recommend
waiting or deleting and redeploying. The affected Pod retains the provider HTTP
status, provider code/title/detail when supplied, and a stable application error
code. These fields are length-bounded, control characters are removed, known
credential patterns and the configured API key are redacted, and raw response
bodies are neither persisted nor logged.

## Very-large-model roadmap

Network volumes are the storage foundation, but they are not the inference
engine. The staged path to models that do not fit on a local workstation is:

1. **Regional model caches (implemented and live-verified).** Choose the eventual serving region
   and GPU family before creating a volume. A cheap, short-lived Pod can populate
   the volume; after that Pod is deleted, a larger Pod in the same data center
   can mount the same files. Separate or replicated volumes are required when
   moving to another region.
2. **Dedicated Ollama download jobs (implemented).** The app selects inexpensive
   location-compatible GPU capacity, uses a reusable template, resumes Ollama
   blobs after transient proxy failures, verifies the tag, records local
   inventory, and removes compute automatically. A future Hugging Face importer
   should add free-space checks, allowlisted repository/revision inputs,
   manifest/checksum recording, and S3-based imports where appropriate.
3. **A vLLM serving template.** Add a pinned vLLM image and OpenAI-compatible API
   profile with model path, dtype/quantization, context length, tensor-parallel
   size, memory-utilization, and API-key controls. Use one high-memory GPU when
   possible, then tensor parallelism across the GPUs of one machine. Add SGLang
   as a separate profile after the same model/volume contract is proven; it
   should not be hidden inside the Ollama template.
4. **Capacity planning.** Estimate weights, quantization overhead, KV cache,
   context length, and runtime headroom before showing eligible machines. The app
   ceiling is now configurable above four GPUs and `$10/hour`, but provider stock
   and per-machine maximums remain authoritative. Hundreds-of-billions-parameter
   models will commonly need an 8-GPU high-memory machine; workloads exceeding
   one machine should move to a distinct multi-node/cluster phase.
5. **Authenticated stable access (implemented and live-verified).** The
   named Cloudflare Tunnel + Access profile keeps one hostname across Pod
   deletion/recreation, removes direct Runpod proxy exposure, and supports both
   human login and service-token API clients. The 2026-09-02 Qwen validation
   confirmed the retained model volume, Pod-local Ollama service, outbound-only
   tunnel, stable hostname, anonymous denial, Service Auth policy, saved origin
   Host override, and an authenticated `qwen3.8:27b` generation. The disposable
   `$0.72/hour` RTX PRO 4500 Pod was then deleted; the regional model volume and
   reusable private templates remain.
6. **Multi-region and multi-node operation.** Add explicit artifact replication,
   read-only serving mounts where the provider supports them, topology-aware
   scheduling, health checks, and multi-node vLLM/SGLang only after the
   single-node tensor-parallel path is reliable.

Runpod's current network-volume behavior and constraints are documented at
<https://docs.runpod.io/storage/network-volumes>. vLLM parallel-deployment
guidance is at <https://docs.vllm.ai/en/stable/serving/parallelism_scaling/>.
Twingate's Linux Connector setup is documented at
<https://www.twingate.com/docs/connectors-on-linux>.

### First GLM-5.3-Flash run: pinned implementation plan

The first very-large-model target is
[`unsloth/GLM-5.3-Flash-GGUF`](https://huggingface.co/unsloth/GLM-5.3-Flash-GGUF),
a 321B-total / 18B-active MoE. Do **not** reuse the current Ollama profile for
this first run. As of 2026-09-02, GLM-5.3-Flash support is still the unmerged
[`llama.cpp` PR #27754](https://github.com/ggml-org/llama.cpp/pull/27754), and
the PR documents two current correctness requirements:
`NVIDIA_TF32_OVERRIDE=0` and flash attention disabled. An ordinary Ollama image
can therefore lag the required architecture support even though Hugging Face
shows an `ollama run hf.co/...` convenience command.

Pin both moving inputs before downloading or building:

- Hugging Face repository revision:
  `2975ab414d30340466d8c51533c6e91f0cca64c1`
- Unsloth `llama.cpp` GLM branch revision:
  `949f7efb097eb20ef36fecdb1afaebff9a4ae7ed`

The two relevant quantizations are:

| Preset | Exact GGUF shard bytes | Published size | First-run fit |
| --- | ---: | ---: | --- |
| `UD-IQ4_XS` | 156,822,111,075 | 157 GB | Recommended first run; five shards and enough room for a useful context on 192 GB aggregate VRAM |
| `UD-Q4_K_XL` | 199,707,321,347 | 200 GB | Higher-quality/fidelity option; six shards and requires materially more VRAM headroom |

The optional BF16 vision projector is another 1,164,010,080 bytes. Keep the
first run text-only and omit it; multimodal verification is a later gate. A
dedicated **250 GB Standard network volume** is the recommended `UD-IQ4_XS`
cache. At the current first-terabyte rate of `$0.07/GB/month`, it costs about
`$17.50/month`. Use 300 GB (`$21/month`) for `UD-Q4_K_XL`. The volume must be in
the same data center as every preparer and serving Pod and cannot be shrunk.

Current Secure Cloud candidates from the 2026-09-02 live v2 catalog are:

| Candidate | Aggregate VRAM | Current rate | Role / trade-off |
| --- | ---: | ---: | --- |
| 2 × RTX PRO 6000 Blackwell 96 GB | 192 GB | `$4.18/hour` | Recommended bounded `UD-IQ4_XS` attempt in EU-RO-1; about 46 GiB remains after the 146 GiB shard set, but the actual context/runtime fit must be measured |
| 1 × B200 180 GB | 180 GB | `$6.79/hour` | Simplest and likely fastest single-GPU `UD-IQ4_XS` attempt; less headroom and low current stock |
| 4 × A100 SXM 80 GB | 320 GB | `$6.36/hour` | More conservative GGUF headroom and fast interconnect; requires a volume in an A100-compatible data center |
| 4 × RTX PRO 6000 Blackwell 96 GB | 384 GB | `$8.36/hour` | Same-region fallback for `UD-Q4_K_XL` or larger contexts if two GPUs do not fit |
| 4 × A40 48 GB | 192 GB | `$1.76/hour` | Cheapest theoretical `UD-IQ4_XS` fit, but low stock, a different volume region, and substantially lower bandwidth make it a secondary experiment |

These are catalog rates, not reservations. Before creation the app must refresh
the exact data-center stock, confirm that the requested count exists on one
machine, and reject any returned Pod rate above the administrator's explicit
limit. Start at 32,768 context tokens, one parallel slot, and a 60-minute
automatic stop. Prompt/history, reasoning, and the visible answer share this
total window. The server leaves generation unlimited within that window. A
model advertising 1M context does not imply that 1M context fits this VRAM
budget.

A 2026-09-03 live calibration on 2 × RTX PRO 6000 Blackwell Server Edition
GPUs found that 128K starts successfully and serves authenticated completions,
but it is the practical ceiling for this profile: `nvidia-smi` reported
94,901 / 97,887 MiB and 93,125 / 97,887 MiB immediately after readiness. The
32K run was approximately 77–78 GiB per GPU. Interpolating the runtime's much
larger context-dependent attention workspace—not just the relatively small KV
cache—gives these planning ranges:

| Total context | Approximate VRAM used per GPU | Planning tier |
| ---: | ---: | --- |
| 32K | 77–78 GiB | Conservative |
| 64K | 82–84 GiB | Comfortable |
| 96K | 87–90 GiB | Recommended high-context balance |
| 128K | 90.9–92.7 GiB observed | Maximum tested; only 2.9–4.7 GiB free |

The exact allocation can change with llama.cpp revisions, batching flags, and
GPU placement, so remeasure after a runtime change. The server emits one
`RUNPOD_LLM_GPU_MEMORY` marker per GPU after readiness for that purpose.

The pinned llama.cpp server profile should use:

- model path on the network volume, beginning with the first split GGUF shard;
- `--gpu-layers all`, one slot, `--ctx-size 32768`, `--n-predict -1`, and layer
  split across all visible GPUs;
- `NVIDIA_TF32_OVERRIDE=0` and `--flash-attn off` until the pinned PR says those
  workarounds are no longer required;
- `--host 127.0.0.1 --port 8080`, no Runpod proxy ports, and the existing named
  Cloudflare Tunnel;
- `LLAMA_API_KEY={{ RUNPOD_SECRET_lentmiien_llm_api_key }}` in addition to
  Cloudflare Access. The encrypted provider Secret is bootstrapped separately
  and no credential value belongs in a template or database;
- alias `glm-5.3-flash`, disabled built-in agent/tools, and text-only startup for
  the first verification.

Open WebUI must use an **OpenAI-compatible connection**, not its Ollama
connection: base URL `https://llm.lentmiien.com/v1`, API key equal to the native
LLM key, plus the two Cloudflare Access service-token headers. The browser root
may use Cloudflare interactive login, but API requests need both authentication
layers. Leave Open WebUI's per-model context/output overrides unset unless a
smaller bound is intentional. An API request's `max_tokens` still imposes its
own output cap, while llama.cpp's server default is unlimited inside the shared
context window.

Implementation sequence:

1. Add a model-artifact record that pins repository, revision, quant, exact file
   manifest/checksums, byte size, volume, preparation state, and compatible
   runtime revision. The existing `cachedModels` string list is not sufficient
   evidence for a 157–200 GB external artifact.
2. Add a preset-only Hugging Face preparer. It creates no arbitrary outbound URL:
   it downloads the allowlisted repository/revision and selected shard directory
   to the chosen co-located volume, verifies the manifest and free headroom,
   builds the pinned GLM llama.cpp revision, records the result, and deletes its
   cheap temporary GPU Pod.
3. Add a private llama.cpp Cloudflare template and Pod creator. Keep model,
   volume, recommended GPU configurations, duration, and maximum cost prominent;
   context, parallel slots, tensor split, and runtime flags belong under
   Advanced.
4. Add OpenAI-compatible readiness (`/health` and `/v1/models`) and a short
   authenticated `/v1/chat/completions` verification. Setup is not successful
   merely because the Pod is `RUNNING`.
5. Retain the existing lifecycle, usage/cost, countdown, extension, start-error,
   provider-error, archival, one-volume-writer, and one-tunnel-connector controls.
   Delete compute after a failed test; never delete the large model volume as
   implicit Pod cleanup.

An administrator can change a running managed llama.cpp Pod between the reviewed
16K, 32K, 64K, 96K, and 128K context sizes. The app PATCHes only the Pod's generated
entrypoint arguments through Runpod v2 and then verifies the effective `n_ctx`
from `/props` before marking setup ready. Runpod resets the container for this
edit, so active responses are interrupted and the model must reload. The Pod,
GPU allocation, attached network volume, and stable Cloudflare URL remain in
place; ephemeral container-disk changes outside `/workspace` do not. The
automatic-stop deadline is deliberately unchanged and the app refuses to begin
a reload with less than 15 minutes remaining. The UI recommends extending by at
least 30 minutes first.

Steps 1 and 2 now have an implementation path in the admin page. The
`runpod_model_artifacts` collection stores the immutable source/runtime contract
and preparation lifecycle, while the `glm53-artifact-preparer` workload profile
creates a private no-port Pod. The browser selects only a reviewed preset,
co-located volume, optional GPU, and hourly ceiling; repository URLs, revisions,
commands, and hashes are not request parameters. The preparer uses a pinned
Hugging Face CLI, checks remaining volume capacity with 10 GB of headroom,
downloads only the five approved shard paths one at a time and reuses finished
shards between attempts. It removes incompatible incomplete Xet reconstruction
files before using sequential HTTP transfers, because Xet's background writer
can fail and consume the network-volume quota. Each shard gets four attempts with a 15-minute
stalled-transfer timeout. The workflow then validates exact sizes and SHA-256
hashes, builds (or safely reuses) the pinned CUDA llama.cpp server, atomically
writes `READY.json`, and waits for verified cleanup. An independent four-hour
`timeout` inside the container stops GPU work even if the application monitor
disappears.

The upstream-supported performance alternative is native FP8 with vLLM 0.29+.
Its [official GLM-5.3-Flash recipe](https://recipes.vllm.ai/zai-org/GLM-5.3-Flash)
reports roughly 306 GiB of weights before runtime/KV overhead and recommends an
H200 TP=8 deployment. At the current Secure Cloud catalog rate that is about
`$36.72/hour`. It is the later high-throughput/multimodal path, not the cheapest
way to prove the 157 GB GGUF workflow.

Security contract for the planned GLM artifact/preparer/serving extension:

```text
Feature: Pinned Hugging Face model-artifact preparation and llama.cpp serving on Runpod
Security zone: logged-in
Interactive principals: admin
Machine principals: internal bounded artifact-preparation and Pod-observer jobs; Cloudflare Access service-token client
Data classification: sensitive provider resource/artifact metadata; secret Runpod, tunnel, Access, and native LLM credentials
Capabilities: runpod.model_artifact.read, runpod.model_artifact.prepare, runpod.model_artifact.archive, runpod.llama_cpp.create, runpod.llama_cpp.reconfigure, plus the existing Pod lifecycle capabilities
Object scope: account-wide admin-managed records resolved from local MongoDB IDs; provider volume/Pod IDs are derived server-side
Admin override: no implicit override; each operation requires its explicit semantic capability
Browser mutations and CSRF control: POST only; shared token, Origin, and Fetch Metadata checks
Public/secret abuse controls: admin authentication, semantic capability checks, fixed preset/revision allowlist, one preparer per volume, one writable Pod per volume, one active tunnel connector, fresh provider stock/price checks, explicit storage and hourly confirmations, GPU/Pod ceilings, mandatory automatic stop, and cleanup that never implicitly deletes the model volume
Request and upload limits: URL-encoded forms only, existing 16 KiB/20-field boundary; no browser uploads or caller-selected URLs
Output/rendering contexts: bounded provider/artifact metadata through escaped Pug interpolation; no raw logs, model output, credentials, or provider bodies
Private file/media storage and delivery: model/runtime files exist only on the provider network volume and are not proxied through this application
Outbound hosts/services: application to fixed Runpod v2 and exact Cloudflare gateway origins; preparer Pod to allowlisted Hugging Face repository/revision and pinned GitHub runtime revision only, with redirects/size/time bounded by the preparer implementation
Cache policy: admin responses private/no-store
Security-relevant logs (without personal data): stable action, artifact slug, outcome, safe error code, and provider HTTP status; never filenames containing tokens, signed URLs, prompts, model output, headers, or secrets
Retention/deletion behavior: artifact metadata and manifests remain for audit after archival; temporary preparation state/logs are bounded; deleting a Pod never deletes a volume; deleting a volume requires its existing exact-name confirmation and archives linked artifact records
Required negative security tests: anonymous/non-admin/missing-capability denial; CSRF/Origin failure; unknown preset/revision/path/variant; oversized manifest; path traversal; absent/small/wrong-region/in-use volume; duplicate preparer/tunnel connector; unavailable GPU/count; compute/storage ceiling; provider timeout/redirect/oversize/checksum mismatch; secret redaction; failed preparation/serve cleanup; successful authenticated external inference
Legacy dependency or migration plan: additive collection and separate runtime profile; the existing Ollama profiles remain available and provide rollback while the GLM workflow is proven
```

## Recommended stable authenticated gateway

Use a **named Cloudflare Tunnel protected by Cloudflare Access** as the first
gateway profile. The stable identity lives in Cloudflare, not in the disposable
Pod:

1. Create one named tunnel and map `llm.lentmiien.com` to
   `http://127.0.0.1:8080`. Ollama rejects the public hostname as an origin Host,
   so set the route's **HTTP Host Header** to `localhost:8080`. This setting is
   required in the Cloudflare dashboard for a remotely managed tunnel; a flag on
   the Pod connector does not override the centrally managed route configuration.
2. Add a Cloudflare Access self-hosted application for the entire hostname. Use
   a narrow identity Allow policy for browser access. Add a separate Service Auth
   policy whose Include rule uses the **Service Token** selector and selects the
   dedicated token. API clients send
   `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers.
3. The current private Ollama profile overrides the container entrypoint with a
   bounded wrapper that runs both `ollama serve` and `cloudflared tunnel run`. The
   remotely managed route rewrites the origin Host header to `localhost:8080` as
   required by Ollama. The wrapper downloads
   a pinned/checksummed `cloudflared` binary on first container boot. Replace this
   bootstrap with a pinned custom image before the first very-large-model run, so
   production startup no longer depends on package and release downloads. The
   current bootstrap path nevertheless passed the 2026-09-02 end-to-end Qwen test.
   The tunnel token lives in the encrypted Runpod Secret
   `lentmiien_cloudflare_tunnel_token`; the provider template contains only
   `{{ RUNPOD_SECRET_lentmiien_cloudflare_tunnel_token }}`. Access service-token
   values remain only in application/Open WebUI secret configuration.
4. Reuse the same named tunnel token in every replacement Pod. DNS and the Access
   application do not change when the Runpod Pod ID changes. When no Pod is
   running the stable hostname is unavailable; when a replacement starts,
   `cloudflared` reconnects that same hostname to its local Ollama service.
5. In this gateway profile, do not expose `11434/http` through Runpod at all.
   Cloudflare Tunnel uses outbound connections, so Ollama can remain bound to the
   Pod-local interface. Keep the current public-proxy template available as an
   explicit diagnostic fallback until the gateway image is proven.

Only run one writable/serving Pod for this tunnel and volume during ordinary
replacement. Cloudflare supports multiple replicas of a named tunnel and routes
traffic between them, but two replicas pointing at different transient model
servers would make sessions and loaded-model state nondeterministic unless that
is a deliberate load-balanced design.

For browser use, Access presents the normal identity login and then uses its
session cookie. For scripts, Open WebUI's server-side Ollama connector, or other
non-interactive clients, use a dedicated service token rather than trying to
automate a browser login. If a client cannot attach the two Access headers, put a
small local authenticated adapter in front of it or use an Access-aware client;
do not bypass the policy for the Ollama API.

Open WebUI 0.10+ can attach these headers directly. In **Settings → Admin →
Connections → Manage Ollama API Connections**, set the URL to
`https://llm.lentmiien.com` and set the connection's **Headers** JSON to the two
Cloudflare service-token headers. The same configuration can be supplied through
`OLLAMA_API_CONFIGS`; do not bake the header values into an image or commit them.
Cloudflare Access is the authentication layer for the Ollama profile because
Ollama does not enforce `RUNPOD_LLM_API_KEY`. The GLM llama.cpp profile adds that
key as a second layer and serves the OpenAI-compatible API under `/v1`.

Twingate remains viable if private-network semantics are more important than a
normal HTTPS URL: run a Connector where it can reach Ollama, define a narrow
resource/alias for port 11434, and install the Twingate client on every consuming
device. Co-locating the Connector with the Runpod Pod still requires a custom
multi-process image, and the Connector disappears whenever that Pod stops.
Twingate is therefore attractive when the household already uses it broadly,
but Cloudflare Tunnel + Access is simpler for browser and HTTP API use across
frequent Pod replacement.

Relevant current references:

- <https://developers.cloudflare.com/tunnel/setup/>
- <https://developers.cloudflare.com/tunnel/configuration/>
- <https://developers.cloudflare.com/cloudflare-one/access-controls/policies/>
- <https://developers.cloudflare.com/cloudflare-one/access-controls/authenticate-agents/>
- <https://www.twingate.com/docs/connectors>
- <https://www.twingate.com/docs/resources>

## Security contract

```text
Feature: Runpod REST API v2 monitor, Pod/network-volume manager, Ollama model downloader, and stable Cloudflare Access gateway
Security zone: logged-in, administrator only
Interactive principals: validated admin sessions
Machine principals: internal `runpod-state-observer`, `runpod-auto-stop`, and `runpod-billing-scheduler` labels; Cloudflare Access service-token client for outbound gateway checks; no inbound application machine route (`RUNPOD_API_KEY` is an outbound provider credential)
Data classification: public catalogs; sensitive account billing/resource metadata; secret provider, tunnel, Access-token, and future LLM-gateway credentials
Capabilities: runpod.catalog.read, runpod.billing.read, runpod.billing.sync, runpod.pod.read, runpod.pod.create, runpod.pod.start, runpod.pod.stop, runpod.pod.extend, runpod.pod.delete, runpod.pod.setup, runpod.pod.sync, runpod.model_download.create, runpod.model_artifact.prepare, runpod.ollama.reconfigure, runpod.llama_cpp.create, runpod.llama_cpp.reconfigure, runpod.network_volume.read, runpod.network_volume.create, runpod.network_volume.delete, runpod.network_volume.sync, runpod.template.manage
Object scope: explicitly admin-managed account resources; durable creation recovery acts only on an exact operation correlation and re-read provider ID; Pod and volume browser actions use local MongoDB IDs and resolve provider IDs server-side; model downloads accept a provider volume ID but verify it against the authenticated account's v2 volume list and derive cloud/location server-side; volume deletion also verifies the resolved provider ID against that list
Admin override: no implicit bypass; admin receives the explicit capability bundle and each mutation checks its semantic capability
Browser mutations and CSRF control: POST only; shared session token, timing-safe comparison, and Origin validation, with a same-origin Fetch Metadata fallback for opaque browser origins; Pod and volume deletion also require the exact resource name
Public/secret abuse controls: authentication plus admin guard, semantic capabilities, read/mutation/create rate limits, active-Pod ceiling, GPU ceiling, storage-size ceiling, fresh location-specific compute price check, confirmed hourly/monthly maxima, storage-billing/public-proxy acknowledgements, one-writer-per-volume enforcement, one-active-connector-per-named-tunnel enforcement, mandatory auto-stop, automatic downloader deletion, no Runpod port in the gateway profile, and Cloudflare Access at the stable hostname
Request and upload limits: URL-encoded forms only, at most 16 KiB and 20 scalar fields; no uploads; provider requests capped at 64 KiB; provider responses capped at 4 MiB; Secret metadata capped at 64 KiB while streaming; bounded shared queue/concurrency, total request budgets, GET-only retries and provider cooldowns
Output/rendering contexts: bounded normalized values rendered with escaped Pug interpolation; sanitized provider error fields may be shown to administrators, but no provider HTML, raw response bodies, environment values, or inline JSON
Private file/media storage and delivery: none
Outbound hosts/services: fixed HTTPS api.runpod.io v2 paths; standalone metadata-only checks and create-if-missing bootstrap on fixed HTTPS api.runpod.io/v2/account/secrets; exact <pod>-<port>.proxy.runpod.net diagnostic URLs; exact configured https://llm.lentmiien.com gateway origin; the Pod wrapper downloads only the pinned cloudflared AMD64 release URL and verifies its SHA-256; redirects rejected; Ollama paths restricted to /, /api/tags, /api/pull, /api/generate, and /api/ps
Cache policy: browser responses are private/no-store; catalog results use a short in-memory cache
Security-relevant logs: stable action/category/error code, bounded request/status/retry aggregates and operation UUID for unresolved creation; no keys, billing amounts, principal data or provider bodies
Retention/deletion behavior: provider deletion archives local serving and downloader Pod lifecycle/cost metadata plus volume and per-Pod billing metadata; verified model tags remain on the active volume record; account months, Pod billing periods, and audit events are retained; model files are permanently removed only by provider volume deletion; application databases persist only non-secret gateway mode/URL and Runpod Secret references, never credential values
Required negative tests: non-admin/capability denial (including separate model-download authority), invalid CSRF and Origin, oversized/non-form body, malformed local/provider ID/model tag, missing or in-use volume, unavailable hardware/storage location, active-Pod/GPU/compute/storage-cost limits, invalid start/extension/download duration, public-endpoint/storage-billing acknowledgement, exact delete confirmation, cross-region/community-volume rejection, provider timeout/error/oversize/redirect, provider-error redaction, proxy-host validation, exact Cloudflare-host validation, missing Access credentials, duplicate named-tunnel connector, Secret-bootstrap no-overwrite/error redaction, cleanup after failed creation/setup/download, successful-download cleanup failure, auto-stop/extension overlap, shared cooldown/backoff/priority/cancellation, nonterminal stops, ambiguous starts, durable unknown creation/restart recovery, stale local availability, and hung workload streams
Legacy dependency or migration plan: REST v2-only transports including Secret bootstrap; additive runpod_creation_intents collection with built-in unique _id gate and nullable Pod stopRequestedAt; no credentials persisted; resolve pending creation/stop intents before rollback because old code does not enforce them
```

The application has no shared recent-authentication or MFA gate yet. The feature
therefore uses the existing admin session plus semantic capabilities, CSRF, rate
limits, cost bounds, and exact-name deletion confirmation.

## Configuration and standalone checks

The key now needs the provider privileges required for Pod and account-template
management. Use the narrowest Runpod credential that supports those operations,
store it only in `.env`, and rotate it if exposed.

The stable gateway also uses:

- `RUNPOD_CLOUDFLARE_GATEWAY_URL` (exact HTTPS origin; defaults to
  `https://llm.lentmiien.com`)
- `RUNPOD_CLOUDFLARE_TUNNEL_TOKEN` (local bootstrap input only)
- `RUNPOD_CLOUDFLARE_TUNNEL_SECRET_NAME` (non-secret provider reference name)
- `RUNPOD_CLOUDFLARE_ACCESS_CLIENT_ID` and
  `RUNPOD_CLOUDFLARE_ACCESS_CLIENT_SECRET` (server-side Access checks)
- `RUNPOD_LLM_API_KEY` (native bearer key enforced by the GLM llama.cpp profile;
  Ollama continues to rely on Cloudflare Access)
- `RUNPOD_LLM_API_SECRET_NAME` (non-secret provider reference name; defaults to
  `lentmiien_llm_api_key`)
- `RUNPOD_LLAMA_CPP_STARTUP_TIMEOUT_MS` (application-side model-load deadline;
  defaults to 45 minutes)

Create the encrypted account Secret once, or check it without changing anything:

```bash
npm run bootstrap:runpod-cloudflare-secret
npm run bootstrap:runpod-cloudflare-secret -- --check
```

The native llama.cpp/vLLM gateway uses a separate encrypted Secret for the
`RUNPOD_LLM_API_KEY` defense-in-depth credential:

```bash
npm run bootstrap:runpod-llm-api-secret
npm run bootstrap:runpod-llm-api-secret -- --check
```

The command first lists Secret metadata. It never overwrites an existing Secret,
never returns the value, and prints only the configured Secret name/status. Runpod
REST v2 supplies the account-secret operations. Duplicate-name 409 and ambiguous
create responses trigger an exact-name re-read, never another write. Malformed,
oversized or incomplete lists fail closed. The bootstrap does not prove the value
of an existing Secret, because the provider never returns it.

The read-only connectivity check does not start Express, MongoDB, schedulers,
workers, or the `prestart` pipeline:

```bash
npm run test:runpod-api-v2
```

The destructive lifecycle check is a no-op without `--execute`. With the flag it
creates exactly one preferred single-GPU Secure Cloud Pod below `$1/hour`, sets
up Ollama and `qwen2.5:0.5b`, verifies stop/start persistence, and deletes the Pod
in a `finally` cleanup path:

```bash
npm run test:runpod-pod-lifecycle-v2 -- --execute
```

To pause after Ollama becomes ready for a manual browser check:

```bash
npm run test:runpod-pod-lifecycle-v2 -- --execute --pause-after-ready
```

The network-volume check is also a no-op without `--execute`. It creates one
disposable 10 GB Standard volume and at most one active Pod at a time. The first
sub-`$1/hour` Pod downloads `qwen2.5:0.5b`; it is deleted, then a second Pod
mounts the same volume and must find the model without another pull. Both Pods
and the test volume are deleted in bounded cleanup paths:

```bash
npm run test:runpod-network-volume-v2 -- --execute
```

The reusable model-downloader check is also a dry run unless `--execute` is
present. Select an existing retained volume and any valid Ollama tag; the script
derives the volume's data center, chooses currently available Secure Cloud
hardware below its hard `$0.99/hour` ceiling, downloads and verifies the model,
deletes that temporary Pod, then creates a fresh serving Pod on the same volume
and performs a real generation request without pulling the model again:

```bash
npm run test:runpod-model-downloader-v2 -- \
  --execute \
  --volume-id=gs09qherxl \
  --model=qwen3.8:27b
```

When `MONGOOSE_URL` is configured, this uses the same manager and durable audit
records as the web UI. Without it, the standalone check uses provider v2 directly
so it still avoids starting Express and the application's schedulers. Its bounded
cleanup removes both test Pods but intentionally retains the selected volume and
the two reusable private Ollama templates. It never permits more than two active
account Pods or more than one of its own Pods at a time.

The stable-gateway check is likewise a dry run by default. Before reading or
mutating Runpod resources, `--execute` sends one anonymous request and one
bounded request with the Access service-token headers. Anonymous access must be
denied, while a login redirect or 401/403 for the authenticated request fails with
`RUNPOD_CLOUDFLARE_ACCESS_DENIED`, so a policy mistake cannot rent a GPU. It then
syncs the Cloudflare profile, chooses one currently available 32+ GB Secure Cloud
GPU in the retained Qwen volume's data center below `$0.99/hour`, verifies that
anonymous Access is blocked, and performs an authenticated `qwen3.8:27b`
generation.

After changing an Access policy, validate it without querying Runpod or renting
compute:

```bash
npm run test:runpod-cloudflare-gateway-v2 -- --execute --preflight-only
```

When `MONGOOSE_URL` is configured, the check uses the same durable template/Pod
records as the admin UI and stops the successful Pod unless `--leave-running` is
given; its 60-minute application deadline remains active. Without MongoDB, it
uses provider REST v2 directly and always deletes the test Pod, ignoring
`--leave-running`, because no durable application auto-stop record exists. The
network volume and private gateway template remain in either mode.

```bash
npm run test:runpod-cloudflare-gateway-v2 -- \
  --execute \
  --leave-running \
  --volume-id=gs09qherxl \
  --model=qwen3.8:27b
```

On any failed setup or authentication check, the script attempts to delete its
Pod so the writable network volume is detached and reusable. Treat an `URGENT`
cleanup message as an immediate provider-console action.

`RUNPOD_OLLAMA_MODEL_DOWNLOAD_TIMEOUT_MS` controls the downloader's bounded
pull/retry deadline and defaults to six hours. Keep the selected auto-stop window
at least as long as the expected transfer because the stop deadline remains the
authoritative cost guard.

The large-model preparer is also available as a dry-run-first standalone script,
without starting Express or its schedulers. It enforces a hard `$1/hour` ceiling,
uses at most one preparation Pod, streams only fixed stage/error markers into its
console summary, deletes the Pod on success or failure, and retains the selected
network volume:

```bash
npm run prepare:runpod-glm53-artifact-v2 -- --volume-id=<volume-id>
npm run prepare:runpod-glm53-artifact-v2 -- \
  --execute \
  --volume-id=<volume-id> \
  --max-hourly-cost=0.99
```

`RUNPOD_MODEL_ARTIFACT_PREPARATION_TIMEOUT_MS` defaults to four hours and ten
minutes for the application-side monitor. The provider template separately
enforces a four-hour container deadline. `RUNPOD_GLM53_VOLUME_ID` is an optional
standalone-script convenience and is not a credential.

The admin action upserts the approved artifact/volume relationship as `planned`
before checking transient GPU stock. It does not label the artifact `ready` from
that database write alone: a temporary private Pod must inspect the mounted
volume, verify the five pinned shard sizes and hashes plus the pinned runtime,
and write/validate the readiness marker. Retrying reuses completed files, so an
already prepared volume is verified rather than downloaded again.

The 2-GPU GLM serving check is dry-run-first and never starts Express or the
application schedulers. With `--execute`, it requires the retained 250 GB volume,
chooses exactly two 90+ GB RTX PRO 6000 GPUs in the volume's data center under a
hard `$4.25/hour` total ceiling, syncs the private llama.cpp/Cloudflare template,
waits for `/health`, verifies `/v1/models`, performs one real
`/v1/chat/completions` request, and deletes the Pod in a `finally` path. The model
volume and provider template remain:

```bash
npm run test:runpod-glm53-llama-cpp-v2 -- --volume-id=<volume-id>
npm run test:runpod-glm53-llama-cpp-v2 -- \
  --execute \
  --volume-id=<volume-id> \
  --max-hourly-cost=4.25
```

The network volume is mounted at `/workspace` and contains both the 157 GB GGUF
and pinned runtime. It replaces the Pod-local persistent mount, so the serving
profile deliberately allocates no model-sized Pod disk. Its 40 GB container disk
is for the image, package metadata, the verified `cloudflared` binary, and
temporary runtime files. Increasing either disk to the model size would duplicate
storage without improving model fit; GPU VRAM and context settings determine fit.

The billing backfill also defaults to a no-op. With `--execute`, it connects
directly to MongoDB without starting the application, requests only v2 account
and per-Pod billing, and upserts November 2025 through the current month:

```bash
npm run sync:runpod-billing-v2 -- --execute
```

Its console summary contains only counts and month keys, not billing amounts,
provider Pod IDs, credentials, or connection strings.

If cleanup prints an `URGENT` error, immediately inspect the Runpod console and
delete the named test Pod before doing anything else.

## Deployment and rollback

- Do not edge-cache `/admin/runpod`; responses use
  `Cache-Control: private, no-store, max-age=0`.
- Ensure the application process and MongoDB remain available for background
  setup and the automatic stop guard.
- If the browser-facing origin differs from the origin Express derives through
  its trusted proxy, list it in `CSRF_ALLOWED_ORIGINS`.
- Before rollback, stop and delete every provider Pod visible on the dashboard.
  Then explicitly delete any unwanted network volumes. Removing application code
  does not stop external Runpod billing.
- After provider cleanup, remove the route, scheduler, models, and environment
  key. Local archive/audit collections may be retained or dropped according to
  the operator's data-retention policy.
