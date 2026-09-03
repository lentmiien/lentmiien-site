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

API v1 is not used. Normal catalog, billing, template, volume, and Pod workflows
remain REST API v2-only. Runpod v2 does not currently expose Secret creation, so
the standalone `bootstrap:runpod-cloudflare-secret` command makes one narrowly
scoped official GraphQL mutation to create the encrypted tunnel-token Secret;
it is not part of the web application or ongoing resource management. Runpod
REST API v2 is currently public beta, so response fields may evolve. Current reference:
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
Object scope: account-wide admin feature; Pod and volume browser actions use local MongoDB IDs and resolve provider IDs server-side; model downloads accept a provider volume ID but verify it against the authenticated account's v2 volume list and derive cloud/location server-side; volume deletion also verifies the resolved provider ID against that list
Admin override: no implicit bypass; admin receives the explicit capability bundle and each mutation checks its semantic capability
Browser mutations and CSRF control: POST only; shared session token, timing-safe comparison, and Origin validation, with a same-origin Fetch Metadata fallback for opaque browser origins; Pod and volume deletion also require the exact resource name
Public/secret abuse controls: authentication plus admin guard, semantic capabilities, read/mutation/create rate limits, active-Pod ceiling, GPU ceiling, storage-size ceiling, fresh location-specific compute price check, confirmed hourly/monthly maxima, storage-billing/public-proxy acknowledgements, one-writer-per-volume enforcement, one-active-connector-per-named-tunnel enforcement, mandatory auto-stop, automatic downloader deletion, no Runpod port in the gateway profile, and Cloudflare Access at the stable hostname
Request and upload limits: URL-encoded forms only, at most 16 KiB and 20 scalar fields; no uploads; provider requests capped at 64 KiB; provider responses capped at 4 MiB
Output/rendering contexts: bounded normalized values rendered with escaped Pug interpolation; sanitized provider error fields may be shown to administrators, but no provider HTML, raw response bodies, environment values, or inline JSON
Private file/media storage and delivery: none
Outbound hosts/services: fixed HTTPS api.runpod.io v2 paths; a standalone one-time Secret bootstrap to fixed HTTPS api.runpod.io/graphql; exact <pod>-<port>.proxy.runpod.net diagnostic URLs; exact configured https://llm.lentmiien.com gateway origin; the Pod wrapper downloads only the pinned cloudflared AMD64 release URL and verifies its SHA-256; redirects rejected; Ollama paths restricted to /, /api/tags, /api/pull, /api/generate, and /api/ps
Cache policy: browser responses are private/no-store; catalog results use a short in-memory cache
Security-relevant logs: stable action, category, safe error code, and HTTP status metadata only; no key, billing amount, resource ID, principal data, or provider body
Retention/deletion behavior: provider deletion archives local serving and downloader Pod lifecycle/cost metadata plus volume and per-Pod billing metadata; verified model tags remain on the active volume record; account months, Pod billing periods, and audit events are retained; model files are permanently removed only by provider volume deletion; application databases persist only non-secret gateway mode/URL and Runpod Secret references, never credential values
Required negative tests: non-admin/capability denial (including separate model-download authority), invalid CSRF and Origin, oversized/non-form body, malformed local/provider ID/model tag, missing or in-use volume, unavailable hardware/storage location, active-Pod/GPU/compute/storage-cost limits, invalid start/extension/download duration, public-endpoint/storage-billing acknowledgement, exact delete confirmation, cross-region/community-volume rejection, provider timeout/error/oversize/redirect, provider-error redaction, proxy-host validation, exact Cloudflare-host validation, missing Access credentials, duplicate named-tunnel connector, Secret-bootstrap no-overwrite/error redaction, cleanup after failed creation/setup/download, successful-download cleanup failure, and auto-stop/extension overlap
Legacy dependency or migration plan: new v2-only models/routes; MongoDB creates the new collections and indexes; rollback can remove code after all provider Pods have been explicitly deleted
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
REST v2 currently has no Secret-creation operation, so this standalone bootstrap
is the documented narrow GraphQL exception; every template, volume, and Pod
operation remains v2.

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
