# TARIC dual-repository release handoff — 2026-09-18

Site integrates the previously committed feedback/diagnostic patch with Gateway's owned
session API. This release has not been deployed. No production database writes, Gateway
reservations, inference or live GPU tests were performed. One early unit-test mock missed
the newly selected AmiAmi helper; it failed without data but may have attempted a real
request. That injection was fixed and guarded. All later transport verification used
loopback or mocks. Do not describe this release as live-fetch/GPU validated.

## Source and contract

- Site: main containing **Complete TARIC owned-session integration** (the completion
  report supplies the pushed hash), including feature commit
  `4867caefe8cbde629486867ed2447e2057eba0df` atop `0267f958`.
- Gateway: main `689c68a907b5afdda3bd6916df791cafbc61a67c`, including `6e94136` sessions.
  Original parent repository `/home/lennart/ai-services` was read only; no Gateway edits.
- Contract fixture: [gateway-inference-sessions.json](../tests/fixtures/gateway-inference-sessions.json),
  copied from Gateway's `documentation/contracts/qwen3-lora-inference-sessions.json`.
  Exact SHA-256 `0d2eb26fcfb6f05ea7b95f383d95e37d3f2a88cecc7623a46e1c403fdad82fa4`.
- Site owner capabilities are intentionally memory-only per the user requirement. IDs,
  claims and outcomes persist, tokens do not. Restart cannot reissue a lost capability.

Real isolated HTTP contract tests exercise 201 create, all separate proxy/admin/owner
headers, unchanged named-adapter generate bodies, operations **array** correlation,
missing idle proof, missing operation, HTTP abort with remote200, duplicate409, wrong
owner403, unknown404, reclaim/rotation, absolute hard expiry and bounded DELETE202 polling.
A 67-case real Mongo + loopback Gateway run loses the response for case12, keeps that case
failed, completes cases13–67, persists 67 unique attempts/results, rotates nine sessions,
verifies their cleanup and keeps passed=false. Synthetic results prove plumbing only.

See [the runbook](taric-runbook.md#completed-owned-inference-session-integration) for exact
wire semantics, limits, diagnostic/privacy rules and recovery behavior. The named test
adapter remains `taric-v1-20260917-2`. v0 is contaminated and cannot release normal mode.

## Human deployment (separate runtime authorization)

Stop/drain the old Site workers first and preserve the global hold. Both repositories
must be updated before any queued work is authorized. Do not run `npm start` or setup.js
as a smoke test; use the established service procedure with its known prestart effects.

Update Gateway source in its existing parent checkout, preserving local changes and using
only fast-forward integration from its already configured origin. Verify HEAD includes
`689c68a907b5afdda3bd6916df791cafbc61a67c` before rebuilding.
A source pull alone does not update the running image. The reported Sep 18 failure had
source `689c68a` while the Sep 16 container still ran `5c2802a`, without the session module
or OpenAPI routes. Health/ready 200 did not establish compatibility. This is supplied
runtime evidence, not a new production probe by this change.

The confirmed human rebuild uses existing project `ai-gateway` and both Compose files,
preserving the existing mounts and live override:

```sh
cd /home/lennart/ai-services/ai-gateway && docker compose -p ai-gateway -f /home/lennart/ai-services/ai-gateway/docker-compose.yml -f /home/lennart/ai-services/llm-batching-poc/runtime/gateway.override.yml up -d --build --no-deps ai_gateway
```

No extra env file or prerequisite override is needed; `LLM_ADMIN_TOKEN` is confirmed unset.
This command is for the human and was not executed during the contract check.
Preserve the established override, environment and project. Verify the running image and
container include the session module and publish the four explicit owned-session operations
plus generation POST through `/qwen3-lora/{path}` (no literal `/qwen3-lora/generate`
OpenAPI entry). Site's **Refresh status** checks only bounded `/openapi.json`; it
never probes an unknown session route or starts inference. A human rebuild is still needed
when the source checkout is current but the running image is old.

If source update/ancestry checks fail, stop; do not run the build. Keep Gateway's required
scheduler, Docker/startup fencing and verified reclaim prerequisites enabled, with one
Uvicorn worker. Do not change ports, model configuration or operator reservations.

Update the deployed Site checkout from its configured origin/main with fast-forward only,
verify the completion report's commit, and use pinned Node **24.20.0**. No new npm dependency
or lockfile change. The new helper reuses curl-cffi 0.1.50 with bundled v1.5.6,
`libcurl/8.15.0-IMPERSONATE`. If that installed bundle is missing, the **human deployment**
step is `npm run install:curl-cffi`. No installation/download was run during this work.
Other libcurl versions fail closed until their bounds are verified. Windows/Linux packaging
is supported by the existing installer; this release's native tests ran on Linux only.

Environment, kept in the normal private operator environment:

| Setting | Meaning |
| --- | --- |
| TARIC_GATEWAY_ORIGIN | Existing exact trusted Gateway origin |
| TARIC_GATEWAY_ALLOWED_ORIGINS | Exact origin allowlist membership |
| TARIC_GATEWAY_TOKEN | Existing optional proxy Authorization bearer, preserved |
| TARIC_GATEWAY_ADMIN_TOKEN | New optional dedicated X-Admin-Token; match Gateway LLM_ADMIN_TOKEN if configured |
| TARIC_AMIAMI_TRANSPORT | New selector: curl by default, or explicit native; never automatic fallback |

An unset Gateway LLM_ADMIN_TOKEN does not remove Site's mandatory external TARIC API-key
authentication. Preserve the existing key/v0/settings; do not rotate or reimport as a
migration shortcut. Neither Gateway secret nor owner capability appears in the key response.

For the latest readiness-only redeploy, **skip database bootstrap**: the operator already
verified the eight production collections and `taric_attempts` unique index. No new schema
or index change is needed. The following bootstrap steps are retained only for an initial
installation where those prerequisites have not been established.

For such an initial installation, preview actual additive schema/index changes:

```sh
node scripts/taric-tool.js --bootstrap
```

After human review, with MONGOOSE_URL already securely supplied (never pasted into commands):

```sh
node scripts/taric-tool.js --bootstrap --execute --allow-database-write
```

This adds missing collections/indexes, including durable attempts and chronology, without
resetting production revision3/enabled/catalog-null/runtime-empty configuration, v0, keys,
old runs or queued records. The script is idempotent and never drops indexes. Then start
only the updated Site service through the established operator workflow.

## Exact recovery sequence

1. Sign in to `/admin/taric` with `taric.tool.manage`. Read status; passive state is
   `idle_unverified`, never proof. Review queue IDs privately. The old pending run starts
   `6473`; the failed history starts `e658`. No old discarded output can be recovered.
2. Check the explicit confirmation and select **Cancel all pending local work (keep remote
   hold)**. It cancels local queued work under a fenced Mongo lease and retains durable
   attempts/history. The old failed run is unchanged. It performs no Gateway generation.
3. Read the new status/epoch. Confirm and select **Recover hold using exclusive admission**.
   This fresh POST obtains an exclusive owned Gateway reservation, holds it through the
   Mongo CAS, releases only that session, and requires verified reclaim before clearing.
   Create does not start GPU; cleanup may stop the container. Busy/ambiguous/expired/failed
   cleanup leaves the hold. Never use GET-idle + database clearing or operator force release.
4. Recovery does not start the legacy pending run. For old or stale-fingerprint runs, queue
   a fresh run only after new authorization. Current-code recovery_required runs may be
   resumed explicitly after safe recovery, at the next case; the failed case stays failed.
5. During the authorized run, inspect run deadline/session hard expiry and all result pages
   (offsets 0/25/50). Use Cancel future cases to stop; closing the browser does not cancel.
   Check actualCount=67, attemptedCount=67, all errors included, full denominator and
   verified cleanup. Leave normal mode closed until genuine independent v1+ release gates.

If old producers cannot be stopped/fenced, retain the hold and follow Gateway's continuous
admission-fence manual recovery procedure. Site leases alone cannot fence arbitrary outside
producers. No production hold or run was modified in this work.

## Fetch fix versus remaining evidence

Scoped default+OS CA trust fixes the code's omission of Windows system roots without
changing global/Gateway trust or disabling hostname checks. The reported follow-up native
request still got HTTP403; its cause remains unresolved, and no body/schema was evaluated.

The new Chrome136 path preserves the existing fixed query/header behavior. Native
MAXFILESIZE_LARGE is tested on Content-Length and chunked/no-length responses before body
exposure, with native decompression disabled. Separate Node decoded caps cover gzip,
deflate, br and zstd; a parent absolute timeout kills hung native work. Both modes prohibit
redirects and cap wire/decoded bodies at 256KiB. Validated successes alone are persisted.
Neither test proves real AmiAmi access. HTTP_ACCESS_DENIED and TLS_CHAIN_UNTRUSTED remain
visible private manual-fallback diagnostics; there is no proxy/challenge bypass.

## Validation and authorization

Node24.20.0 verification: focused **14 suites / 216 tests passed**; full **316 suites /
3,710 tests passed**, with one unrelated suite/four tests skipped. Coverage thresholds
passed (71.78% statements, 50% branches, 80.79% functions, 72.64% lines on the configured
coverage set). **42 real isolated Mongo lifecycle tests** passed, including loopback HTTP
routers and the real HTTP Gateway contract fixture. Bootstrap was exercised in dry-run
and twice against disposable Mongo8.0. OpenAPI `taric-assisted.v1.yaml` and `git diff
--check` passed. UI validation used Pug/jsdom; no full browser or Windows service was run. No production database or private dataset
was used for the synthetic 67-case contract test. The disposable database is dropped and its
container removed at completion. The security review covers capability/object/credential
scope, CSRF/epoch/fencing, token non-persistence, bounded transport, uncertain dispatch,
release-gate preservation, rejected visible diagnostics and inert UI rendering.

**Fresh authorization required:** after both deployments and recovery, a human must
explicitly authorize **one TARIC v0 benchmark canary** using `taric-v1-20260917-2`, with its
start window and stop condition, to test cold/warm behavior and cleanup. The old six-hour
grant expired and is not reused. This document does not authorize any GPU work. Live AmiAmi
verification is a separate human decision; no success is inferred from CA repair or mocks.

## Site readiness/usability follow-up

The follow-up starts from Site `9c1bca846cd80ead471dfa152f9e3d5d9202ddca`. It adds a
read-only Gateway capability preflight and contextual admin failures. It does not establish
the cause of every earlier `INFERENCE_UNCERTAIN` attempt; the original production transport
trace remains unproved here. No production DB, deploy, GPU, reservation, scrape or live HTTP
was used for this follow-up. Gateway source was inspected locally and left unchanged.

The new preflight requires published create/status/heartbeat/delete roles, plus generation
POST (currently published through `/qwen3-lora/{path}`). Generic health, empty operations and
missing roles cannot pass. Gateway's current handlers use untyped `Request`/`Dict` and do not
publish owner/status response schemas; Site continues validating real session responses.
Discovery proves API publication only, not authentication for later operations, runtime
identity, exclusive admission, reclaim, or model quality.

See [readiness recovery steps](taric-runbook.md#gateway-readiness-and-held-admin-actions)
for enabled/rejected controls and the required human rebuild sequence. The completion
report supplies the commit hash and final local test totals.


Follow-up validation: **13 focused TARIC suites / 230 tests**, including **44 disposable
Mongo lifecycle tests**, passed. The full suite passed **317 suites / 3,732 tests** with
coverage thresholds met (one unrelated suite / four tests skipped). The final focused run
also passed after the last cache/UI refinements. `git diff --check` passed. No curated
OpenAPI YAML changed, no dependency changed, and no database migration is required; the
control proof fields are optional and contain no owner capability.
