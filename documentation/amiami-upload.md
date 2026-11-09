# Browser-supplied AmiAmi list import

## Usage and behavior

Open **Administration → AmiAmi items → Import item list**, or visit
`/admin/amiami-items/upload`. In your browser, copy the New Products page HTML
(e.g. the body/container's outer HTML in developer tools), then paste it into the
form. Alternatively, upload a saved `.html` or `.htm` file. Copy HTML containing
links, not just the visible product names. No particular wrapper is required.

For a prepared list, select **Item codes (one per line)**, then upload a UTF-8
`.txt` file or paste the codes. Do not include a header, links or delimiters:

```text
TOY-RBT-9417
FIGURE-123
```

Blank lines and surrounding whitespace are ignored; duplicate codes are removed
in first-seen order. Windows, Unix and classic Mac line endings are supported.
An invalid nonempty row rejects the whole submission and reports its line number
without echoing its contents. Correct it before submitting again. Codes use the
same validation as HTML links: at most 80 ASCII letters/digits/hyphens, including
at least one letter, digit and hyphen. Input is not automatically case-converted.
HTML remains the default input format for compatibility.

Both formats remove a trailing `-Rxxx`, `-Sxxx` or `-Dxxx`, where `xxx` is exactly
three digits, before catalog lookup. Only the final suffix is removed; letter
case is preserved. For example, `FIGURE-123-R001` and `FIGURE-123-D002` both become
`FIGURE-123` and share one lookup. Both submitted and normalized codes must pass
validation. The 1,000-code input limit applies before normalization.

Because `-Sxxx` can identify a clothing size, the job retains each distinct original
S code. If its base lookup fails (including an existing error record), those
original codes replace the unsuccessful base entry at the end of the queue, with
one attempt each and the same 60-second pacing. They are used intact and never
normalized again. A rate limit defers the attempt; an actual failure does not
queue another retry. R and D originals are never retried. Existing original-size
records follow the usual skip/retry-placeholder policy. A successful base lookup
needs no size fallback. Progress counts normalized items initially and expands
when multiple size codes replace one failed base; a base failure awaiting size
fallback is not counted as a final failed item. The base's error placeholder stays
in the catalog even if the original-size fallback succeeds.

The server extracts unique `gcode` values from AmiAmi `/eng/detail` anchors or
the plain-text list, filters codes already in `amiamiitems`, and queues the rest.
Existing error or pending records also count as existing by default. Skipped error
records are reported separately and are not presented as complete. The existing
missing-item fallback checks existence again immediately before fetching;
it performs one detail request and inserts either a fetched record or its
usual failed placeholder. Failed items do not block subsequent queued codes.
A temporary fallback rate limit keeps the same code queued for a later attempt.

For controlled recovery, check representative failed codes on AmiAmi, then enable
**Retry empty records from failed lookups in this list** when uploading that list.
Only `source: amiami-api-lookup`, `detailStatus: error`, `details: null` records
are eligible. Each gets one attempt through the same bounded fetch budget and
60-second pacing. Ordinary API lookups do not opt in. Successful recovery preserves
the original first-seen time; a conditional update cannot overwrite another
writer's fetched record or newer failure. An unsuccessful retry remains an error
placeholder. Re-uploading with the option is an explicit new attempt, not an
automatic retry loop. HTTP 400 alone does not establish an invalid item code or a
changed upstream contract; the API request contract is unchanged by this repair.

One shared import queue runs across users/tabs/web processes. The upload form stays
available while it runs: **Add to queue** appends missing items to the end, including
while an item is being fetched. Codes already tracked by the queue are deduplicated;
new S variants of a pending base are retained for its possible fallback. The first
submission of a queued code retains its submitter and retry setting. Each later
submission's retry checkbox applies only to its newly added codes or size fallbacks.
Concurrent submissions and worker progress are merged using a queue version check.
Appending preserves progress, the current request, pacing and the original 24-hour
job deadline. Up to 1,000 pending items are allowed, reserving room for possible
size fallbacks; when full, wait for items to finish before adding more. Processed
queue entries are discarded on append to keep storage bounded while retaining counts.

Closing the page does not cancel the queue. Return to the same URL to see counts,
the current code, timing and up to ten failed codes. The page polls every five
seconds without clearing partially entered input. Completed/stopped jobs remain
visible alongside the upload form until another upload starts a new job.
There is a fixed minimum 60-second pause **after** each attempt finishes, including
failures; the next import honors any remaining pause from the previous job.

Progress and waits survive application restarts. If the worker was interrupted
mid-item, the job stops after its five-minute claim expires. Re-upload the same
list to continue with codes that still have no database record. Jobs also stop
when their 24-hour authority expires, an item's submitter is deleted/loses import
permission, or a storage/worker operation fails. Background authority is checked
against that item's submitting user and current semantic capability before each
item, including size fallbacks added by a different operator.

## Deployment and verification

Deploy the updated application and reload its web processes normally. The new
`amiamiuploadjobs` MongoDB collection uses one document and its built-in `_id`
unique index; no data migration, new dependency, installer step, or environment
variable is required. The worker starts only after database readiness and stops
scheduling when the database becomes unavailable. No scraper command is needed.
The existing CLI and its list-fetch behavior are unchanged.

Offline tests:

```sh
npm test -- tests/unit/amiamiUploadParser.test.js tests/unit/amiamiUploadService.test.js tests/unit/amiamiUploadRoute.test.js tests/unit/amiamiUploadUi.test.js tests/unit/amiamiItemFallbackService.test.js --coverage=false --runInBand
```

These tests use mocked storage/upstream calls and loopback-only HTTP for route
checks. They cover concurrent append/completion, queue bounds, per-item authority,
admission/pacing/recovery, parser fragments, plain-text lists,
malicious input, capability/CSRF denial, upload bounds and page behavior. An authorized
live upload will fetch items and write catalog/job records; it is not a read-only
smoke test. Operational errors use the `amiami-upload` log category; existing
fallback errors retain `amiami-items-api`.

## Security contract

- Feature/zone: logged-in HTML/item-code list import at `/admin/amiami-items/upload`.
- Principals: authenticated users with `amiami.items.import`; admin bundle grants it,
  family/user bundles do not. Explicit capability grants may authorize other users.
  No machine principal or public submission endpoint.
- Object scope: explicitly admin-managed shared AmiAmi catalog and one global import
  slot. Capability holders may inspect shared jobs, append to active jobs, or replace
  completed jobs from any operator. Active jobs cannot be replaced. Each queued
  code/fallback's submitter identity comes only from the validated session.
- Data: public product codes, private job metadata. Uploaded text can contain private
  browser content: parse in memory, never store, render, execute or log it. Retain
  only codes (including bounded original S-code fallback mappings), counts,
  timestamps, per-code submitter IDs/retry settings and up to ten safe error samples
  in MongoDB. Completed queue metadata is cleared; the next upload after completion
  replaces the job. Active uploads append; no job history or files are retained.
- Mutations: POST with shared session CSRF header checked before multipart allocation.
  No GET writes. Strict same-origin CSP, no analytics, private/no-store responses.
  The optional `retryFailed` boolean is limited to this authorized import operation,
  persisted per newly queued item/fallback, and subject to the same per-item
  capability recheck. Existing jobs without per-code metadata use their original
  creator and retry setting until drained.
  No new role, endpoint, automatic recovery process or catalog-deletion step is added.
- Limits: 2 MiB UTF-8 text, one file or pasted text, at most 1,000 distinct valid
  item codes per submission, five submissions/minute/principal, 120 status/page reads per minute.
  HTML mode accepts only AmiAmi HTTPS `/eng/detail` links or root-relative equivalents,
  ignoring scripts, comments and invalid links. Code-list mode accepts one validated
  code per nonempty line, no header, and rejects the whole input on any invalid row.
  Both modes deduplicate and share the same global job slot and work limits.
  Normalized base codes are deduplicated before catalog lookup; at most 1,000
  original S codes are retained for one fallback attempt each. Appends reserve room
  for possible size expansion, keeping at most 1,000 pending entries and bounded
  per-code metadata. Total detail attempts are bounded by 2,000 per submission,
  the 60-second global pacing and the original 24-hour deadline. Append never
  extends delegated authority; an expired active job rejects additions.
  No uploaded URL is fetched. Files must be `.html`/`.htm` or `.txt` for the selected
  format; the server validates text content regardless of client MIME type.
- Background authority: fresh item-submitter capability check before each item, with a
  24-hour job deadline. Closing a tab or logging out does not cancel delegated work;
  deleting an item's submitter or revoking their capability stops work before
  that item is fetched. Other submitters do not inherit the original creator's authority.
- Outbound: existing missing-item fallback only, fixed AmiAmi item API, one attempt
  per missing normalized code and, on base failure, one per original S code,
  existing 30-second request timeout and per-process budget.
  Pause at least 60 seconds after each attempt, including failures/rate limiting.
- Concurrency/recovery: singleton MongoDB slot and atomic per-item claim across web
  processes. Persist delay/progress and use atomic queue-version comparisons for
  appends and worker completion, retrying only storage updates on contention.
  A crashed in-flight claim expires after five
  minutes and fails the job conservatively rather than replaying uncertain work.
  Waiting jobs resume after restart/database recovery. Existing records are not
  refreshed unless the submitting operator explicitly opts into eligible failed-placeholder recovery.
- Logs: shared logger for upload/worker/storage failures, using stable messages,
  job IDs, validated codes and safe reason codes; no uploaded text, credentials or raw errors.
- Negative tests: auth/capability/CSRF denial, bad origin, input size/count/type,
  malicious links/HTML, duplicate/concurrent appends, append versus completion,
  queue capacity including size expansion, concurrent workers, stale claims,
  capability revocation, pacing, existing records and storage failures.
- Legacy dependency: reuse `attemptMissingItemScrape`, including its existing
  failed-record insertion behavior. No scraper CLI changes, protection bypass,
  role migration, external resources or new dependencies.
