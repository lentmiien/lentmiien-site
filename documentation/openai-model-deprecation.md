# OpenAI model deprecation checks

All model-bearing OpenAI submissions use `utils/openaiModelDeprecation.js` before
calling the provider. This includes Responses, legacy chat helpers, embeddings,
speech, transcription, moderation, image generation/editing, video, direct OCR
and product-summary callers, and batch input/submission.

The guard reads current model cards matching `provider: OpenAI` and the exact
`api_model` identifier on every submission. It does not cache eligibility. Keep
cards for retired models so saved conversations and queued work still encounter
their deprecation dates. A missing card remains callable for compatibility, but
logs a warning asking for a card to be added. A card with no `deprecation_date`
has no scheduled retirement.

- A deprecation date within the next **three calendar months**, inclusive, logs
  `warning` and allows the request. Month-end horizons are clamped to the last
  day of the target month.
- On the deprecation date and afterward, the guard logs `error` and prevents
  submission. Dates use the application's local calendar day, with model-card
  dates interpreted as date-only values.
- Invalid card dates and model-card lookup failures block submission with an
  error, rather than bypassing the check. Database queries have a five-second
  server-side time limit.
- Duplicate cards use the earliest declared deprecation date.

Logs use category `openai_model_deprecation` and include the model, operation,
and applicable deprecation date. They omit prompts, files, user identities,
credentials, and database exception details. Upcoming-date warnings are emitted
at most once per model/date per 24 hours per process; missing-card warnings use
the same interval. Warning history is bounded to 512 entries, so restarts or
eviction can cause an earlier repeat. Blocked attempts always log an error.

Checks preserve each caller's existing error contract (returning `null` or
throwing). They do not silently replace an explicitly selected retired model.
Retrieving existing responses, downloading files/videos, polling job status,
listing models, and deleting files remain available. OpenAI administrative usage
collection is unchanged.

Batch input is checked before upload. Chat5 also checks fresh cards before
uploading queued work and again before starting a batch. A deprecated model's
queued prompts are retained as failures with reason `model_deprecated` for
explicit management/retry. Temporary lookup failures leave the work queued.
`startBatchJob` now requires its input model alongside the file ID. The legacy
`start_batch` helper reads the input file's model identifiers before submission.
These checks cannot stop work already accepted or queued by the provider.

The legacy batch alias `gpt-4.1` now targets `gpt-6-luna` when there is no exact
alias card, preserving existing alias resolution. Tests and runnable examples
use the replacement. Stored model cards, app settings, and conversations are not
migrated by this code change; update those through their existing management
flows. Historical incident reports retain their original model references.

## Security scope

This is an internal guard on existing logged-in features and their background
jobs, with no new routes, principals, capabilities, object access, browser
mutations, or outbound hosts. Existing caller authorization and object scopes
remain in force. The guard reads admin-managed model metadata and logs only
operational identifiers. Negative tests cover expired dates, lookup failures,
invalid model identifiers, mixed-model batches, and suppressed SDK submissions.

## Verification

Run the focused tests with:

```sh
npm test -- tests/unit/openaiModelDeprecation.test.js tests/unit/openaiSharedKey.test.js tests/unit/openaiApiConversion.test.js tests/unit/batchService.test.js tests/unit/gptImageGeneration.test.js tests/unit/receiptController.test.js tests/unit/conversationService.test.js --coverage=false
```
