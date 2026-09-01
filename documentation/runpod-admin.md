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
- `GET` and `DELETE /v2/pods/{id}`
- `POST /v2/pods/{id}/action` with `start` or `stop`
- `GET` and `POST /v2/templates`
- `PATCH /v2/templates/{id}`

Network-volume management uses:

- `GET` and `POST /v2/network-volumes`
- `GET`, `PATCH`, and `DELETE /v2/network-volumes/{id}`

API v1 and the legacy GraphQL API are not used. Runpod REST API v2 is currently
public beta, so response fields may evolve. Current reference:
<https://docs.runpod.io/api-reference-v2/overview>.

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
5. Runpod creates one serving Pod from the private Ollama template. The local record receives
   an automatic stop deadline immediately. A stopped Pod must be given a new
   bounded “Start for” duration each time it is resumed.
6. Background setup waits for `RUNNING`, checks the fixed Runpod HTTPS proxy,
   calls Ollama `POST /api/pull` as a bounded progress stream, and verifies the model in
   `GET /api/tags`. A model already present on the network volume completes this
   step without downloading its blobs again.
7. The dashboard exposes the public Ollama URL only after setup succeeds.

The default template uses `ollama/ollama:latest`, exposes `11434/http`, sets
`OLLAMA_HOST=0.0.0.0:11434`, and normally persists models under `/root/.ollama`.
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
pull, and completed a small-context inference. The verification used a 32 GB GPU
and a 2,048-token context; that does not imply that the model's full advertised
256K context fits in 32 GB, because KV-cache memory grows with context and
concurrency.

Network volumes are independent, regional Secure Cloud resources. A Pod must be
created in the volume's data center. Stopping a Pod leaves the volume attached;
delete the old Pod before attaching the writable Ollama volume to replacement
hardware. The manager deliberately prevents a second provider Pod from sharing
the same writable volume because concurrent writers can corrupt data. Deleting
a Pod does not delete its network volume; volume deletion is a separate,
exact-name-confirmed operation.

Runpod's proxy URL is public and Ollama has no application-level authentication.
Do not place private prompts or models on the test endpoint. Stop releases GPU
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
5. **Authenticated stable access (recommended next).** Add the named Cloudflare
   Tunnel + Access profile described below. It keeps one hostname across Pod
   deletion/recreation, removes direct Runpod proxy exposure, and supports both
   human login and service-token API clients.
6. **Multi-region and multi-node operation.** Add explicit artifact replication,
   read-only serving mounts where the provider supports them, topology-aware
   scheduling, health checks, and multi-node vLLM/SGLang only after the
   single-node tensor-parallel path is reliable.

Runpod's current network-volume behavior and constraints are documented at
<https://docs.runpod.io/storage/network-volumes>. vLLM parallel-deployment
guidance is at <https://docs.vllm.ai/en/stable/serving/parallelism_scaling/>.
Twingate's Linux Connector setup is documented at
<https://www.twingate.com/docs/connectors-on-linux>.

## Recommended stable authenticated gateway

Use a **named Cloudflare Tunnel protected by Cloudflare Access** as the first
gateway profile. The stable identity lives in Cloudflare, not in the disposable
Pod:

1. Create one named tunnel, for example `runpod-ollama`, and map a hostname such
   as `ollama.example.com` to `http://127.0.0.1:11434`.
2. Add a Cloudflare Access self-hosted application for the entire hostname. Use
   a narrow identity Allow policy for browser access. Add a separate Service Auth
   policy with a dedicated service token for API clients; those clients send
   `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers.
3. Build a small pinned custom image (or wrapper entrypoint with a real process
   supervisor) that runs both `ollama serve` and `cloudflared tunnel run --token
   ...`. Store the tunnel token and Access service-token values in secret storage,
   never in Git, a public template, logs, or model-volume files.
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
Feature: Runpod REST API v2 monitor, Pod/network-volume manager, and Ollama model downloader
Security zone: logged-in, administrator only
Interactive principals: validated admin sessions
Machine principals: internal `runpod-state-observer`, `runpod-auto-stop`, and `runpod-billing-scheduler` labels; no inbound machine route (`RUNPOD_API_KEY` is an outbound provider credential)
Data classification: public catalogs; sensitive account billing/resource metadata; secret provider key
Capabilities: runpod.catalog.read, runpod.billing.read, runpod.billing.sync, runpod.pod.read, runpod.pod.create, runpod.pod.start, runpod.pod.stop, runpod.pod.extend, runpod.pod.delete, runpod.pod.setup, runpod.pod.sync, runpod.model_download.create, runpod.network_volume.read, runpod.network_volume.create, runpod.network_volume.delete, runpod.network_volume.sync, runpod.template.manage
Object scope: account-wide admin feature; Pod and volume browser actions use local MongoDB IDs and resolve provider IDs server-side; model downloads accept a provider volume ID but verify it against the authenticated account's v2 volume list and derive cloud/location server-side; volume deletion also verifies the resolved provider ID against that list
Admin override: no implicit bypass; admin receives the explicit capability bundle and each mutation checks its semantic capability
Browser mutations and CSRF control: POST only; shared session token, timing-safe comparison, and Origin validation, with a same-origin Fetch Metadata fallback for opaque browser origins; Pod and volume deletion also require the exact resource name
Public/secret abuse controls: authentication plus admin guard, semantic capabilities, read/mutation/create rate limits, active-Pod ceiling, GPU ceiling, storage-size ceiling, fresh location-specific compute price check, confirmed hourly/monthly maxima, storage-billing/public-proxy acknowledgements, one-writer-per-volume enforcement, mandatory auto-stop, and automatic downloader deletion
Request and upload limits: URL-encoded forms only, at most 16 KiB and 20 scalar fields; no uploads; provider requests capped at 64 KiB; provider responses capped at 4 MiB
Output/rendering contexts: bounded normalized values rendered with escaped Pug interpolation; sanitized provider error fields may be shown to administrators, but no provider HTML, raw response bodies, environment values, or inline JSON
Private file/media storage and delivery: none
Outbound hosts/services: fixed HTTPS api.runpod.io v2 paths and exact <pod>-<port>.proxy.runpod.net URLs; redirects rejected; Ollama paths restricted to /api/tags and /api/pull
Cache policy: browser responses are private/no-store; catalog results use a short in-memory cache
Security-relevant logs: stable action, category, safe error code, and HTTP status metadata only; no key, billing amount, resource ID, principal data, or provider body
Retention/deletion behavior: provider deletion archives local serving and downloader Pod lifecycle/cost metadata plus volume and per-Pod billing metadata; verified model tags remain on the active volume record; account months, Pod billing periods, and audit events are retained; model files are permanently removed only by provider volume deletion; no credentials are persisted
Required negative tests: non-admin/capability denial (including separate model-download authority), invalid CSRF and Origin, oversized/non-form body, malformed local/provider ID/model tag, missing or in-use volume, unavailable hardware/storage location, active-Pod/GPU/compute/storage-cost limits, invalid start/extension/download duration, public-endpoint/storage-billing acknowledgement, exact delete confirmation, cross-region/community-volume rejection, provider timeout/error/oversize/redirect, provider-error redaction, proxy-host validation, cleanup after failed creation/setup/download, successful-download cleanup failure, and auto-stop/extension overlap
Legacy dependency or migration plan: new v2-only models/routes; MongoDB creates the new collections and indexes; rollback can remove code after all provider Pods have been explicitly deleted
```

The application has no shared recent-authentication or MFA gate yet. The feature
therefore uses the existing admin session plus semantic capabilities, CSRF, rate
limits, cost bounds, and exact-name deletion confirmation.

## Configuration and standalone checks

The key now needs the provider privileges required for Pod and account-template
management. Use the narrowest Runpod credential that supports those operations,
store it only in `.env`, and rotate it if exposed.

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

`RUNPOD_OLLAMA_MODEL_DOWNLOAD_TIMEOUT_MS` controls the downloader's bounded
pull/retry deadline and defaults to six hours. Keep the selected auto-stop window
at least as long as the expected transfer because the stop deadline remains the
authoritative cost guard.

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
