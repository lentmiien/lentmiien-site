# Production log follow-up, 2026-11-09

Workflow: `90e4172a-daad-4b4f-9b02-1397e073ff1b`.

## Verification and scope

The current code confirms unbounded completed-batch finalization retries (F1),
chat prompts linked only after generation (F5), missing feed/cache diagnostics
(F4), and missing connectivity recovery transitions (F8). These need code fixes.
No production records, private logs, credentials or remote hosts were inspected.

Gateway monitoring already logs full recovery only after complete healthy
observations; embedding retries retain work (F2). Codex's `needs_review` state
requires actual process-tree termination proof on Windows/remote targets (F3).
Keep those safeguards. Follow `durable-local-ai.md` for operator reconciliation;
a reservation release alone is not proof. TARIC's JAN ambiguity, local evidence
and catalog allowlist checks are intentional (F7); supply exact item codes and
verified catalog/evidence data rather than relaxing them.

AmiAmi HTTP 400s do not establish a request-contract defect (F6). The current
scraper already distinguishes HTTP rejection, challenge, invalid JSON and API
failure, and the importer supports explicit placeholder retries. The fallback
path was passing an Error to the logger, losing its structured safe headers,
attempt count and elapsed time. It now passes the existing sanitized diagnostic
and stores only its safe message. Fetch behavior, retry limits, error placeholders
and import accounting are unchanged. The fallback and job warnings refer to one
item failure at different layers; do not add them as independent failures.

Selectable GPT Image models are declared in code, but deprecation cards are
database configuration (F9). The new audit checks every selectable model at
database-ready startup and through a standalone read-only deployment command.
It reports missing/duplicate cards, incompatible modalities, invalid dates and
already deprecated selectable models. It does not fabricate cards, prices or
limits, alter model selection, or weaken the request-time deprecation guard.
The [official GPT Image 2.6 Sunburst page](https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst)
confirms the identifier and modalities, but does not provide all the pricing and
token-limit fields required by this repository's card schema. The production
card's current contents and missing-field resolution remain unverified.

## Security contract: completed-batch recovery

This extends the existing logged-in batch management operation. Interactive
principals require `batch.prompts.manage` (admin bundle by default; explicit
grants supported); family/user receive no default grant. Scope is explicitly
admin-managed across batches. Private prompts/results remain private. Signed
provider webhooks and the internal scheduler can finalize existing completed
requests; neither can bypass retry eligibility or release an active lease.

The browser retry is POST with the shared session CSRF guard, existing per-user
rate limit, 1 KiB form limit and an allowlisted batch ID. It accepts no owner,
provider credentials, file IDs or state from the client. It only reopens a
reviewed finalization; it does not resubmit prompts or mark them successful.
The UI escapes diagnostics and uses the existing shared theme. Responses are
private/no-store. Outbound calls use the existing configured OpenAI client.
Retry state survives restarts, automatic attempts and each scan are bounded,
and existing token leases/deterministic output IDs remain authoritative. Logs
contain IDs, counts, dates and safe failure metadata, never provider bodies.
No data deletion or migration is required; absent fields on legacy records are
eligible for the first attempt. Tests cover capability, CSRF, input, concurrency,
restart, unavailable files and preservation of prompts/results.

## Changed behavior and deployment

- **F1:** Each minute, the existing database-dependent batch scheduler scans up to
  25 due completed requests. Retry waits are 15, 30, 60, 120 and 240 minutes; no
  more than six automatic processing attempts run before `needs_review`.
  Interrupted claims count toward the limit. Provider status remains `completed`
  until local finalization succeeds; prompts, outcomes and files are preserved.
  Token leases prevent simultaneous claims; results still use deterministic IDs.
  Managers can see older unresolved completions on Batch Status and use **Retry
  import after review** once file availability/project access is established.
  This reopens import, not provider generation. Persisted retry fields need no
  backfill. Review the two reported batch IDs and their prompt outcomes before
  any manual data correction; this patch does not resolve provider-side 404s.
- **F4:** Existing warning/recovery logs include retrieval time, feed and newest
  entry timestamps, HTTP Date/Last-Modified/Age and recognized cache directives.
  Raw headers, URLs, opaque tags and XML bodies are omitted. A fresh HTTP response
  never overrides stale content. The 45/105-minute thresholds remain intact.
  [JMA's published minute/hour feed cycles](https://xml.kishou.go.jp/xmlpull.html)
  do not establish the cause of the historical stale timestamps. Compare the new
  observations before changing freshness policy.
- **F5:** Local-model image validation uses selected history and the proposed
  prompt before saving new messages; submission rechecks it. Prompt association
  is saved before generation. If generation fails, the requester sees the saved
  prompt and can retry just the response. Validation returns a specific code;
  the browser keeps rejected drafts and does not erase newer edits while waiting.
- **F8:** Sustained degradation logs include effective thresholds and
  `degradedSince`. A continuous healthy observation after a sustained incident
  logs the observed recovery time/duration once per recovered probe. Gaps,
  configuration changes and missing observations do not establish recovery.
  Notification cooldown and latency thresholds are unchanged.
- **F9:** On a configured deployment, run
  `node --env-file=.env scripts/check-gpt-image-model-cards.js` with the pinned
  Node version. It has bounded database reads, disables automatic collection and
  index creation, makes no provider calls, and exits nonzero on gaps or database
  failure. Review/fill cards through the existing capability/CSRF-protected
  `/chat5/ai_model_cards` page using verified provider/account information. The
  audit is an internal diagnostic, with no new network endpoint or credential.

## Remaining production verification

Gateway/host persistence diagnostics and per-service health checks (embeddings,
Qwen3 and openaudio) require the affected deployment. Current Site code already
has conservative recovery reporting; a successful embedding does not certify
other services. Codex operator reconciliation requires proven coordinator,
agent and descendant termination. Neither was simulated or cleared here.

Retry the affected AmiAmi placeholders through the existing explicit retry flow
after comparing exact item codes with a known-good item; retain only the safe
diagnostic. Review TARIC evidence/catalog data separately. No live imports,
provider generation, production database changes or application startup were run.

## Validation

Validation uses Volta's repository pin, Node 26.13.0; the shell's default Node
24.22.1 was not used. Focused checks cover batch retry authorization/CSRF,
404/backoff/restart/concurrency, chat validation/persistence/reload/client drafts,
feed freshness/cache redaction, connectivity recovery/gaps, AmiAmi diagnostics
and selectable-model card coverage. `volta run npm test` passed all configured
coverage thresholds: **468 suites and 7,018 tests passed; 17 suites and 261 tests
skipped**. The final focused batch/socket checks also passed (43 tests).
Disposable Mongo/Gateway integration suites remain gated when their fixtures
are not configured; unit success does not verify production recovery.
