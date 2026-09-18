# TARIC reset and warm-session review — 2026-09-18

## Scope and safety

Started on clean `main` at `5f6ee114509622f805c5b72d4e306011eb631000`.
The original review used Gateway `64c50ef851a649c9b47aa430a51e11bc42fd30a9`.
The final shipping validation uses source/test runtime
`704bccf64541889679fd827bbd24b83a9303db9b` (clean local checkout).
All new evidence uses Node **24.20.0**, loopback HTTP, a disposable Mongo 8.0
container, and Python `/tmp/voice-baseline-test-venv/bin/python`. No production
service, database, GPU, reservation, scraping, or live Gateway call was made.
No secrets or private benchmark rows were read. All 67 cases are synthetic.

This maintains the existing logged-in/admin-managed TARIC feature and its
machine-principal owner scope. Capabilities, CSRF, output escaping, allowlisted
outbound origin, private persistence, failed-case denominator, ownership fence,
and v0 release exclusion remain enforced. There are no new production routes.

## Five-second reset: not reproduced; cause remains unresolved

The reported production symptom is a dispatched, nonterminal HTTP-phase
`ECONNRESET` with zero response bytes at roughly 5,010 ms, despite a 60,000 ms
generation budget. A known create 409 is a different admission event. Current
production hold=false was supplied by the operator; it was not queried here.

The original client does not reproduce the reset on either Node 24.12.0 or the
pinned 24.20.0. Native loopback sequencing of a first seven-second response,
short metadata request, and two further seven-second responses succeeds on the
same socket. Its explicit absolute timer is cleared on completion, request bodies
have byte-correct Content-Length, and req.end is called. Both generation wrappers
use 60 seconds. There is no demonstrated five-second request-local override.
No proxy, network, Uvicorn, or Node-Agent cause is established by these tests.

A final TLS loopback comparison also passes with certificate verification enabled
and only the generated loopback CA trusted per request. Original versus changed:
cold headers 7,017/7,015 ms, metadata 3/3 ms, warm headers 6,001/6,001 ms, delayed
body 6,003/6,003 ms. Each client reuses one socket; all UTF-8 request Content-Length
values match. The five-second symptom is not reproduced on HTTPS either.

The updated real-socket regression test covers cold seven-second headers,
metadata/create budgets of four/five seconds, warm six-second headers, status,
and a six-second delayed body on one reused socket. It also proves that an old
request's abort/deadline cannot terminate the following request, and distinguishes
local `timeout`/`clientabort` from an injected remote HTTP `ECONNRESET`.

The private HTTP transport now has bounded keepalive pools (four sockets per
origin, eight total per protocol, two free per origin), aligns active socket inactivity
timeouts with the per-request absolute budget (`req.setTimeout(deadlineMs)`), and retains its original per-operation absolute
budgets. It cleans up its own socket observation listeners. No TLS checks are
relaxed; no global request budget is extended; connections remain reusable.
This is defensive isolation and diagnostic instrumentation, **not proof of a fix
for the production reset**.

Sanitized diagnostics persist requested deadline, actual elapsed time, HTTP phase,
wire/decoded byte counts, request-finished flag, reuse flag, process-local socket
ID, observed socket timeout and socket timeout event. Bounded notice-level provider stage events and warning-level failures
include them; notice is this repository’s info-equivalent severity. They contain no URLs, addresses, headers, capabilities, prompts,
or provider error bodies. Outer local timeout is reported as timeout before
propagating its abort to the inner request.

## Proven before/after warm-session behavior

The same Node worker/Mongoose/Mongo/HTTP/Python test was run against a detached
original worktree and the edited checkout. The Python bridge imports the exact
Gateway `tests/helpers/qwen_session_contract_server.py` `contract_runtime`, using
the real ASGI route, session manager, scheduler and lifecycle. A transparent ASGI
filter preserves receive/send and never consumes or rebuilds request bodies; no
extra BaseHTTPMiddleware is introduced. It replaces only
fake upstream computation with a valid named-adapter envelope and delays the
first two generations by seven/six seconds. Test-only routes expose fake-hardware
counters and invoke operator reservation handlers inside the isolated runtime.
These routes exist only in the test helper, never in the production app.

| Measurement | Original 5f6 | Changed worker |
|---|---:|---:|
| Recorded / valid outputs | 67 / 67 | 67 / 67 |
| Cold / warm elapsed | 7,022 / 6,020 ms | 7,020 / 6,017 ms |
| Session IDs / CREATE / DELETE | 9 / 9 / 9 | 1 / 1 / 1 |
| Exact operation IDs | 67 | 67 |
| Qwen model starts / stops | 9 / 9 | 1 / 1 |

The original worker failed the new one-session acceptance assertion as intended;
it did **not** fail a long generation. The original eight-case/120-second loop
closed its session in finally even when the logical run remained active.

The changed worker keeps the claim/session across cases, renews Gateway idle time,
and keeps the independent Mongo lease heartbeat. Hard expiry stays 900 seconds.
Before another case it reserves 260 seconds for generation/reconciliation/cleanup
and bookkeeping. It yields after a completed case to interactive requests,
at 256 operations, on the hard-lifetime boundary, or following verified remote
reclaim. Yielded benchmarks go behind waiting benchmarks. Cancellation, revocation,
disablement and cleanup fences remain active. Logical-clock tests prove 67 × 3 s
uses one session and 20 × 45 s rotates safely at the hard budget; a separate real
Mongo timer test verifies heartbeat renewal and abort after losing the lease.

## Admission and truthful UI

Known owned-create HTTP409 is `ADMISSION_BUSY`, retryable through a fresh request
once the current owner releases. It records stage `session.create` and
`inferenceDispatched:false`, creates no local hold/capability, and never deletes
another owner's reservation. An unknown create acknowledgement is
`ADMISSION_UNCERTAIN`: no generation was sent, but ambiguous ownership retains
an admission fence. Generation uncertainty still reconciles its exact operation.

The real Python test establishes an operator reservation, observes rejected Site
create with zero generation and hold=false, releases it through the test operator,
and completes a fresh Site job with verified owned cleanup. A real disconnected
Node HTTP request also proves accepted Python generation continues to correlated
terminal idle before owned cleanup.

UI recovery controls reflect the current hold; unheld status says recovery is not
needed. Failed historic outputs do not imply a current hold. Summary labels
recorded cases separately from successful HTTP200 JSON generations, validated
outputs, exact codes, errors and undispatched cancelled cases. A complete run with
67 errors says “Completed with 67 errors”; its denominator remains 67. Historical
missing generation counts stay unknown. Session end reason counts and transport
budgets/elapsed time are persisted and inspectable.

## Identity limitation and Gateway handoff

Normal immutable identity is explicitly UNAVAILABLE/RELEASE_CLOSED. Production
verification makes no unowned `/model` request. Current `/adapters` can start GPU
work if its mount is absent; Site metadata discovery therefore fails closed,
while the fixed v0 adapter remains selectable without discovery. Publishing a
benchmark or saving user-supplied revisions cannot satisfy the missing capability.
Wrong model/adapter/tool-call envelopes still fail validation; v0 never releases
normal mode.

No Gateway source modification was made in this Site task. Gateway
`704bccf64541889679fd827bbd24b83a9303db9b` now supplies session/operation logs,
generation fixtures, counters and external-reservation validation. This Site
bridge imports that exact runtime for the final local checks. Production must
rebuild/recreate its Docker image to run this source; a source pull alone is not
a runtime upgrade. Packaging validation was reported by the coordinator, not
rerun against a live service here. A future guaranteed GPU-free,
immutable and owned-session-compatible identity contract needs coordinated design.
The production five-second reset still requires evidence from the actual failing
HTTP boundary; these offline tests do not identify or repair that boundary.

## Reproduction

Supply a newly created disposable Mongo URI (the guard requires the exact
`mongodb://127.0.0.1:PORT/taric_test_NAME` form), then run with the pinned Node:

```sh
TARIC_TEST_MONGO_URL=mongodb://127.0.0.1:PORT/taric_test_review \
TARIC_GATEWAY_CONTRACT_HELPER=/home/lennart/ai-services/ai-gateway/tests/helpers/qwen_session_contract_server.py \
TARIC_GATEWAY_CONTRACT_PYTHON=/tmp/voice-baseline-test-venv/bin/python \
npm test -- taric --coverage=false --runInBand
npm run lint:openapi -- taric-assisted.v1.yaml
```

The test suite drops only its guarded disposable database. The Python subprocess
binds only 127.0.0.1, uses no production lifespan/environment, and has a 90-second
maximum lifetime. A temporary synthetic adapter metadata directory is provided
solely so the unmodified original client can be compared through the same harness.

## Validation and disposition

- Final shipping `npm test -- --runInBand --json` with all opt-in loopback suites
  enabled against Gateway **704bccf64541889679fd827bbd24b83a9303db9b**:
  **320 passed suites, 3,768 passed tests; 1 skipped suite / 4 skipped tests**
  in 168.999 seconds. The previous 3,763-test run belongs to the original review;
  five additional diagnostic/history tests now pass.
  The skip is the unrelated Windows-only GPT Image storage suite. All configured
  coverage thresholds passed (71.78% statements, 50% branches, 80.79% functions,
  72.64% lines across the curated coverage files).
- The final run includes **266/266 TARIC tests**, including **3/3 real Python
  generation tests**, **3/3 Python cleanup tests**, **56/56 Mongo tests**, and
  **7/7 real HTTP lifecycle tests**. All 67 generation requests succeed with one
  CREATE/DELETE/model start/stop, with cold >6.5s and warm >5.5s delays. External
  reservation contention/release and continued accepted generation after HTTP
  disconnect pass. Outbound logs assert socket timeout=60000 and the persisted
  session/operation IDs and 900000ms hard budget. Local expiry fires once, a
  completed request cannot abort its reused successor, and global Agent options
  stay unchanged. Fresh current-state UI and unknown historical counts also pass.
- The original-commit comparison intentionally fails the new one-session assertion:
  its hardware counters are 9 CREATE/DELETE/start/stop, versus the required 1.
  Every one of its 67 outputs succeeds; there is no reproduced five-second reset.
- `npm run lint:openapi -- taric-assisted.v1.yaml` and `git diff --check` pass.
- Initial development failures were corrected: obsolete batch/admission assertions,
  the fresh-state UI readiness regression caught by its new DOM test, and a
  disposable-Mongo tmpfs smaller than Mongo's index-build free-space requirement
  (recreated as 2 GiB). Final review also caught and fixed built-in DOMException
  AbortError classification; arbitrary cancel reason text remains redacted.
  OpenAPI, staged whitespace checks and a targeted new-content secret-pattern
  scan pass. No production action was used to resolve these findings.

The production-reset fix is not proven. These changes ship the proven warm-session,
admission and reporting fixes plus transport hardening and diagnostics as a
**partial root fix, not a full resolution**. Production deployment and GPU retesting
are separate operator actions; none was performed in this task.

## New production evidence supplied by the coordinator (not rerun here)

- 69 failed bodies were 908–1344 bytes; a success and failures both used 1073 bytes.
  UTF-8 Content-Length was correct. There is no observed body-size correlation.
  Fast LAN `/health` with 8 KiB headers does not prove anything about MTU.
- Native Windows Node sent an invalid create body after seven seconds and received
  HTTP400, with reused globalAgent and `agent:false`, with and without observational
  timeout listeners. Five-second socket/request events did not destroy the active
  request. This rules out the observer and a general LAN five-second cutoff in
  those probes, and does not establish Agent.timeout=5000 as the reset cause.
  Delayed upload and generation waiting for response headers are different paths;
  these probes do not prove the actual Qwen generation path stays alive.
- Gateway owned HTTPX requests override the global five-second default with
  read=7200, write=300, connect=10, pool=60 seconds. Request bodies are consumed
  before admission, with no reuse of the original request stream and no fixed
  five-second generation timer. Deliberate Node cancellation at five seconds
  reproduced zero-byte ECONNRESET while Gateway later retained HTTP200; that
  demonstrates the symptom, not the production abort origin.
- The actual production process proxy/preload environment remains unverified.
  A direct standalone Node 24 probe does not establish that process’s configuration.

## Shipping diagnostics and one-request handoff

The Site emits `TARIC transport runtime` once at client initialization, and
`TARIC provider generation transport` with `stage=provider.generate` and events
`start`, `socket_assigned`, `outbound_finished`, `response_headers`, then exactly
one `complete` or `failed`. At most one `socket_timeout` and `request_timeout`
observation is also recorded. Outbound finish means Node flushed its request;
only Gateway `accepted` proves admission. Failed provider events are warnings,
so critical errors remain available without a debug switch.

Exact allowlisted `metadata.transport` fields (when applicable):
`correlationId`, `operationId`, `sessionId`, `deadlineMs`, `requestTimeoutMs`,
`sessionRemainingMs`, `sessionHardBudgetMs`, `socketId`, `reusedSocket`,
`socketTimeoutStartMs`, `socketTimeoutMs`, `socketTimeoutObserved`,
`requestTimeoutObserved`, `requestFinished`, `phase`, `durationMs`, `outboundBytes`,
`wireBytes`, `decodedBytes`, `status`, `socketCode`, `dispatched`, `terminal`,
`abortTag`, `abortOrigin`, `abortReason`.

`deadlineMs=requestTimeoutMs=60000` is explicit for generation;
`sessionHardBudgetMs=900000`, and remaining hard lifetime is sampled before HTTP
submission. Start/current socket timeout values are observations, including any
idle-pool transition; they do not themselves identify a reset source. Only the
absolute timer aborts transport work. Every observer and timer is removed at
completion; no global Agent or TLS verification setting is changed.
`abortTag=LOCAL_ABORT` identifies local destruction; `abortOrigin` is one of
`absolute_deadline`, `warm_deadline`, `worker_stop`, `lease_lost`, `caller_signal`.
`abortReason` admits only those values, `abort_error`, or `unspecified`; arbitrary
Error messages/reason strings never enter diagnostics. Remote ECONNRESET has no
LOCAL_ABORT tag. Outer warm deadlines preserve the inner socket evidence.

Runtime metadata keys: `nodeVersion`, `agentSource`, `httpAgentConstructor`,
`httpsAgentConstructor`, `globalHttpAgentConstructor`, `globalHttpsAgentConstructor`,
`importedApm`, `timeoutSource`, `generationDeadlineMs`, `idleAgentTimeoutMs`,
`proxyPolicy`. APM discovery reports only a fixed list of already imported package
labels; an empty list does not rule out all instrumentation or later imports.
Proxy policy describes source configuration, not verified production environment.
The shared logger also supplies PID/start time/revision. No environment values,
URLs, headers, owner capabilities, product text or provider output are logged.

1. Deploy this Site commit and rebuild/recreate Gateway at `704bccf...`, preserving
   its existing **two Compose files and project name**. Do not bootstrap the DB,
   import/rotate keys, reset controls, rewrite histories or alter v0/model/catalog.
2. Read current readiness. Coordinator’s latest observation is **unblocked,
   epoch 7, no jobs: recovery is not needed**. Old failures are historical. Do not
   click recovery or obtain a manual reservation. Site uses the existing
   GpuScheduler through its own owned session. Stop if current readiness differs.
3. On one newly authorized human GPU start, submit exactly **one `test:true` job**
   with a fresh idempotency key. Use an item with existing local factual evidence
   to focus on generation. Do not start the 67-case benchmark or clone/relabel v0.
4. Save the request/case ID plus `correlationId`/`operationId` and `sessionId`.
   Query the Site messages above and Gateway `inference_session` records for
   `accepted`, `running`, `disconnected`/`caller_cancelled`, `completed`/`failed`,
   and `cleanup_completed`/`cleanup_failed`; correlate Gateway fields `session_id`,
   `operation_id`, `http_status`, `duration_sec`, `outcome_code`, `reuse_allowed`,
   `cleanup_kind`, `cleanup_phase`, `reclaim_basis`. Capture safe errors only.
   Allow Site’s owned cleanup in finally to finish; never release another owner.
5. If the same five-second reset occurs, stop and return those records to the
   coordinator. Do not launch 67 expensive failures. Only after the individual
   request works should a fresh, explicitly authorized full warm benchmark run.
