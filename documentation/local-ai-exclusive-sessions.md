# Durable exclusive Local AI sessions

## Current handoff — 2026-10-17

Site runtime **`d9059a4e19a5354e9759455761c4b4251989d9c6` is complete and
human-deployed**, with no deployment issue reported. The human ran image and text
work after one manual Start and reported completion and release without errors.
Continuous reservation appeared to hold; no competing AI request was attempted.
Gateway's separate passive physical capture is authoritative for GPU/container
behavior; its final findings are not assumed here. Physical busy rejection,
Codex exclusion/tool gaps, live restart/resume, cutoff, vision/all-20-workflow
execution and the first automatic overnight run are **not established by this
canary**. CPU/synthetic verification is recorded separately below.

**AUTO enablement: PENDING HUMAN.** Reported settings are
`LOCAL_AI_BATCH_ENABLED=true`, `LOCAL_AI_BATCH_MEDIA_ENABLED=true`,
`LOCAL_AI_BATCH_AUTO_DISPATCH=false`, with Gateway sessions enabled. This wrap-up
changes documentation only; no production settings, processes or data are changed.

Release dependency: Gateway runtime `e20a437775bcf292d062d987c7850cd7d63a2a1a`,
documentation `f19366e2451104bba90ec564e3553b4690f4fda9`, image
`sha256:358d83175259ec9914131c9a3d72764bebaf6ff199a0170bc0e9b21479eac8e5`.
The exact contract is `/home/lennart/ai-services/documentation/gateway/durable-batch-sessions.md`.
New dispatch fails closed without exclusive capability and the
same-coordinator resume contract. Retained legacy results remain readable.

## Daily operation

- Queue from `/chat5`, `/image_gen`, or `POST /api/local-ai/v1/jobs` with an existing
  owner-scoped Site bearer token and stable `Idempotency-Key`. Browser equivalents
  use `/local-ai/api/v1`, the login session and CSRF for mutations. Inspect jobs
  and retained results at `/local-ai/queue` and `/local-ai/queue/:id`; manage the
  global scheduler at `/admin/ai-gateway`.
- Automatic acquisition is limited to **01:00 inclusive–06:00 exclusive JST**.
  Gateway busy/unhealthy/deferred acquisition persists a **30-minute** retry in
  `session.next_attempt_at`; the 10-second coordinator tick does not bypass it.
  Admission retries and collection are separate from that busy delay.
- One exclusive session spans compatible cohorts and Comfy model-stack switches;
  Gateway owns verified teardown/switching and release. Manual Start retains its
  original budget (at most five hours, bounded by the next 06:00 cutoff). Repeated
  Start, waiting, model changes and resume do not grant a fresh deadline.
- Stop-after-current (`finish_current`) and stop-now (`cancel_active`) persist
  intent before network I/O. A 202 means accepted, not released. Wait for released
  plus verified cleanup; collection/ACK may continue afterward. Unknown outcomes
  stay in review rather than being regenerated. Same-coordinator restart/resume
  preserves deadlines; cross-host takeover still requires proven fencing.
- Immutable owner-bound private inputs support Comfy references and catalog-approved
  Ollama vision, including Chat5 with trusted attachment provenance. See the
  [private input/vision API](local-ai-media-phase1.md) and
  [all 20 registered workflows and every final output slot](local-ai-media-release.md#supported-registry-all-20).
  All final PNGs and MP4s (with original audio) are retained privately and delivered
  through authorized result/output routes, not just the first output. Registry
  support is not a claim that all 20 were physically exercised. Historical public
  Chat5 originals **remain public**; private snapshots do not repair that existing
  limitation. Preserve accepted inputs, outputs, journals and backups.

## Enable AUTO — minimal human procedure

For the already deployed Windows checkout `C:\Projects\lentmiien-site`:

1. Change **only** `LOCAL_AI_BATCH_AUTO_DISPATCH=true` in the web service's effective
   configuration. Normally this is the checkout's `.env`; if WinSW XML
   `C:\Services\LennartWeb\LennartWeb.xml` or inherited environment overrides this
   key, change that existing override too. `dotenv` does not override inherited
   values. Leave the already enabled acceptance/media/session settings intact.
2. In elevated PowerShell run `Restart-Service -Name 'LennartWeb'`. Leave the normal
   console `npm run codex-worker` running: it has no Local AI dispatcher, and its
   activity registration depends on `LOCAL_AI_BATCH_ENABLED`, not AUTO. No worker
   restart, credentials, source pull, initializer or dependency change is needed
   solely for AUTO. No application redeploy is needed for these documentation edits.
3. Once database readiness returns, use the authenticated, read-only
   **`GET /local-ai/api/v1/scheduler`**. Expect `enabled: true`, `auto: true`.
   After the completed manual session, `session.state: "released"` with
   `session.cleanup: "verified"` and `run: null` confirms Site's recorded release;
   `session: null` alone is not release evidence. Inspect `reason`,
   `next_attempt_at`, `session.next_attempt_at`, `manual_requested_at`,
   `manual_deadline`, `suppressed_window`, `activities` and the coordinator lease.
   This GET is a Site projection plus Gateway activity listing, not a fresh
   physical-session audit. Use the separate production read-only check for actual
   control records, Gateway release, and clock; `manualStoppedUntil` is not exposed
   by this endpoint. Do not clear control records to force a run.

The web loads `.env` at [app.js](../app.js#L1) and starts the dispatcher after DB
readiness at [app.js](../app.js#L804). The console starts only the Codex queue
worker at [scripts/codex-worker.js](../scripts/codex-worker.js#L62).
Flag parsing is [gateway.js](../services/localAi/gateway.js#L6), dispatch gating is
[worker.js](../services/localAi/worker.js#L141), Codex registration gating is
[codexActivity.js](../services/localAi/codexActivity.js#L9), and status fields are
[routes/localAi.js](../routes/localAi.js#L119).

Compute eligibility from the actual clock and persisted controls, not the date of
this handoff. [windowAt](../services/localAi/policy.js#L14) uses UTC+09: before 01:00,
the next opening is today's 01:00; from 01:00 to before 06:00 the current window
may run immediately; at/after 06:00 the next opening is tomorrow's 01:00. Suppression
of that JST date, a manual stop hold, retry time, unreleased activity/session or
lack of due jobs can delay it. Manual release normally suppresses its current JST
date; a restart/AUTO toggle does not reset that control. `windowAt().next` always
means the next opening, even while the current window is open.

At the wrap-up clock reading **2026-10-17 23:28 JST**, the next nominal window is
**2026-10-18 01:00–06:00 JST** (`2026-10-17T16:00:00Z`–`21:00:00Z`), subject to
the separate production control/clock check. Recalculate if enabling later.
Optionally queue one tiny job and leave it for AUTO without pressing Start; its
first overnight result remains unverified until observed. To disable future
automatic starts, set AUTO false and restart only LennartWeb; this does not stop
an already held session (use the existing stop control if needed).

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

Until the human performs the enable procedure, keep AUTO false. Acceptance uses the existing
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

## Recovery constraints

The reported host has already completed deployment and initialization. Do not
repeat installation or initialization just to enable AUTO. This release has no
new runtime dependencies; the pinned Node version is **24.20.0**.

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
warming and Windows process incarnation are not proved by these tests. Human live
observations and remaining unknowns are recorded in the current handoff above.

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

The implementation validation did not change production processes, databases,
Gateway source or feature flags; deployment and the subsequent image/text run
were human-operated. The disposable test Mongo was recorded as removed after
validation. During this docs-only wrap-up, temporary smoke files/test logs and
shared resources were retained where ownership or continued use was uncertain;
no database, Docker, process or accepted-data cleanup was performed.
