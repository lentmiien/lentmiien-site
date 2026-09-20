# Production log review follow-up — 2026-09-20

Workflow reference: `f236f5af-f8cb-4900-9a16-42d652cb7053`.

This review checked the supplied report against the development checkout. It did not query production MongoDB, modify production records, restart services, or exercise paid/provider workloads.

| Finding | Current-code verification and disposition |
| --- | --- |
| Windows-update MongoDB outage | Expected host dependency interruption per the owner. No database lifecycle, readiness, incident spool, or alert changes. |
| Chat5 completion race | Confirmed: messages and follow-up requests were saved before a stale conversation array was saved. Completion now attaches messages with guarded atomic edits before tools run, preserves concurrent additions, and increments the conversation version. Cleanup marks its durable state before removing the original placeholder. |
| Processing overlap | Confirmed: the general processing claim did not renew during tools; human-response wake-up also cleared an active claim. Claims now have owner tokens, renew once per minute, and fence stale workers. Human wake-up preserves ownership. Codex's existing durable session/turn replay remains supported. |
| Duplicate completion/follow-up work | OpenAI output persistence now reuses provider output indexes as the Ollama path already did. New output documents have deterministic IDs. Follow-up submission intent, receipt, and child ID are persisted on the parent. A child waits until attachment and the parent's receipt are durable. Retrying a queued parent cannot recreate a finished child. |
| Expired human requests | Expiry is intentional. Completion removes the expired human tool call from conversation history and omits its timeout output. An expired-only batch does not submit a follow-up. A detached call record marks expiry for replay; the human-request record keeps its existing retention/audit behavior. Other completed tool results in a mixed batch can still continue. |
| TARIC | Current transport already has its private pools and 60-second generation deadline. Per the owner, transport, catalog/release gates, cleanup behavior and logging remain unchanged pending the next scheduled review. |
| Gateway embedding failures | Durable backoff and vector upsert behavior already existed and remain. Queue warnings now retain bounded error/cause codes, including aggregate network errors, without serializing cause messages or provider payloads. Recovered jobs log their opaque job IDs and attempt counts; recovery batches report completed/retried/recovered/failed counts. These batch counts are not a claim that the entire backlog drained. |
| Missing embedding attachment | Completion attaches outputs before long tools. Source reconciliation waits when a persisted response is still pending, waiting for a human, or blocked for inspection. Retrying completion requeues attached text through the existing embedding service. Intentional “remove last response” records a deletion intent only after the last conversation reference is gone; queued jobs respect that marker. No historical orphan is automatically reattached. |
| Qwen warning duplication | Confirmed four reporting layers. Dashboard failures now produce one service summary with failed endpoints and status/codes. Standalone request failures still warn. No timeout increase or unsupported upstream cache assumption was introduced. |
| Revision attribution | Git detection already existed but depended on a successful subprocess. The logger now accepts a validated full `APP_REVISION` commit SHA and falls back to reading loose/packed Git refs, including worktrees, when Git cannot run. |
| Connectivity diagnostics | Existing warning throttling remains. Warnings now carry bounded, allowlisted probe outcomes, codes, phases, HTTP status and timings so evidence survives database unavailability. No addresses, URLs, response bodies or arbitrary probe properties are included. |

## Recovery boundary

A database transaction cannot make an arbitrary external action execute exactly once. For tools without an existing durable invocation key, completion records that execution started before calling the handler. A persisted output is always reused. If a process stops after dispatch but before the output is saved, recovery sets the parent to `blocked`, leaves its placeholder intact, and logs an actionable `chat5_completion` error instead of repeating the action. The same rule applies to a follow-up submission with no durable provider receipt. Human and Codex tools retain their existing durable resume paths.

Inspect the response ID and the tool/provider's operation history before resolving a blocked record. Confirm whether the action happened and recover its result/receipt where possible. Do not blindly clear the execution or submission marker. There is no new browser recovery endpoint, and no automatic historical data repair.

The new pending-request states are `followup_wait` and `blocked`. No migration or dependency change is required. Older records acquire a token when next claimed. Deploy with a normal application restart so an old worker cannot run alongside the new claim protocol. Preserve these states when rolling back or inspect affected records before reverting their schema support.

## Scope and security

These are maintenance changes to existing logged-in Chat5 and administrator workflows and internal background processing. They add no route, browser mutation, capability, external destination, or new access grant. Existing validated tool principals, selected-tool checks, capability checks, webhook verification, object scope and CSRF boundaries remain. Diagnostic additions contain operation IDs and bounded technical outcomes, not conversation content. Expired requests cannot cause a formerly selected tool to execute during recovery.

## Verification and remaining production checks

Focused tests exercise concurrent conversation additions, a simulated 16-minute tool, repeated callbacks, lost ownership, an injected attachment/version failure, receipt reuse, a finished child on parent retry, uncertain dispatch, persisted OpenAI outputs, human expiry, intentional detachment, delayed attachment, network interruption/retry, warning consolidation, safe connectivity diagnostics, and Git metadata fallbacks.

Final verification: `npm test -- --runInBand` passed 326 suites and 3,834 tests; four suites / 66 tests were skipped. All configured coverage thresholds passed. The final focused completion, embedding and realtime run passed 98 tests. `git diff --check` passed. These are isolated automated checks, not a production interruption test.

The original ten source-document IDs are not included in the supplied report, and development tests cannot determine their production history. During a production reconciliation, compare each logged ID with current conversation references, source intent and queue/vector state; repair only confirmed inconsistencies. Likewise, correlate Gateway service records with the reported outage periods and confirm affected job IDs against the new recovery observations after deployment. TARIC remains for the next scheduled production review.

For a packaged deployment without `.git`, set `APP_REVISION` to the full release commit SHA and update it on each release. A missing revision still reports `null` rather than attributing a deployment to an invented revision.
