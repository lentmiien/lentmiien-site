# Durable exclusive Local AI sessions

Release dependency: Gateway runtime `e20a437775bcf292d062d987c7850cd7d63a2a1a`,
documentation `f19366e2451104bba90ec564e3553b4690f4fda9`, image
`sha256:358d83175259ec9914131c9a3d72764bebaf6ff199a0170bc0e9b21479eac8e5`.
The exact contract is `/home/lennart/ai-services/documentation/gateway/durable-batch-sessions.md`.
Keep `LOCAL_AI_BATCH_AUTO_DISPATCH=false`. No production deployment is performed
by this change. New dispatch fails closed without exclusive capability and the
same-coordinator resume contract. Retained legacy results remain readable.

## Security contract

Logged-in feature; interactive admin/family/user access follows the existing
`local_ai` capability bundles. `local_ai.scheduler.manage` controls global scheduling;
it does not confer access to foreign jobs, prompts, media, or results. Job and
artifact access remains owner-scoped with current source authorization. Machine
principals use existing revocable scoped Local AI tokens. Session status is
admin-managed operational metadata; credentials are secret and server-only.
Browser mutations retain shared session CSRF, non-GET methods, private/no-store,
no analytics and escaped Pug/textContent rendering. Existing input/body/quota
limits remain enforced; intake is bounded to 1,000 concurrent entries. Private
media remains outside public. Outbound traffic uses the configured authenticated
Gateway origin. Logs contain stable codes and identifiers, never raw exception
messages, authority headers or session tokens. Session and mutation history is
retained for recovery; no automatic deletion or ledger rollback is supported.
Negative tests cover capability/owner boundaries, token redaction, stale authority,
stop/drain races and nonadmission handling alongside existing media/auth tests.

## Configuration

Keep `LOCAL_AI_BATCH_AUTO_DISPATCH=false`. Manual acceptance uses the existing
`LOCAL_AI_BATCH_ENABLED` switch; media/Comfy acceptance additionally requires
`LOCAL_AI_BATCH_MEDIA_ENABLED`. This change does not enable either switch.
Keep `AI_GATEWAY_BASE_URL`, stable `BATCH_CLIENT_ID`, and the dedicated
`BATCH_SERVER_TOKEN` configured as before. Session tokens are generated privately
and need no environment variable. Preserve `LOCAL_AI_BATCH_DATA_DIR`,
`LOCAL_AI_INPUT_DATA_DIR`, `LOCAL_AI_OUTPUT_DATA_DIR` and their quotas/ACLs.
MongoDB configuration and session CSRF configuration are unchanged.

## Storage and operation

`DurableLocalAiSession`, `LocalAiSessionMutation` and `LocalAiSessionRequest` are
additive Mongoose models. The request journal preserves browser Start idempotency
even after the original session has ended.
They have buffering, autoCreate and autoIndex disabled. The existing DB-ready
Local AI bootstrap explicitly creates collections/indexes. The unique active-slot
index permits one unresolved session. Control holds the active session, stable
ownership epoch, per-tick fence, queue revision and bounded in-flight intake.
No Mongo transactions or replica set are required. Mutation authority is selected
explicitly only inside server coordinator code. Do not export journal documents
as API responses or log them.

One logical manual Start retains its deadline through repeated clicks, waiting,
cohorts and recovery. Gateway server time and monotonic request timing determine
acquire bounds and dispatch safety. Each immutable run adds its session ID and
contiguous sequence; old wire bodies and digests are unchanged. Gateway owns all
GPU teardown. Site never invokes Docker for session cleanup.

The independent heartbeat extends Mongo authority and renews Gateway ownership;
it does not increment generation. Database/ownership loss halts new mutations.
Gateway lease/hard-deadline cleanup remains independent of Site. Same coordinator
uses a persisted resume key per Gateway epoch and separately renews. A different
coordinator requires proven old PID termination/incarnation mismatch or explicit
operator fencing; an expired Mongo lease alone is insufficient. Cross-host
handover requires actual external fencing before the trusted admin command.

Stop persists intent before network I/O. HTTP acceptance is stopping, not stopped.
Only released plus verified cleanup clears the active fence. A recovery fallback
stops/releases first and retains the original deadline. Successful output
collection and ACK can continue after release and with acceptance flags disabled.

## Windows update (human-operated, AUTO off)

1. Keep AUTO off, drain/stop the old coordinator and verify termination before
   replacing its process. Preserve Mongo, private media and Gateway ledger data.
2. Install the pinned Node **24.20.0**, update Site, and run `npm ci` if dependencies
   changed. There are no new runtime dependencies in this feature.
3. With the configured database available, run
   `node scripts/local-ai-admin.js initialize-by-name "EXACT ADMIN NAME"`.
   This creates all three new models and all required indexes without starting the app.
4. Gateway must be the pinned reader-4 compatible release with sessions enabled
   by its human rollout procedure. Do not enable AUTO. Start Site only through
   the approved deployment process. This implementation task does not start it.
5. Later human canary: Comfy → vision → text, one acquisition, no warming between
   cohorts, verified final release and one warming request. Check both status
   panels and retained outputs. CPU tests do not establish physical GPU behavior.

If an old Windows PID is still alive, terminate and verify it; never claim it
terminated because Gateway restarted. For cross-host or unverifiable incarnation,
use `fence-coordinator <admin-id> <old-holder> --old-coordinator-terminated CONFIRMED`
only after actual operator fencing. This is an assertion of evidence, not a
process-kill command. Session history requires this Site reader and Gateway
reader 4 even after flags are turned off. Never restore old data over newer jobs.

## Isolated checks

Use disposable standalone loopback Mongo (`local_ai_test` database), Node
24.20.0, and a Python environment containing FastAPI, HTTPX, Pillow and multipart.
Set `LOCAL_AI_TEST_MONGO_URI`, `LOCAL_AI_GATEWAY_SOURCE` to the ai-services Git
repository and `LOCAL_AI_PROTOCOL_PYTHON` to that environment. No test should
load production `.env`, import Gateway app lifespan or dispatch live AI work.

The release checks run with:

```sh
npm test -- --runInBand
```

Use the three test environment variables above to include standalone-Mongo and
pinned-Gateway suites. `tests/unit/localAiPinnedSessions.test.js` retains the
seven old-pin diagnostic cases; `localAiPinnedResume.test.js` adds eight success
and fence cases against the fixed pin. `tests/integration/localAiSessions.test.js`
exercises production model compilation/bootstrap and the actual Site coordinator
with synthetic transport and real standalone persistence. Physical container
warming, Windows process incarnation and GPU model execution still require the
later human canary; no such work was run here.

`node tests/browser/localAiSessions.smoke.js` renders synthetic Pug pages only.
It needs development-only Playwright/Chromium; optional `PLAYWRIGHT_MODULE` and
`CHROMIUM_EXECUTABLE` select an existing installation. It opens no Site app or AI
backend and writes mobile/desktop screenshots to the OS temporary directory.

Validation recorded on 2026-10-17 using Node 24.20.0:

- Full Jest run with disposable standalone Mongo and pinned CPU harnesses:
  **412 suites / 5,342 tests passed**, 8 suites / 123 tests skipped; configured
  coverage thresholds passed (71.78% statements, 72.64% lines).
- Final focused validation after review: **15 suites / 245 tests passed**,
  including old/new Gateway pins, recovery fallback with original bounds,
  real child-PID handover, media workflows, authorization, caller busy handling,
  and monitoring. These counts overlap the full run and are not additive.
- Synthetic Chromium smoke: mobile 390px and desktop 1440px panels, reserved
  inter-cohort state, release-pending state, CSRF and Start retry key passed.

No production process, database, Gateway source, deployment, live AI job or
feature flag was changed. The disposable test Mongo is removed after validation.
