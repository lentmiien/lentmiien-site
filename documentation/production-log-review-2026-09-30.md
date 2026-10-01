# Production log review follow-up — 2026-09-30

Workflow reference: `2c146a64-762a-48da-8d79-d632154dd3e9`.

The supplied report was checked against clean checkout `7863844` before changing each affected path. The Windows events, production counts and provider-account state are supplied evidence; they were not independently reproduced in this Linux workspace. No production credentials, database records, Windows services or application startup/prestart were used.

## Decisions

| Finding | Current-code verification and disposition |
| --- | --- |
| A: Cloudflared loop and exposed token | No native Windows service definition is maintained here. Express redaction cannot repair Windows Event Log credential exposure. Follow the existing [host investigation and rotation procedure](production-log-review-2026-09-10.md#cloudflared-investigation-and-token-rotation) on Windows, establish which connector is intended, and verify sanitized events and public access afterward. No service was stopped and no token was rotated here. |
| B: September 24 database outage | The owner identifies an expected Windows Update restart. `app.js` still registers health/readiness checks before database-dependent traffic. Preserve readiness, retry, claim and recovery behavior; no availability change. |
| C: Saved-image embeddings | Confirmed inline standard/HQ requests in `persistGoodImagesFromJob`, with no durable retry. Saving now records pending source states and enqueues work through `EmbeddingQueueService`. The worker supports `good_images`, independent outcomes, legacy recovery, GPU deferral and existing retry/lease/vector-persistence safeguards. |
| D: Quick Settings | Reproduced the line-81 Pug exception with a synthetic catalog. Shared navigation locals shadowed page locals. Navigation locals are now prefixed; synthetic empty/populated renders and an isolated authenticated-controller GET verify the fix. HTTP failures now log registered route patterns and project-relative source locations without URL values, query strings, source excerpts or error messages. |
| E: Preview streams | Confirmed the input browser uses original files and the proxy preserves ranges. The available site/Gateway contract has no thumbnail endpoint. Large-file contention is plausible but is not proof of the upstream socket closure's cause. Added opaque request IDs and failure byte counts, and cleared original media/range headers when an error occurs before response bytes. No stream replay. Thumbnail delivery remains separate work, described below. |
| F: TARIC evidence/catalog rejections | Current evidence resolution still rejects missing JAN evidence before inference, and output validation still enforces the chosen catalog. Expected test-model limitations; no inference or evidence policy change. |
| G: AmiAmi upstream restrictions | Current scraper classifies challenges and ordinary 400 responses as non-retryable. The manual upload route exists. Preserve the owner's workaround; no bypass or retry loop added. |
| H: OpenWeather 401 | Current code already uses the standard forecast/current endpoints, reports sanitized status/operation diagnostics on every failure, retains Open-Meteo JMA forecasts, and derives observations when current weather fails. Added a combined-401 regression test. Production key activation/account access must be checked on the configured host; no credential replacement or provider-policy change was inferred. Repeated fallback is already visible in the per-refresh warnings and stored snapshot source. |
| TARIC cleanup warnings | Confirmed verified reclamation was logged at warning level. Verified success now logs at debug; pending, uncertain and failed cleanup retain warnings. Admission, release and reclamation decisions are unchanged. |
| Other reported noise | No change to recovering Runpod observers, expected reservation pauses, startup/retention notifications or successful AI recovery. |

## Saved-image recovery and deployment

- `embedding_status`/`embedding_error` describe standard embeddings. `high_quality_embedding_status`/`high_quality_embedding_error` describe HQ embeddings; `high_quality_embedding` becomes true after HQ persistence succeeds. “Good” images request standard embeddings; “great” images request both.
- New sources carry `embedding_queue_version: 1`. Pending states are saved before enqueue, so an enqueue failure or process exit is repaired by source reconciliation. Queue rows contain source metadata and a desired-content hash, not another copy of the prompt.
- On the first reconciliation after deployment, legacy sources with no queue version and `embedding_status` of `failed` or `pending` are upgraded in bounded batches. Existing standard/HQ vectors are recognized independently; missing work is queued without copying images or creating new `GoodImage` records. Completed legacy records are left alone, including vectors intentionally removed by retention. Empty prompts become terminal failures with an actionable warning. New terminal failures are not endlessly requeued by the legacy upgrade.
- This automatically includes the report's 15 records if they still meet those conditions. Their production recovery has **not** been executed or counted here. Verify counts by mode after deployment; do not report all 15 repaired until the production vectors and statuses confirm it.
- The worker checks `/gpu/reservation` at `AI_GATEWAY_BASE_URL` and `/containers` at `COMFY_API_BASE` (falling back to the queue Gateway URL). Container inspection uses the existing `LLM_ADMIN_TOKEN` when configured. It waits while ComfyUI is running, even with no active reservation and no generation in progress. It does not stop ComfyUI, release another workload's reservation or load a model to probe availability.
- Unknown, malformed, oversized or unavailable state responses defer embedding work and emit a warning on transition. Check the existing Gateway admin credential and returned ComfyUI container identity if this warning persists. The availability checks use `EMBED_QUEUE_RESERVATION_TIMEOUT_MS`; state bodies are capped at 256 KiB and redirects are rejected.
- `EMBED_QUEUE_ENABLED=false` still disables the worker. Otherwise the existing 15-second polling and five-minute source reconciliation defaults apply, with up to `EMBED_QUEUE_SOURCE_RECONCILE_BATCH_SIZE` legacy/pending images per pass. The existing worker-only request deadline, backoff, atomic claims and expired-lease recovery apply to images.
- The schema adds independent HQ outcome fields, an upgrade marker and reconciliation indexes. There is no destructive migration. Before rolling back to code without `good_images` queue support, pause the worker to avoid the old resolver rejecting those intents.

These are maintenance changes to the existing image-save operation, internal worker and proxy. They add no browser route, principal, capability, external mutation, media-storage location or wider access to existing records. Source content is re-read before and after inference. New production diagnostics exclude prompts, input filenames, query values, provider bodies and credentials.

## Separate thumbnail project

Add a bounded thumbnail endpoint/cache in the Gateway beside its persistent ComfyUI input storage, then have the site's input cards request thumbnails while full-size open/download and audio/video range requests retain their existing behavior. Define supported still-image/animated formats, size/quality limits, invalidation on overwrite, concurrency, private delivery and cancellation together.

Resizing only in Express still transfers the original through the connection currently failing. Browser lazy loading already exists, so adding that again does not address the reported transfers. Gateway-side thumbnail generation is the useful next project; the source of `UND_ERR_SOCKET` still needs Gateway/network correlation.

Each input preview now sends a generated `X-Request-Id` to the Gateway and returns it to the browser. Error metadata retains that `proxyRequestId`, any upstream request ID, transferred/expected byte counts, whether headers were sent, and `completed: false`. Gateway operators must retain/forward the incoming header for end-to-end correlation; the site cannot configure upstream logging. Successful transfers and browser cancellation do not add production error noise.

## Verification

Focused automated checks cover saved-image enqueue loss, standard/HQ partial success, transient/permanent failure, restart reconciliation, legacy upgrades, source deletion during inference, expired claim eligibility, GPU reservation/container admission, sanitized diagnostics, empty/populated Quick Settings catalogs, HTTP rendering, normal/slow/ranged/interrupted previews, browser cancellation, idle timeouts, TARIC cleanup severity and simultaneous OpenWeather 401 fallback. Existing vector-persistence tests cover replacement and incomplete-write cleanup.

Final verification on pinned Node **24.20.0**:

- `volta run --node 24.20.0 npm test -- --runInBand --coverageReporters=text-summary`: **344 suites / 4,184 tests passed**; six suites / 103 tests skipped. All configured coverage thresholds passed (statements 71.78%, branches 50%, functions 80.79%, lines 72.64%).
- The focused regression suites passed, including the final unnamed-error regression. Syntax checks passed for all 16 changed/new JavaScript files; `git diff --check` passed.
- The initial synthetic Quick Settings render reproduced the original exception before the navigation-local change. The final tests exercise real Pug rendering and an isolated HTTP server with synthetic user/catalog data; no full application process or browser session was started.

No production deployment, service restart, live GPU request, credential check or production backfill is claimed.
