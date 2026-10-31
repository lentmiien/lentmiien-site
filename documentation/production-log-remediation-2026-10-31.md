# Production log review remediation — 2026-10-31

Workflow: `34e89e0b-515e-4c57-96b0-3661fb34f18d`.

The supplied report covers October 23–30. Findings were checked against current
source before editing. This is a source repair, not a claim of production recovery.
No production database, GPU operation, import, hold, Windows service, or Gateway
configuration was changed. The original Windows log paths are unavailable in this
checkout; the incident evidence comes from the supplied report.

## Finding decisions

| Finding | Current-code verification and disposition |
| --- | --- |
| F1: MongoDB outage | Readiness gating, restart-persistent incident notification deduplication, reconnect backoff, and recovery already exist. The emergency notification even identifies the possible Windows-login/Docker dependency. No application behavior change is justified by the supplied evidence. Windows Update followed by Docker starting at login remains plausible, not verified. |
| F2: TARIC cleanup | Confirmed one DELETE followed only by GET polling. The checked-in Gateway contract explicitly permits same-capability retries. Added at most two retries after HTTP 502/503/504, separated by 2/4-second minimum waits and a successful fresh GET reporting `idle` or `running`. The total 100-second cleanup budget is unchanged. No retry for `reclaiming`, terminal `uncertain`, failed/unknown status, or authorization rejection. Reclaim proof remains mandatory; generation and session creation are never replayed. |
| F2: invalid output | Output-contract validation remains appropriate. No evidence supports relaxing it or merging these incidents with the timeout. |
| F3: JMA feeds | Confirmed validation errors lost their reason in the safe diagnostics helper. Added fixed `invalid_xml`, `missing_metadata`, `stale_timestamp`, and `future_timestamp` reasons, validation phase, configured feed index/kind, and observed age/threshold where applicable. Per-feed first failures and reason changes log immediately, persistent failures summarize hourly, and recovery logs once. Every poll still updates readiness and stored feed health. The 45/105-minute freshness limits and five-minute future tolerance are unchanged. |
| F3: municipality parser | Current v3 classification and status-only clear-evidence tests already cover the earlier regression. No further parser change. Healthy stored production classifications/pending counts still require runtime verification; quiet logs do not establish coverage. |
| F4: Gateway availability | TTS retains cached voices and embedding admission defers safely. Added model, operation stage and local job ID to Experimental Models failures, plus an embedding availability-check recovery transition that distinguishes recovered-but-busy from available. No provider retry, timeout, or generation policy change. The listener/worker root cause cannot be established from this checkout. |
| F5: batch results | Confirmed destructive missing-result handling and premature notifications. Both result files are now reconciled before declaring anything missing. Failures are stored before placeholder cleanup and retained on the status page. Error-only batches, missing records, duplicate records, empty summaries, non-success responses and invalid converted output have explicit outcomes. Requests finish with local success/failure counts. Notifications follow finalization and only the finalization winner emits a completion outcome. |
| F6: AmiAmi 400s | Current code already treats 400 as nonretryable, persists failed placeholders, reports safe status/target/attempt diagnostics, and supports explicit import retries. No affected item codes or provider error payloads were supplied, so neither an item-removal classification nor a request-contract change is supported. No scraper behavior changed; existing nonretryable-400 and failed-import tests were verified. |

Runpod cooldowns, TARIC evidence/catalog safeguards, recorded maintenance, and
isolated session/security events do not justify behavior changes.

## Batch finalization and retry

OpenAI documents successful rows in `output_file_id` and failed rows in
`error_file_id`, matched by `custom_id`, not file order:
[Batch result retrieval](https://developers.openai.com/api/docs/guides/batch#5-retrieve-the-results).

An atomic, renewable ten-minute database claim excludes competing completion
handlers. Expired claims can be reclaimed. The shared message writer uses
deterministic per-batch/per-prompt output IDs, so interruption after message
persistence does not insert the same output again. Locally `DONE` requests cannot
be reopened by a delayed provider status refresh. Declared but unreadable result files
defer finalization; an absent file ID is distinct from a failed download.

Prompt metadata is retained with `queued`, `failed`, `succeeded`, or `retrying`
state. Successful prompts are omitted from the active status list; failed prompts
remain visible with fixed reasons and allowlisted provider codes. Request counts
describe local imports, not merely provider transport success. The existing
terminal-request cancellation/failure cleanup outside completed-batch processing
is unchanged. Historical prompts already discarded by the old implementation
cannot be reconstructed by this patch.

On the Batch Status page, **Retry using current chat** queues a failed prompt for
the normal batch trigger. It uses current conversation contents and settings,
creates a fresh placeholder for responses, and preserves the last failure. It
does not immediately submit a provider batch. A prompt allows five explicit
retries. Interrupted retry preparation stays visible as `retrying` and is never
automatically dispatched. Inspect that record and any placeholder before queuing
replacement work. Completed summaries and responses keep the same delivery path.

The notification is emitted after the durable finalization claim succeeds. A
process exit between that commit and notification delivery can omit a push; this
is not an exactly-once notification delivery guarantee. The status page retains
the authoritative counts.

### Security contract for the new retry operation

- Zone: logged in; private data; no new machine principal or public operation.
- Capability: `batch.prompts.manage`. Admin bundle grants it; family/user bundles
  do not. Explicit grants confer the same declared admin-managed queue scope.
- Object scope: admin-managed retained failed prompts; no owner-ID input.
  Principal ID comes from the authenticated session and is rechecked against the
  current account/capabilities before delayed retry dispatch.
- Mutation: POST `/chat4/batch_prompt_retry/:id`, shared session CSRF and origin
  checks; GET cannot retry. Private/no-store responses.
- Bounds: prompt ID format/length, allowlisted form fields, 1 KiB form parser,
  ten retry requests per minute per principal, five retries per prompt. Existing
  batch model eligibility and scheduler remain in effect.
- Rendering: escaped Pug, Graphite theme tokens, no new upload/file delivery.
  New retained-failure rows and local outcome counts require the management
  capability. The rest of the dashboard's legacy access policy is not rebuilt here.
- Outbound service: the existing configured OpenAI batch integration only.
- Logs: fixed reasons/statuses/allowlisted codes and opaque IDs; no provider
  bodies, prompts, owner capabilities, or credentials.
- Retention: failures and last-failure metadata remain with the existing prompt
  record until explicit deletion; successful metadata remains for reconciliation.
  No backfill, destructive migration, new secret, or environment variable.
- Negative tests: missing authentication/capability, family/user defaults,
  invalid CSRF/origin, GET, forged principal fields, malformed IDs, cross-batch
  provider rows, duplicate completion, revoked delayed authority, and inert
  rendering. Explicitly granted management access is also covered.

## Production verification still needed

1. Correlate the reported TARIC operation/session with Gateway records. Inspect
   current hold state and use the existing owned recovery procedure in
   [the runbook](taric-runbook.md). Never clear the hold from a passive idle
   snapshot or infer verified reclaim from HTTP 200. This patch does not clear it.
2. Check Windows update/restart and Docker startup records for October 29
   03:44–06:36 JST. Validate MongoDB readiness before interactive login after a
   controlled reboot, then check public routing independently. Preserve the
   existing database incident/emergency notification behavior.
3. After deployment, inspect both JMA warning-feed diagnostics, pending counts,
   and stored v3 classifications. A feed recovery notice is not all-clear proof.
4. Correlate Gateway connection refusals and model-specific 502/503 failures with
   the listener/container/worker lifecycle. Verify each affected model separately.
5. Compare one affected AmiAmi code with a known-good code using the existing
   request contract. Only add provider-code classifications after establishing
   their documented meaning. Do not blindly retry deterministic 400 responses.

Local verification uses mocks, synthetic fixtures and loopback HTTP. The
application and its prestart/database/background-service lifecycle are not used
as a smoke test. No dependency or curated OpenAPI YAML change is required.

## Verification results

Using the pinned Node 26.13.0:

- Focused verification: **16 suites / 373 tests passed**, including database,
  TTS and AmiAmi regression coverage as well as the changed behavior.
- Full suite with coverage:
  `volta run --node 26.13.0 npm test -- --maxWorkers=2 --workerIdleMemoryLimit=512MB`.
  **454 suites passed, one failed, 17 skipped; 6,729 tests passed, one failed,
  261 skipped**. Configured coverage thresholds passed (71.75% statements,
  50.34% branches, 80.79% functions, 72.61% lines).
- The remaining failure is `tests/unit/conversationService.test.js:543`: an
  unrelated concurrent edit changes the legacy default to `gpt-6-luna`, while
  the test expects `gpt-4.1-2025-04-14`. That edit and its test were left intact.
- The first single-process full run exhausted the default Node heap. The
  bounded-worker run above completed; this did not require repository test
  configuration changes.
- Pug rendering, CSRF/capability/validation routes, and `git diff --check` passed.
  No live production, full-app browser, Windows reboot, or GPU test was performed.

Unrelated concurrent model-default edits in the product-details controller,
receipt controller, conversation service, and Chat5 socket handler were preserved.
