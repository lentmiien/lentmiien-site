# Exclusive batch sessions: historical continuing-coordinator restart blocker

The blocker below is fixed by Gateway `e20a437775bcf292d062d987c7850cd7d63a2a1a`.
The old-pin reproduction remains intentionally unchanged. Current Site implementation,
initialization and rollout instructions are in [the session runbook](local-ai-exclusive-sessions.md).
The historical status and evidence below describe diagnostic commit `cb575ae` only.

Historical status at diagnostic commit `cb575ae`: **the Site exclusive-session release was not implemented or
ready for rollout**. That diagnostic change adds an executable protocol reproduction and
this report only. It does not add a session coordinator, persistence models,
caller handling, UI, configuration or migration. Existing v1/v2 Site behavior
and accepted history are unchanged.

## Exact reviewed contract

- Site baseline: `88cb919e355d19a0ef021dda7f3405f40b9b9937`.
- Gateway: `637591024b691ad733469f51cc73d8b7e501a1f5`.
- Gateway contract: `documentation/gateway/durable-batch-sessions.md` in the
  shared `ai-services` repository at that commit.
- Reported runtime-image source: `4313e6b7e4cab39f4a8a01c27a2f03536dcebdce`;
  reported image digest:
  `sha256:9a0d80cac97a3f679fd983d03f8cf36987e020a809a77fa7bff95ac7e38bda5a`.
  Neither the image nor any physical GPU lifecycle was exercised here.
- Protocol remains `durable-local-ai` version 1, operation schemas 1/2;
  exclusive-session capability is 1 and the journal minimum reader is 4.

The test reads the exact committed Python modules with `git show`. Uncommitted
Gateway files are neither read as protocol implementation nor modified. No
earlier proposal, session name or invented endpoint is used.

## Reproduced gap

A Gateway-only restart leaves the same live Site coordinator unable to resume
its held session, even with positive lease and hard-deadline budgets. This is
specifically a continuation gap, not an inability to stop or clean up.

The shipped implementation does the following:

1. `DurableBatch.start()` creates a fresh epoch and calls
   `BatchSessions.restore()`. A held session becomes `recovery_required` with
   `recover_pending=False`.
2. GET returns that state and positive remaining durations. Dispatch is false.
3. Renewal with the old epoch returns `409 batch_gateway_epoch_changed`.
4. Renewal with the fresh epoch returns `409 batch_session_expired`: the renew
   handler accepts only `held` or `acquiring`, irrespective of the still-positive
   durations in this reproduction.
5. `/recover` requires `previous_coordinator_terminated: true`, a different
   coordinator ID and a different token. A truthful `false` assertion is rejected
   with `409 coordinator_termination_required`. Reusing the same coordinator ID
   is rejected with `409 new_coordinator_and_token_required`.
6. Exact replay of a previously committed acquire or renew returns current
   `recovery_required` status plus its historical mutation outcome. It does not
   restore dispatch or grant a new lease.
7. Passive reconciliation and the session watchdog do not promote this state
   to held. The watchdog takes the recovery path only for `recover_pending=True`,
   which the successful takeover handler sets.

These branches are in `ai-gateway/durable_batch.py` (`start`, `_tick`) and
`ai-gateway/durable_batch_sessions.py` (`restore`, mutation route, `tick`) at the
commit above. The existing Gateway restart test uses a **different** coordinator
and asserts termination; it does not establish continuing-coordinator recovery.

The new Site test proves that stale/fresh epoch renewal, truthful recovery,
same-ID recovery, mutation replay, run registration, close and passive
reconciliation cannot resume that owner. The immutable existing run survives.
No test sends a successful takeover assertion for an actually live old owner.

## Safe behavior available in this contract

The current authority can send owned `/stop` with the fresh Gateway epoch.
The response is `200` with `state: stopping`, not release proof. The watchdog
performs owned cleanup and eventually reports `released` with `cleanup: verified`.
Only then does it request idle warming. Renewal cannot revive that released
session. Exact replay of stop remains idempotent.

The reproduction tests this path using the real cleanup state machine with
synthetic container state/stop and telemetry callbacks. This is CPU protocol
evidence, not proof of real Docker termination or VRAM reclaim. It does not
exercise active inference cancellation.

A future Site implementation must report this situation as blocked or stopping,
forbid new dispatch, retain immutable runs/results, and never infer GPU
availability from an empty operation queue. It cannot claim the previous Site
coordinator terminated merely because Gateway restarted or its epoch changed.
Stop/release followed by a newly acquired session also does not meet continuous
ownership across the original queue and must not silently replenish a manual
budget.

This does not rule out a separately designed, supervised **actual process
handover**. Such a design must terminate and verify the old coordinator process,
persist the old/new authorities and recovery intent, and handle lost replies
before takeover. Merely changing an in-process worker UUID or Mongo fence is
insufficient. The existing Site worker runs inside the web process; no automatic
web/container termination has been added or performed.

## Resolution needed before a complete release

Either the authoritative Gateway contract must define a safe same-coordinator
restart reconciliation path, or Site must deliberately implement and validate a
real process handover. A paused/released session can be safe, but it must be
documented as degraded behavior rather than successful continuous recovery.
No Gateway fix or replacement API is proposed as if already shipped.

After a resolution is shipped, pin its actual commit and add a positive
continuation test. Keep the negative cases: a stale authority must never dispatch,
released ownership must never revive, and old mutation replays must not extend
deadlines. The remaining requested Site implementation and release validation
are still required, including standalone Mongo fencing/intake sealing, all
affinities in one session, independent renewal, callers, owner-scoped UI/API,
stop races, private media, and the physical canary.

## Reproduce without production access

Use Node **24.20.0** and an existing isolated Python environment with `fastapi`,
`httpx`, `Pillow` and `python-multipart`. These are test dependencies only; this
change adds no npm/runtime dependencies. The Python harness requires Linux's
boot-ID/CLOCK_BOOTTIME facilities, matching the Gateway target.

```bash
LOCAL_AI_GATEWAY_SOURCE=/path/to/ai-services \
LOCAL_AI_PROTOCOL_PYTHON=/path/to/test-venv/bin/python \
npm test -- tests/unit/localAiPinnedSessions.test.js --runInBand --coverage=false
```

The seven Jest checks intentionally pass when the pinned implementation exhibits
the documented blocker. A passing result is **not** a passing exclusive-session
release gate. The suite is explicitly skipped without both environment variables;
the release check must supply them. The Gateway Git object for the full commit
above must be available locally. No network fetch is performed.

The helper creates and removes a disposable SQLite directory, runs actual batch
routes in HTTPX's in-process ASGI transport, and uses only synthetic credentials.
It does not import Gateway `app.py`, run its lifespan, connect to Mongo, load
`.env`, or call external HTTP/Docker/GPU services. Only simulated time is pinned;
real monotonic lease accounting is retained. Public evidence omits all tokens.

Validation for this diagnostic change used Node 24.20.0: the focused suite passed
all seven checks, and `npm test -- --runInBand` with both protocol variables set
passed 405 suites / 5,218 tests and the configured coverage thresholds. There were
12 skipped suites / 197 skipped tests. No standalone Mongo or Windows deployment
validation of the requested new session coordinator is claimed; that coordinator
has not been implemented.

## Deployment, initialization and rollback

There is **no Site deployment or initializer required for this diagnostic
commit**. It must not be described as Stage 6 Site completion. Do not enable
Gateway `BATCH_SESSIONS_ENABLED` (default false) based on these tests; keep Site
`LOCAL_AI_BATCH_AUTO_DISPATCH=false`. This work leaves both production services
and their settings untouched, including the reported live Stage 5 Gateway.

Do not run `npm start`, `setup.js`, a production initializer, or a Windows service
restart as part of reproducing this report. The later Windows deployment
procedure depends on the chosen coordinator process/termination-proof design
and remains unvalidated.

Any future first session attempt, including a busy acquisition anchor, raises
the Gateway journal reader requirement to 4. Disabling the flag does not undo
that marker or ownership. A rollout must preserve the ledger and use a reader-4
compatible rollback; never restore an older ledger over accepted records.
Only after complete Site implementation/testing and the Stage 6 helper review
should a human canary validate one acquire across text, reference Comfy and vision
cohorts, no intermediate warming, and verified final release with AUTO still off.
