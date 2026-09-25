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

The server extracts unique `gcode` values from AmiAmi `/eng/detail` anchors or
the plain-text list, filters codes already in `amiamiitems`, and queues the rest.
Existing error or pending records also count as existing and are not retried. The existing
missing-item fallback checks existence again immediately before fetching;
it performs one detail request and inserts either a fetched record or its
usual failed placeholder. Failed items do not block subsequent queued codes.
A temporary fallback rate limit keeps the same code queued for a later attempt.

Only one import can be active across users/tabs/web processes. Closing the page
does not cancel it. Return to the same URL to see counts, the current code, timing
and up to ten failed codes. The page polls every five seconds. Completed/stopped
jobs remain visible alongside the upload form until another upload replaces them.
There is a fixed minimum 60-second pause **after** each attempt finishes, including
failures; the next import honors any remaining pause from the previous job.

Progress and waits survive application restarts. If the worker was interrupted
mid-item, the job stops after its five-minute claim expires. Re-upload the same
list to continue with codes that still have no database record. Jobs also stop
when their 24-hour authority expires, the creator is deleted/loses import
permission, or a storage/worker operation fails. Background authority is checked
against the current user record and semantic capability before each item.

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
checks. They cover admission/pacing/recovery, parser fragments, plain-text lists,
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
  slot. Capability holders may inspect/replace completed jobs from any operator;
  active jobs cannot be replaced. Creator identity comes only from the session.
- Data: public product codes, private job metadata. Uploaded text can contain private
  browser content: parse in memory, never store, render, execute or log it. Retain
  only codes, counts, timestamps, creator ID and up to ten safe error samples in
  MongoDB. The next accepted upload replaces the last job; no job history or files.
- Mutations: POST with shared session CSRF header checked before multipart allocation.
  No GET writes. Strict same-origin CSP, no analytics, private/no-store responses.
- Limits: 2 MiB UTF-8 text, one file or pasted text, at most 1,000 distinct valid
  item codes, five submissions/minute/principal, 120 status/page reads per minute.
  HTML mode accepts only AmiAmi HTTPS `/eng/detail` links or root-relative equivalents,
  ignoring scripts, comments and invalid links. Code-list mode accepts one validated
  code per nonempty line, no header, and rejects the whole input on any invalid row.
  Both modes deduplicate and share the same global job slot and work limits.
  No uploaded URL is fetched. Files must be `.html`/`.htm` or `.txt` for the selected
  format; the server validates text content regardless of client MIME type.
- Background authority: fresh creator capability check before each item, with a
  24-hour job deadline. Closing a tab or logging out does not cancel delegated work;
  deleting the creator or revoking capability stops further work.
- Outbound: existing missing-item fallback only, fixed AmiAmi item API, one attempt
  per missing code, existing 30-second request timeout and per-process budget.
  Pause at least 60 seconds after each attempt, including failures/rate limiting.
- Concurrency/recovery: singleton MongoDB slot and atomic per-item claim across web
  processes. Persist delay/progress. A crashed in-flight claim expires after five
  minutes and fails the job conservatively rather than replaying uncertain work.
  Waiting jobs resume after restart/database recovery. Existing records are never
  refreshed, including records whose earlier detail fetch failed.
- Logs: shared logger for upload/worker/storage failures, using stable messages,
  job IDs, validated codes and safe reason codes; no uploaded text, credentials or raw errors.
- Negative tests: auth/capability/CSRF denial, bad origin, input size/count/type,
  malicious links/HTML, duplicate admission, concurrent workers, stale claims,
  capability revocation, pacing, existing records and storage failures.
- Legacy dependency: reuse `attemptMissingItemScrape`, including its existing
  failed-record insertion behavior. No scraper CLI changes, protection bypass,
  role migration, external resources or new dependencies.
