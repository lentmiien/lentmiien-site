# Local AI manual admission recovery

This is an update for the already initialized Windows deployment at Site
`059f45b66e3e383421ddeb66190149dd7b68c469`, with batching enabled and AUTO off.
It does not repeat stage-2 installation or change Gateway runtime
`d566158117d0bf55d61367dc3f026d6948e0d246`.

## Findings and scope

The immediate stall is a Site retry-state bug. A run PUT rejection sets the
scheduler's 30-minute delay. Active-run PUTs previously bypassed that delay; after
a later GET/PUT acknowledged the same run, uploads still obeyed the obsolete
delay. The reported open remote receipt is actual acceptance of the run, not
acceptance of its frozen operations or completion of a job.

Clock skew is a plausible cause of the original `invalid_manual_deadline`, not a
measured production fact. A Site clock 36 seconds ahead reproduces the rejection
against the exact pinned Gateway router. Its manual validator limits the deadline
to Gateway now + five hours and the next 06:00 JST. Readiness `observed_at` is not
used as current server time. No production clock measurement or mutation was
performed for this fix.

This maintains the existing logged-in/private service-principal integration,
admin scheduler capability, owner-scoped jobs and CSRF-protected controls. No new
browser mutation, credentials, environment variables, dependencies, indexes or
public/private file paths are introduced. Clock probes use only the existing
configured Gateway origin and passive capabilities route; redirects are disabled.
Diagnostics omit URIs, credentials, prompts, owners, conversation IDs and payloads.

## Admission and reconciliation

- Persist the original wire and frozen manifest before PUT. Track uncertain
  submission before sending, definitive validator rejection with HTTP status,
  and acknowledged acceptance separately. HTTP transport uncertainty, 404 and
  immutable conflict do not establish nonacceptance.
- GET reconciliation continues during delays. Run PUT retry honors both its
  persisted admission delay and scheduler delay, including after restart.
- Verify ID, mode, both immutable bounds, status and operations envelope before
  acknowledging a receipt. A persisted pre-fix receipt can migrate admission
  state, but fresh Gateway state still gates upload/seal.
- Clear only the matching run-admission delay/reason using a fenced compare-and-set.
  For records without stage metadata, only run-validator-specific reasons qualify.
  Busy/health, quota, persistence, stop/cancel and other-stage/run delays remain.
  Stop intent, manual budget, automatic suppression and dispatch flags are not
  reset. An acknowledged run followed by 404 stays accepted and blocks new PUTs.
- Retry a rejected unaccepted wire unchanged when due. Never retime/replace it,
  its IDs or attempts. Expired missing manifests remain retained with
  `rejected_run_bounds_expired` or `remote_run_missing_after_deadline`; neither is
  permission to enqueue another execution. Accepted terminal-run recovery and
  original deadlines are unchanged.

The scheduler response exposes admission state/reason/HTTP status separately from
`remote_status`, frozen `operations`, `accepted_operations`, and
`completed_operations`. Completed remote operations still require Site publication
and acknowledgement. Resolved admission reasons disappear on reconciliation.

## Clock bounds for new runs only

Fetch `/batch/capabilities` with a random probe query and no-cache/no-store request
headers. Validate its protocol and HTTP Date. Reject missing/noncanonical dates,
cache hits/nonzero or invalid Age, round trips over two seconds, apparent offsets
over two minutes, local wall-clock steps over 250 ms versus monotonic elapsed time,
and samples older than five seconds. These thresholds fail closed with
`gateway_clock_uncertain`; work stays queued. The Date must be supplied by the
configured Gateway server, not rewritten by a proxy with an unrelated clock.

The server-time interval includes whole-second Date precision, Uvicorn's
once-per-second header refresh, network transit and a conservative extra second
on the lower bound. Use the upper bound for not-before; cap manual deadlines by
the lower bound plus five hours, the original absolute Site budget, an initial
Gateway budget adjusted for time already spent waiting, and the earliest 06:00 JST
cutoff, with an additional one-second deadline margin. Persist the initial Gateway
budget before creating the first wire; subsequent cohorts/restarts cannot extend
it. Existing accepted wires never use the new clock calculation.

Automatic admission requires Site time and the entire Gateway interval inside the
same 01:00–06:00 JST window. Ambiguous 01/06 boundaries or fewer than five seconds
of safe remaining time produce `gateway_clock_window_uncertain`. This is bounded
skew handling, not a guarantee against arbitrary clock jumps, stale/rewritten Date
headers that violate these assumptions, or delay after the probe. Gateway remains
the final admission and execution cutoff authority.

## Human Windows update only

1. Keep `LOCAL_AI_BATCH_ENABLED=true` and
   `LOCAL_AI_BATCH_AUTO_DISPATCH=false`. Keep Gateway settings/runtime unchanged.
   Let active Codex work drain, Ctrl+C the usual console worker, and stop the
   existing `LennartWeb` WinSW service. Confirm the old processes exited; never
   clear a coordinator lease to bypass the Windows PID fence.
2. In `C:\Projects\lentmiien-site`, confirm the checkout is clean and update to
   the supplied fix commit with `git pull --ff-only origin main`. Stop on Git
   errors/divergence and verify `git rev-parse HEAD`. Dependencies are unchanged:
   **no `npm ci`, initialize command, setup.js, npm start, database edit or new
   enqueue** is needed.
3. Start `LennartWeb`; restart exactly one normal-console worker with
   `npm run codex-worker`. Allow the old lease to expire naturally (up to 90
   seconds), then inspect the existing read-only scheduler/queue UI.
4. For a matching open run still within its original deadline, expect its stale
   admission reason/delay to clear, the same two frozen operations to upload and
   seal, then results to import into the original Chat5 response placeholders.
   Run IDs, operation IDs, prior attempts and history remain unchanged. If the
   original deadline has elapsed, retain the ordinary terminal recovery outcome;
   do not extend the run or submit replacement jobs to force this check to pass.
   Report only stage, safe reason code, HTTP status and counts if blocked.

## Reproduce development validation

Validation on Node 24.20.0: 8 focused suites / 126 tests passed. The full suite
passed 400 suites / 5,181 tests with configured coverage thresholds met; 8 suites /
122 tests were skipped. The disposable Mongo and pinned Gateway protocol suites
were enabled and passed. Diff review and whitespace checks passed. Live Windows
rollout and production clock measurement remain human verification steps.

Use a disposable standalone MongoDB bound to loopback, never production. Both
integration suites import `database.js` before connecting, matching production
buffering/model compilation order. They exercise pre-fix records, process fencing,
lost replies, rejection retry gating, unrelated deferrals, immutable histories,
two-job cohorts and deterministic Chat5 publication/acknowledgement.

The optional protocol test loads **git objects at the pinned revision**, not the
Gateway worktree. It runs the real FastAPI run router and SQLite journal in a
temporary directory without importing app.py or starting GPU/background workers.
Point `LOCAL_AI_GATEWAY_PYTHON` at a test Python environment containing FastAPI,
HTTPX and Pillow; `LOCAL_AI_GATEWAY_CHECKOUT` at the read-only Gateway checkout.

```sh
LOCAL_AI_GATEWAY_CHECKOUT=/home/lennart/ai-services \
LOCAL_AI_GATEWAY_PYTHON=/tmp/site-local-ai-protocol-venv/bin/python \
LOCAL_AI_TEST_MONGO_URI=mongodb://127.0.0.1:27028/local_ai_test \
npm test -- --runInBand
```

Without the explicit disposable database/protocol environment, those integration
tests skip rather than contact any configured production service.
