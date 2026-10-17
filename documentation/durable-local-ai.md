# Durable local AI batches

> Current complete media release: [Site Phase 2 explanation and rollout steps](local-ai-media-release.md). This document retains the earlier stage history; use the Phase 2 runbook for registered workflows, optional-revision shared imports, output storage and rollback compatibility.

> Exclusive full-queue sessions are implemented and human-deployed at `d9059a4`.
> Use the [current session runbook and minimal AUTO enable procedure](local-ai-exclusive-sessions.md)
> for this host. AUTO remains pending human action. The installation/checklists below
> are historical; the [old restart blocker](local-ai-exclusive-session-blocker.md) is resolved.

Security contract: logged-in/private. Interactive principals are users with explicit
`local_ai.jobs.use` (admin bundle only initially); machine principals are hashed,
revocable, expiring bearer tokens with a fixed user ID and that scope. Jobs and
outputs are owner-scoped, Chat5 sources additionally require current membership
and `chat.conversation.read`/`chat.conversation.write`. Administrative
`local_ai.scheduler.manage` controls execution, never grants prompt access.
Browser writes use shared session CSRF. Inputs are strict typed JSON, bounded to
256 KiB per acceptance; durable capacity slots bound total and per-owner outstanding work.
Outputs are escaped text or authorized private PNG delivery; no analytics, public
media, or cloud fallback. Only the configured Gateway origin is contacted, without
redirects. Private/no-store responses. Logs contain opaque IDs and sanitized codes,
never prompts or bearer credentials. Accepted jobs, attempts and manifests have no
TTL or automatic deletion. Negative tests cover authorization, idempotency,
unsupported payloads, uncertainty, private artifacts, and coordinator recovery.

Implementation and operator instructions follow below.

## What ships

- Owner queue: `/local-ai/queue` and `/local-ai/queue/{job_id}`; account navigation
  includes Local AI queue for authorized accounts. Detail shows frozen input,
  attempts, certainty, next eligibility, private result, safe cancellation/retry.
- Chat5 `/chat5/chat/{id}`: **Queue local batch**, independent from the old cloud
  batch buttons. A saved, non-template conversation is required. A deterministic
  user message and hidden queued placeholder are repaired from the acceptance
  document; completion updates that same response ID. Reload the conversation to
  see results. Batch publication never broadcasts through the legacy socket API.
- `/image_gen`: **Queue local batch**, using the already assembled graph after
  field overrides and seed randomization. Its output stays in the private queue;
  it is not added to the legacy public gallery, favorites, or embeddings.
- `/admin/ai-gateway`: scheduler status, persisted manual start, stop after current,
  and stop now. Management exposes counters/IDs/readiness/activity ownership, not
  other users' prompts. Operator must have both batch capabilities.
- Machine API `/api/local-ai/v1`; browser API `/local-ai/api/v1` uses session CSRF.
  The same `services/localAi/service.js` implements browser and programmatic
  submissions. No path invokes OpenAI or the old cloud batch service.

### Initial eligibility

Text uses an exact ID from Gateway `GET /llm/models`, with `provider=ollama` and
an explicit upstream model. Site checks catalog output/context/aggregate prompt
limits and rejects clamping. Gateway independently validates its managed
`ollama|upstream` affinity. Site freezes the catalog mapping and checks it again
before export; mapping changes are not silently accepted. Catalog lookup must be
reachable for a **new text acceptance**; an idempotent replay does not refreeze
history or consult the catalog. This is a deliberate current availability limit.

Standalone `llm.chat` supports only `model`, `messages`, `max_tokens`, optional
`temperature`, `context_tokens`, `seed`, and `think`. Roles are system/user/assistant
and content is plain text. Optional field presence survives replay. No tools,
media, URL-fetch operations, arbitrary options, dependencies or model fallback.

Chat5 supports its selected Local model, context prompt, configured start message,
maximum message count, and visible text history. A new prompt counts toward the
message limit. Tools or selected media/tool history are rejected. Set reasoning to
`none`, mode to `standard`, verbosity to `medium`, output format to `text`; other
values are rejected rather than ignored. The adapter sets `think:false` and chooses
an explicit output limit bounded by the model card and Gateway catalog. These are
independent frozen snapshots: a later queued prompt cannot depend on a response
that has not yet been generated. Shared template conversations are ineligible.

Read-only inspection of the currently offered workflows on 2026-10-16 verified:

| Workflow | Batch v1 |
| --- | --- |
| `image_qwen_image_2_1_t2i.json` | Eligible unchanged |
| `image_qwen_image_2_1_uncensored_t2i.json` | Eligible unchanged |
| `image_qwen_image_2_1_image_edit.json` | Unsupported: node `9` QwenImage21Cache and node `11` LoadImage; lacks node `5` EmptyLatentImage |
| `image_krea2_turbo_t2i.json` | Unsupported: IDs `30:…`, node `49` ResolutionSelector, `30:16` TextGenerate, `30:15` LoraLoaderModelOnly, switch/concatenation nodes |
| `Z-Anime-Workflow-v1.json` | Unsupported: `125` UnetLoaderGGUF, `126` CLIPLoaderGGUF, two samplers (`14`,`17`), two SaveImage outputs (`93`,`95`) |

Other edit, reference-image, video, arbitrary-node, uploaded-file and multiple-output
workflows are not supported. Supporting them requires a reviewed Gateway contract
extension; Site does not rewrite graphs to imitate the supported topology. The
supported graphs have exact nodes 1–8, Qwen 2.1 loaders, Euler/simple, batch size 1,
256–1536 dimensions in multiples of 16, 1–60 steps, and exact JS-safe integer seeds.
Loader filenames and the catalog mapping are frozen; v1 cannot pin the underlying
model-file bytes if an operator replaces a file under the same name.
Gateway alone owns verified cleanup between distinct Comfy stacks. Site never
stops containers. Same-stack operations are grouped before cohort selection.

## Durability, scheduling and recovery

The acceptance document contains the owner-scoped idempotency key and Site digest,
frozen source/request, capacity slots and deterministic publication IDs. Its
journaled, acknowledged Mongo write precedes HTTP 202. Required unique indexes are
awaited before acceptance. No Mongo transactions or replica set are required.
Never delete accepted jobs to make room; safely terminal jobs release only admission slots.

Local AI models disable automatic collection/index creation because the web process
compiles them before connecting with command buffering disabled. Initialization
explicitly creates collections/indexes after readiness and verifies both partial
unique admission indexes before dropping legacy constraints. It does not await a
cached `Model.init()` promise: a failed attempt must be able to retry real storage
operations on the next worker tick. See the [Windows postdeploy correction](local-ai-windows-stage2.md#postdeploy-correction-after-9ef5833).

Collections: `localaijobs`, `localairuns`, `localaicontrols`, `localaitokens`.
Existing `codex_turns` records gain `batchActivity`; Chat5 messages gain optional
`localBatchJobId` and `localBatchVersion`. The restart-safe admission-index migration
below changes constraints and slot metadata only; it deletes no records.
Site keeps Gateway run IDs, original timestamp strings, original operation bodies
and optional fields, latest remote evidence, and opaque Gateway result digests.
The Site idempotency digest is **not** the Gateway Python canonical-JSON digest.

The coordinator atomically claims jobs, freezes the finite manifest before PUT,
uploads the whole manifest, GETs the run to confirm completeness, then seals.
Open partially uploaded runs do not execute. IDs and wire bodies are reused after
transport failures. Run terminal labels never override per-operation evidence.

Automatic execution is `[01:00,06:00)` Asia/Tokyo, independent of the host timezone.
Startup during the window may dispatch immediately after proven healthy+idle
readiness; blocked readiness persists a 30-minute recheck. Readiness GET is not a
lock: Gateway repeats admission atomically. Its own `admission_deferred` run is
polled, never replaced to bypass the delay. Future nights are not uploaded ahead.
The oldest eligible affinity gets up to eight operations per finite run; remaining
work retains its age. This keeps model switches bounded without starving older
model groups. Gateway still controls its own same-affinity warm-job limit.

Manual start persists a session bounded by five hours and the next 06:00, draining
successive finite cohorts until empty. Readiness deferral does not extend its
original deadline. Manual stop suppresses automatic restart in that JST window;
future nights remain enabled. Both stop modes are run-scoped. `cancel_active`
cannot be downgraded. Stop is persisted intent, not proof of completed termination;
`stop_pending` remains visible while unreachable. Completed outputs are collected
before or after cutoff, including with Site automatic dispatch or acceptance off.
Gateway enforces deadline even with Site offline; cleanup can finish after 06:00.

Confirmed `interrupted`/`deferred` generations with termination and cleanup proof
move to the next eligible day. Failed attempts require explicit owner retry.
There are at most five Site attempts per logical job, including rejected cohorts;
exhaustion requires review. Retries retain the logical job and use `retry_of` for
the latest **accepted** operation. Unknown outcomes, missing remote records after
an uncertain PUT, unverified termination/cleanup, and malformed successful text
are retained for review; a timeout, lease expiration or 404 is never termination.
Late evidence can still publish an unknown result without another generation.
There is no resumable token stream or diffusion progress, nor exactly-once recovery
of an Ollama response lost upstream. “Durable” means accepted work remains recorded,
not that every ambiguous upstream execution can be safely rerun.

### Coordinator fencing limitation

Gateway v1 has no coordinator epoch/fencing field on seal/stop. A Mongo lease alone
cannot prevent a paused former worker sending a late HTTP request. Site therefore
**does not steal an expired lease from a live or unproven process**. On the same
host it verifies the old PID is gone, or on Linux that the PID start identity
changed. PID reuse on platforms without identity proof blocks conservatively.
Restart on that same host resumes the recorded manifest after the old lease expires
(up to 90 seconds). Database disconnect stops new worker actions; recovery resumes
reconciliation. Shutdown never cancels another backend or releases an agent on an
assumption.

Use one Site dispatcher host and one Gateway process. Multi-host or changed-container
hostname failover requires actual old-process fencing and the explicit CLI below.
Do not clear leases merely because their timestamps expired. Gateway fencing tokens
would be needed for general automatic multi-host takeover. This is an intentional
availability tradeoff, not a claim that HTTP and Mongo form one atomic transaction.

### Capacity and retention

- Site: 256 KiB submission JSON; frozen input 512 KiB maximum; **100 admitted
  outstanding jobs per owner and 1,000 globally**. Retained history has no job-count
  limit. Concurrent new submissions and manual retries reserve unique numeric
  owner/global slots in the same journaled write that makes the job dispatchable;
  there are no separate reservation counters or Mongo transactions.
- Release policy: never-exported cancellation (no attempts); successful publication
  with stored result, Gateway acknowledgement, and explicit termination plus
  `verified`/`not_required` cleanup; or final `failed` with those termination and
  cleanup proofs. Exported work also requires its recorded manifest to be durably
  `closed` and no longer the scheduler's active run. Failed work does not automatically
  retry. Manual retry must reacquire both slots atomically; if full it returns HTTP
  507 `outstanding_work_quota` and leaves the failure and evidence unchanged.
- `needs_review`, `outcome_unknown`, uncertain ownership/cleanup, missing manifests,
  unfinished collection/publication/acknowledgement, and queued/deferred work retain
  capacity. Exhausted interrupted/deferred attempts remain in review. Cancel is only
  available before any attempt; stopping exported work uses the run controls.
  Late proof/results continue to reconcile before any release.
- Release unsets only `slot`/`ownerSlot`, records `admissionReleasedAt`, and advances
  the job version. Jobs, original idempotency keys/digests, frozen inputs, attempt
  chains, results, manifests, and unresolved evidence remain. Replaying an identical
  submission returns the original job even with capacity full or acceptance disabled;
  it never reacquires slots or creates a second job. Changed input remains HTTP 409.
- A crash between terminal persistence and release can temporarily retain capacity.
  Worker ticks, new admission/retry, and the initializer repair it with version-checked
  writes. A stale release cannot free a later retry's reservation. A crash/lost reply
  after retry admission leaves one queued job holding both slots; inspect/replay the
  original submission key, never invent a new job to recover it.
- Cohorts start at eight (256 MiB Gateway reservation at 32 MiB/op). A partial
  quota rejection persists backpressure and stop intent, seals nothing, and halves
  the persisted cohort cap down to one. Confirmed unaccepted records remain queued;
  accepted deferred operations retain their attempt chain. Site does not silently
  drop rejected operations or run an incomplete chosen manifest.
- Gateway defaults: 2 GiB batch storage, 256 MiB minimum free space, 10,000 records.
  It retains acknowledged artifacts; there is no Gateway GC in this release.
- No Site deletion, TTL or operator deletion is used to free admission capacity.
  History and private artifacts still consume disk indefinitely. Monitor disk growth
  and the independent Gateway storage/record limits; Site slot recycling does not
  change Gateway retention or its admission limits.
- Back up **all** Site MongoDB collections (including released job history and the
  unique owner/key index), Site private artifacts and Gateway `/data/batch` together,
  preserving IDs, tokens and the stable client ID. Stop producers/coordinators for a
  consistent backup/restore. Restore all history, not only jobs holding slots, then
  run the initializer before resuming traffic. Never clear slots or unresolved
  evidence by hand. Retain backups before the index migration.

## Configuration and setup

For the confirmed Windows deployment, use [Site stage 2, batching OFF](local-ai-windows-stage2.md).
Lennart confirmed Gateway integrated release
`dffccc9029313cd1886fbbda8383beb19170c309` deployed and stage 1 verification PASS;
its configured client ID is `lentmiien-site`. This is operator-supplied evidence,
not a deployment performed by the Site implementation.

The handoff Gateway reference is `ae5215d063bb85dfad5f82a5859f650dc524c70d` (or its
reviewed descendant). This Site change does not integrate unrelated Gateway work.
Use the **current Gateway release runbook** for the exact live deployment command,
image and Compose file set. Latest operator-verified ACTIVE deployment uses project
`ai-gateway`, service `ai_gateway`, and
`embeddinggemma2/release-state/gateway-image.yml`; the historical
`llm-batching-poc/runtime/gateway.override.yml` is not the active override. Do not
copy an old Site rebuild command. The live pilot integration decision belongs to
Lennart. This Site release did not deploy, restart, or mutate production.

Gateway configuration, initially dispatch disabled:

```dotenv
BATCH_ENABLED=false
BATCH_CLIENT_ID=lentmiien-site
BATCH_SERVER_TOKEN=<dedicated random secret of at least 32 characters>
BATCH_DATA_DIR=/data/batch
BATCH_EXTERNAL_CLIENT_COVERAGE=unverified
BATCH_MAX_STORAGE_BYTES=2147483648
BATCH_MIN_FREE_BYTES=268435456
BATCH_MAX_RECORDS=10000
GPU_IDLE_WARM_ENABLED=false
```

Keep the existing persistent `./data:/data` mount and run only one Gateway process.
Do not replace its ledger directory during token rotation or rollback.

Site configuration (also set on every standalone Codex worker):

```dotenv
AI_GATEWAY_BASE_URL=http://<gateway-host>:8080
LOCAL_AI_BATCH_ENABLED=false
LOCAL_AI_BATCH_AUTO_DISPATCH=false
BATCH_CLIENT_ID=lentmiien-site
BATCH_SERVER_TOKEN=<the same dedicated secret>
LOCAL_AI_BATCH_DATA_DIR=<absolute persistent private directory outside public>
```

The origin must contain no credentials, path, query or fragment. HTTP is intended
for the protected LAN; use HTTPS across untrusted networks. Tokens never reach
browser HTML/JS, URL queries or application debug logs. Keep secrets in the existing
operator secret configuration, not shell history or committed files.

From a trusted Site checkout with its normal secret environment loaded, run:

```sh
node scripts/local-ai-admin.js initialize-by-name "EXACT_SITE_ADMIN_LOGIN_NAME"
```

Use the exact, case-sensitive **Site login username**, not email, Windows account,
display name, password, or MongoDB ID. It is not a secret. The CLI loads working-directory
`.env` quietly; inherited environment variables take precedence, just as in `app.js`
and `scripts/codex-worker.js`. Run from the deployment checkout with the same effective
`MONGOOSE_URL` as the service. It does not read WinSW XML or copy a running process's
environment automatically.

This remains a trusted, host-administrator CLI, not a new login or HTTP endpoint.
The bounded name lookup uses binary exact equality, selects only `_id`, and stops at
two matches. Missing or duplicate names (including non-admin duplicates) fail closed.
It reloads the principal through the existing `local_ai.scheduler.manage` capability
check and additionally requires the matching name and `type_user=admin` before
explicit index migration/reconciliation. No account, role, password, token, or
capability is created or changed. Success output contains no account data; failures
print/log allowlisted codes only. Existing `initialize ADMIN_USER_ID` remains available
with its existing capability policy. Other administration commands still take IDs.

Stop old Site producers/coordinators and keep both flags false before initialization.
This connects only to configured MongoDB; it does not start app.js, schedulers,
setup.js or a model. It creates `admission_slot_unique` on `{slot:1}` and
`admission_owner_slot_unique` on `{ownerId:1,ownerSlot:1}`, each unique with a
numeric `$type` partial filter on its slot field. Missing **and null** slots are
excluded: a sparse compound owner/slot index is unsafe because owner is always
present. The permanent unique `{ownerId:1,key:1}` index remains unfiltered.

Replacement constraints are created before removing the previous slot indexes
(including legacy `slot_1` and `ownerId_1_ownerSlot_1`, sparse or non-sparse).
Initialization then reconciles safely terminal slots. Interrupted initialization
can be rerun; it does not delete job documents, rewrite keys, or reset run evidence.
The application also awaits index initialization before submissions/retries and
repairs pending releases during normal operation. Index creation failures fail
closed and appear in `local_ai` logs. The configured DB account needs create/list/drop
index privileges on `localaijobs` in addition to existing read/write access.
Verify successful completion and both partial unique indexes before accepting
traffic. Do not run the old Site code against the migrated data; it assumes slots
on every historical job. Restore the pre-migration backup only as a coordinated,
reviewed rollback with accepted work and Gateway evidence preserved. Use the Node
version pinned by Volta in package.json.
There are no new dependencies. `npm ci` is the clean install command if dependencies
need installing; `npm start` is not a smoke test because prestart mutates data.

### Capability grants and machine credentials

`admin` gets `local_ai.jobs.use` and `local_ai.scheduler.manage`. `family` and `user`
get neither. Chat5 sources also require `chat.conversation.read` and
`chat.conversation.write` plus membership. Existing `/chat5` HTTP routes retain
legacy `chat5` access requirements. The read/socket hardening means non-admin Chat5
users now need an explicit semantic read grant, in addition to their legacy grant.
Grant only intended accounts; no migration grants everybody access.

```sh
node scripts/local-ai-admin.js grant-capability ADMIN_USER_ID OWNER_USER_ID local_ai.jobs.use
node scripts/local-ai-admin.js grant-capability ADMIN_USER_ID OWNER_USER_ID chat.conversation.read
node scripts/local-ai-admin.js grant-capability ADMIN_USER_ID OWNER_USER_ID chat.conversation.write
# Only if delegating scheduler management:
node scripts/local-ai-admin.js grant-capability ADMIN_USER_ID OWNER_USER_ID local_ai.scheduler.manage
```

Grants are additive to existing per-user `role.permissions`. Revocation uses the
existing role-management interface to remove the exact capability. Deleted users,
changed role bundles and removed capabilities are reloaded before export/publication.
Admin management does not imply owner prompt access. Shared conversation membership
is checked at reads, socket admission and delivery; foreign message IDs cannot be
injected through ordering operations.

Issue a machine credential from the trusted host:

```sh
node scripts/local-ai-admin.js issue-token ADMIN_USER_ID OWNER_USER_ID inbox-summary
```

This prints a one-time JSON credential (`id`, `secret`, `expiresAt`). Capture it
directly into a protected secret manager/file, not a build log. Only its SHA-256
hash is stored; tokens have a fixed owner, `local_ai.jobs.use` scope and a 30-day
CLI lifetime. The service helper permits explicit 1–365-day issuance. Rotation:
issue a replacement, update the client, verify it, then revoke the previous ID:

```sh
node scripts/local-ai-admin.js revoke-token ADMIN_USER_ID OLD_TOKEN_ID
```

Revocation stops future export/publication for jobs accepted with that token, even
if the owning user is still active. Their evidence remains; the owner can inspect
it and cancel unexported work. Do not assume rotating a token transfers old jobs to
new authority. Revoke only after draining accepted work when continuity is needed.
The legacy global `API_KEY`, query `name`, and arbitrary request owner IDs are not
accepted machine identity.

## Programmatic API

Send `Authorization: Bearer <issued Site machine secret>`, not the Gateway secret.
All responses are private/no-store. The per-principal HTTP limit is 120/minute.
Submission also requires `Idempotency-Key: <ASCII letters/digits/_/-, 1–80 chars>`.
Same owner/key/input returns the original job; changed input is 409. Keep the key
and exact payload across network errors and restarts. A 202 and Location appear
only after durable acceptance. No request chooses its owner.

```http
POST /api/local-ai/v1/jobs
Authorization: Bearer <SITE_MACHINE_SECRET>
Idempotency-Key: inbox-summary-2026-10-16
Content-Type: application/json

{"type":"llm.chat","request":{"model":"<exact Gateway Ollama catalog ID>","messages":[{"role":"system","content":"Summarize this inbox locally."},{"role":"user","content":"Synthetic inbox contents"}],"max_tokens":512,"temperature":0.2,"seed":0}}
```

Other accepted typed envelopes:

```json
{"type":"chat5.response","conversation_id":"<24-hex-ID>","prompt":"A new independent question"}
```

Optional `settings` is strict and includes all of `model`, `contextPrompt`,
`maxMessages`, `tools`, `reasoning`, `mode`, `verbosity`, `outputFormat`; omission
snapshots current persisted conversation settings. The browser passes current
editor settings. It does not silently update the conversation settings or members.

```json
{"type":"comfy.image","request":{"prompt":{"1":{"class_type":"UNETLoader","inputs":{"unet_name":"…","weight_dtype":"default"}},"…":"complete exact supported graph required"}}}
```

The image snippet is illustrative, not a valid graph. See
`tests/fixtures/local-ai/qwen.json` for a complete synthetic valid graph. Freeze the
seed before assigning your idempotency key. No workflow names, URLs or input files
are accepted as substitutes for the assembled graph.

| Method/path under `/api/local-ai/v1` | Behavior |
| --- | --- |
| `POST /jobs` | Typed acceptance; 202 + Location |
| `GET /jobs?offset=0` | Owner-only pages of 50; `next_offset` or null |
| `GET /jobs/{id}` | Safe state, reasons, next attempt, attempt certainty, result URL |
| `GET /jobs/{id}/result` | Published text/thinking JSON or verified private PNG; 409 before publication |
| `POST /jobs/{id}/cancel` | Only unclaimed queued work (or never-exported authorization-held work); exported work returns 409 |
| `POST /jobs/{id}/retry` | Failed/reviewed work only when latest accepted operation proves safe replacement; maximum five attempts |

Browser equivalents are under `/local-ai/api/v1` and require the session and
`X-CSRF-Token` from authenticated `GET /local-ai/api/v1/config`. Scheduler endpoints
are browser-only `GET /local-ai/api/v1/scheduler` and
`POST /local-ai/api/v1/scheduler/{start|finish_current|cancel_active}` with the
management capability and CSRF. Private API errors are sanitized
`{"error":{"code":"…"}}`; normal auth/CSRF/rate middleware may return its existing
error representation. Do not scrape provider error bodies or infer termination
from status codes.

Within Site code, reuse `service.submit({ownerId, tokenId?}, key, envelope)`,
`service.get`, `service.cancel`, `service.retry` from `services/localAi`. The caller
must derive ownerId from a validated principal; the service reloads it and its
capabilities. Only trusted server code may omit tokenId. Await the returned promise
before acknowledging acceptance externally.

## Codex ownership and explicit reconciliation

With batching enabled, an Ollama-backed Codex turn persists `batchActivity` in its
existing turn record before registering. Registration precedes GPU reservation and
runner launch; any error fails closed. Heartbeats run every 30 seconds throughout
model calls, tools and child-agent gaps. A stale heartbeat never releases ownership.
The spawned process/transport PID and host are recorded before protocol startup.

On Linux local targets the runner uses a dedicated process group and only reports
termination when the group disappears, including its non-detached descendants.
No automatic proof is available for remote SSH processes or Windows process trees;
those activities remain `needs_review` after the transport closes. Detached tools
that escape the local process group require separate registered activity coverage;
do not claim external-client coverage while such clients are unmanaged. A stronger
remote/cgroup process-tree supervisor is a follow-up for fully unattended release
on those targets. Site does not claim that browser disconnect, SSH closure, or a
Codex terminal status proves all remote processes ended.

The Gateway panel lists unreleased activity IDs and stale-heartbeat status. Inspect
the corresponding `codex_turns.batchActivity` and target process tree. After actually
terminating/fencing the old coordinator **and** proving the agent and all its tools
and children ended, an authorized operator can run:

```sh
node scripts/local-ai-admin.js reconcile-activity ADMIN_USER_ID TURN_ID --old-coordinator-and-agent-terminated CONFIRMED
```

This lists current ownership, recovers with the observed generation and a stable new
coordinator ID, persists the new association/proof, then releases. Repeating after a
lost reply reconciles instead of guessing generations. Never use it merely to clear
an inconvenient blocker. Locally persisted `release_pending` with real termination
proof is automatically reconciled by the batch worker, even when dispatch is off.

For a Site dispatcher on a different host/namespace, first actually fence the old
process. Use the holder ID shown in the scheduler panel, then:

```sh
node scripts/local-ai-admin.js fence-coordinator ADMIN_USER_ID OLD_HOLDER_ID --old-coordinator-terminated CONFIRMED
```

This compare-and-sets the old holder, retaining active manifest and jobs. A changed
holder rejects the command. This command is not a substitute for stopping/proving
the old process. Ordinary same-host process restart needs no such command.

## Deployment and live canary checklist

1. Back up Site MongoDB/private media and Gateway data; record current revisions.
   Deploy Gateway first at the shipped contract revision using its existing release
   procedure. Preserve `/data/batch`, the stable client ID, and single-process
   execution. Keep `BATCH_ENABLED=false` until coverage is verified. Configure the
   dedicated secret and `GPU_IDLE_WARM_ENABLED=false`.
2. On Site, verify a clean/preserved worktree, `git fetch origin`, review the release
   commit, then fast-forward the intended release branch. Do not reset unrelated
   work. Configure both Site flags false, persistent private storage and matching
   credentials on Site **and all Codex worker processes**. Run the `initialize`
   command and intended capability grants. No production changes were executed as
   part of implementation.

   ```sh
   git status --short
   git fetch origin
   git show --stat <SITE_RELEASE_COMMIT>
   git merge --ff-only <SITE_RELEASE_COMMIT>
   npm ci
   node scripts/local-ai-admin.js initialize-by-name "EXACT_SITE_ADMIN_LOGIN_NAME"
   ```

   Replace `<SITE_RELEASE_COMMIT>` with the Site commit reported with this release.
   Run from the intended deployment branch only after preserving unrelated changes;
   a non-fast-forward failure requires review, never a force/reset. Apply the
   configuration and grants above before restarting the existing service.
3. Roll out/restart through the existing Site service procedure; this repository
   does not define the operator's Windows/Linux service name. Do not use `npm start`
   merely for a smoke test. Verify database readiness, indexes and private storage
   permissions. Confirm queue pages and foreign-object denial, with no analytics.
4. Drain or fence pre-existing unregistered local Codex agents before enabling the
   Site integration. Inventory all direct Gateway/local-AI clients. Only once all
   long-lived clients register whole-run activities, set Gateway
   `BATCH_EXTERNAL_CLIENT_COVERAGE=registered` and `BATCH_ENABLED=true` through its
   normal config/restart procedure. Keep `LOCAL_AI_BATCH_AUTO_DISPATCH=false`.
5. Enable `LOCAL_AI_BATCH_ENABLED=true` on Site and Codex workers. In a sandbox
   account issue a Site token and enqueue a synthetic standalone text request twice
   with the same key. Verify one durable record and a 409 for a changed payload.
   Verify the browser queue, Chat5 placeholder and supported Qwen graph eligibility.
6. Manual canary: start from `/admin/ai-gateway`, check healthy+idle+idle_proven,
   generation, deterministic Chat5 append/private PNG import, then ack. Verify
   auto-stop on drain. Test same-stack reuse and two different Qwen stacks in order;
   inspect **Gateway** verified cleanup between stacks. Site must issue no container
   stop or fallback requests. Do not infer cleanup from a UI status alone.
7. Local-agent canary: during a long tool-only gap confirm readiness blocks with an
   unreleased activity. Confirm another Codex launch is refused while batch is active.
   Stop/restart Site and Gateway separately during sandbox runs. Verify partial
   uploads stay unsealed, exact replay IDs, deferred operations on the next night,
   and unknown outcomes staying in review. For SSH/Windows, exercise the explicit
   operator proof/recovery workflow before expecting unattended scheduling.
8. Test stop-after-current, stop-now, unreachable stop intent, 06:00 cutoff while
   Site is down, late result collection with dispatch disabled, revoked credentials,
   removed conversation membership, expired session, foreign output and missing
   CSRF. Verify browser recovery retains the same request/seed/key after a lost 202.
9. Only after those canaries and client coverage pass, set
   `LOCAL_AI_BATCH_AUTO_DISPATCH=true`. Monitor `local_ai` and
   `chat5_authorization` warnings, persisted delay/reason, outstanding admission
   capacity, disk growth and independent Gateway record/storage quotas.
   Cloudflare must bypass cache for `/local-ai/*` and `/api/local-ai/*`; preserve
   HTTPS/authentication and narrowly permit intended machine traffic. Never add a
   broad public auth bypass. Private artifacts have no static route.

Rollback: set Site automatic dispatch false first, persist a run stop if desired,
then disable new acceptance while retaining the new worker for reconciliation.
Keep Gateway ledger, tokens/client ID and private data intact. Rolling Site back
past this integration while Gateway batching remains enabled removes Codex activity
coverage; therefore disable Gateway new batches and fence/drain agents before such
a rollback. Disabling dispatch does not delete accepted work or magically cancel
in-flight execution. Existing Gateway ledgers may suppress blanket lifecycle stops
even while batching is disabled; follow Gateway's documented recovery procedure.

## Validation evidence and practical limits

The focused suite includes policy/TZ boundaries, real standalone Mongo plus a real
HTTP fake Gateway, concurrent acceptance/mismatch/quotas, 104 retained historical jobs without loss,
owner/global reservation races, failure retry re-admission, lost retry replies,
release/manifest crash recovery and legacy/sparse index migration, grouping, persisted delay,
partial uploads, lost upload/start/ack replies, stale fencing, cutoff/offline,
manual drain/deadline, safe replacement identity, unknown/late success, unreachable
stop, deterministic publication, token revocation, capability/membership/CSRF
failures, malformed output and private PNG integrity. Codex ownership and room
delivery tests cover heartbeat/release uncertainty and removed recipients. Browser
smoke tests render synthetic private queue detail at 390 and 1440 pixels, check
escaping, overflow and unavailable unsafe retry.

Pre-rollout admission verification: the focused run passed 7 suites / 63 tests,
including 32 real standalone-Mongo/fake-Gateway integration cases and wire-level
checks of acknowledged journaled writes. The full suite passed 393 suites / 5,071
tests (8 suites / 122 tests skipped); configured coverage thresholds passed. Tests
ran on Node 24.12.0; deployment should use the repository's Volta-pinned Node version.
No environment variables or dependencies changed; the admission-index migration
and initialization/reconciliation steps above are required.

Reproduce the disposable integration environment (never point this at production):

```sh
docker run -d --rm --name site-local-ai-mongo-test -p 127.0.0.1:27028:27017 mongo:8.0 --bind_ip_all
LOCAL_AI_TEST_MONGO_URI=mongodb://127.0.0.1:27028/local_ai_test npm test -- tests/unit/localAiPolicy.test.js tests/unit/localAiActivity.test.js tests/unit/localAiClient.test.js tests/unit/localAiAdmin.test.js tests/unit/chat5PrivateAccess.test.js tests/unit/chat5RoomDelivery.test.js tests/integration/localAiDurability.test.js --coverage=false --runInBand
LOCAL_AI_TEST_MONGO_URI=mongodb://127.0.0.1:27028/local_ai_test npm test -- --runInBand
docker stop site-local-ai-mongo-test
```

The integration test refuses non-loopback/non-`local_ai_test` URIs and deletes that
disposable database. Without the variable it skips explicitly. Browser smoke:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/path/to/chromium node tests/browser/localAiQueue.smoke.js
```

No real model generation, GPU safety/cleanup canary, production activity recovery,
power-loss durability, or multi-host failover was tested in this Site release.
The read-only catalog/workflow checks did not start a model. Gateway v1 fencing,
remote/Windows process-tree proof, broader Comfy topologies, and reviewed retention
maintenance remain concrete follow-ups; no scaffolding for them is represented as
implemented behavior.
