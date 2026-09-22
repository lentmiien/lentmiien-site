# AmiAmi scraper diagnostics

`npm run scrape:amiami` selects MongoDB storage. Direct invocation with
`node scripts/scrape-amiami-new-items.js` defaults to JSON file storage. Both
perform live requests and writes; **`--list-only` is not a dry run**. Startup can
install/repair curl-cffi and change its local runtime files.

## Interpreting failures

The reported September 22 failure was an HTTP 403 on the New Products **list**,
so that run never reached item fetching or listing upserts. The captured
`Just a moment...` title strongly suggests a Cloudflare challenge, but the old
error did not capture headers. It cannot establish the exact Cloudflare rule,
rate limiting, an IP block, or an item being removed. The previously saved
518-listing summary (one failed/pending detail) describes an earlier completed
run, not the failed list request.

New request errors contain a stable code, phase (`list`/`detail`), fixed request
target, item code when relevant, HTTP status, actual request attempts, elapsed
milliseconds (including retry waits), and safe response headers. For example,
with the supplied response and no definitive challenge header:

```text
AmiAmi list HTTP 403 (Forbidden) from https://www.amiami.com/files/eng/new_items/newitem.html: Suspected Cloudflare challenge; no definitive cf-mitigated header. List request failed; no item fetching started. Wait and try later, or check AmiAmi manually in a browser. (attempts=1, elapsedMs=1250)
```

The timing above is illustrative. `cf-mitigated: challenge` produces
`AMIAMI_CHALLENGE`; title/challenge markers without that header produce
`AMIAMI_SUSPECTED_CHALLENGE`. An ordinary 403 is `AMIAMI_FORBIDDEN`. A `cf-ray`
value can help correlate a request but does not identify the rule or prove a
challenge. Do not infer item removal from these responses. HTTP 404/410 means
the requested resource is unavailable; even that does not prove permanent
removal. API failures and missing item payloads report availability as unknown.
Timeout, transport, malformed JSON and unrecognized list responses have
separate codes. Bodies and upstream API error text are never copied into these
diagnostics. Original causes remain internal.

Only `content-type` (media type), `cf-mitigated`, `cf-ray`, and `retry-after`
are retained, with bounded, validated values. Cookies, request headers, URL
credentials/query strings, redirect locations, raw driver messages and HTML
are excluded. Invalid or oversized item codes are redacted in diagnostics.
Challenge scanning examines the first 64 KiB; list validation requires familiar
New Products/list markup and rejects explicit error titles. Recognizable empty
lists still succeed. This is a conservative guard, not comprehensive validation
of upstream markup; a page redesign may need a parser update.

## Run summaries and exit behavior

The existing summary path remains `tmp_data/amiami-new-items-summary.json`
(or `--summary-file`). Existing successful-run fields are retained. Added fields
include `runId`, `status` (`success`, `partial`, `failed`), `elapsedMs`, and
`failures` (at most ten sanitized detail failures). All detail failures still
count in `detailResults.failed`. `detailResults.attempted` counts items; each
failure's `attempts` counts actual requests for that item. Individual records
retain the `detailError.message`/`at` shape; no schema migration is needed.

Fatal runs write an explicitly failed summary with `error` and the counts known
so far; an unfetched list has `sourceItemCount: null`. Fatal runs exit 1; partial
detail failures still continue and exit 0. Check `status`, not just the exit
code or historical counts. Storage/normalization failures are fatal and have
separate phases; they are never counted as upstream fetch failures. Earlier
writes can remain when a later operation fails. This corrects the old DB path
that could label a failed successful-detail update as a fetch failure.

Both storage modes report fatal runs through `utils/logger` at `error` and
partial runs at `warning`, category `amiami-scraper`. Metadata includes the run
ID, timestamps, counts and bounded diagnostics. Console output also reports the
outcome. Database disconnect and log writes are awaited; the CLI sets
`process.exitCode` and lets Node drain output instead of forcing `process.exit()`.
A cleanup failure is recorded separately when another fatal error already exists.

Argument and runtime initialization errors also get failed summaries and logs.
If argument parsing fails, the default summary path/storage label is used because
options were not accepted. If summary persistence fails, console/shared logs
report `summaryWritten: false` and `summaryWriteFailure`: the previous file can
still be stale. Check its run ID and timestamps against the log. No summary can
be guaranteed when disk permissions/space prevent writing.

List requests still have no retries. Details retain the configured retry count
(default two retries, three attempts) and fixed delay (default five seconds) for
transport/timeouts, malformed JSON, HTTP 408/429 and 5xx. Challenges, other HTTP
failures (including 403/404/410), and API-level failures do not retry. `retry-after`
is diagnostic only; it does not change scheduling. Subsequent queued items still
run after a detail failure. No user-agent, session or protection-bypass changes
are included.

## Release and safe verification

Deploy the committed revision through the normal checkout/release process. No
new dependencies, environment variables, database migrations or dependency
installation are required by this patch. The next CLI invocation uses the new
code. If the web process uses the shared detail service, reload it through the
normal process manager. `services/amiamiScraperService.js` is included in TARIC's
existing code fingerprint: previous qualification fingerprints change and may require the
existing requalification process. Do not bypass that release gate.

For offline verification, run:

```sh
npm test -- tests/unit/amiamiScraperService.test.js tests/unit/amiamiScraperServiceStartup.test.js tests/unit/amiamiScraperCli.test.js tests/unit/amiamiItemFallbackService.test.js --coverage=false --runInBand
node --check services/amiamiScraperService.js
node --check scripts/scrape-amiami-new-items.js
node --check utils/amiamiDiagnostics.js
```

These tests mock scraper HTTP, installation, filesystem writes and database
operations. They do not require production credentials. Do not run the scraper
as a release smoke test. At the next separately authorized normal run, inspect
its exit code, summary `runId`/`status`/timestamps and matching `amiami-scraper`
log entry; share only the sanitized diagnostics. Waiting and a manual browser
check can help assess upstream availability without attempting to bypass
protection. Live accessibility and the exact upstream rejection cause remain
unverified by offline tests.
