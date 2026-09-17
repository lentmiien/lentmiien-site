# TARIC assisted recommendation pilot

Status: **internal foundation only; no endpoint, live inference, or release** (2026-09-17).
Contract version: `taric-foundation/1`. This is a development schema, not a promise of a deployed API.

## Product boundary and checkpoints

The external application keeps its existing same-JAN automatic reuse and manual TARIC selection workflow. Initially, only items reaching that manual selection call Lentmiien immediately beforehand. The caller supplies JAN and/or AmiAmi item code, descriptive name and the provided HS6 code. Lentmiien resolves factual product evidence, then an explicitly selected backend may suggest a TARIC code and show its provenance. A human always makes the final choice. A lookup failure, timeout, abstention or provider error preserves the normal manual path. No automatic application in v1.

| Checkpoint | Deliverable | Exit gate |
| --- | --- | --- |
| 1. Assisted recommendations and feedback pilot | Scoped private API, factual lookup, approved catalog/version and explicit inference backend, human choice, feedback, inspection, setup and end-to-end validation | Security and failure gates below pass; representative human-assisted pilot is usable, with fallback and rollback demonstrated |
| 2. Measured improvement | Gather data before high automation; frontier-assisted cleanup of authorized Chat5/export and existing mappings; reviewed labels; immutable datasets/templates; existing 4B LoRA/32B QLoRA training wrapper; grouped independent benchmarks; versioned adapters and promotion | Independently verified held-out results show a useful error/coverage/latency tradeoff relative to explicit baselines; candidate canary can be rolled back |
| 3. Selective automation | Only eligible well-measured subsets; audits, risk holds, drift detection, rate/cost caps, rollback to assisted/manual | Predeclared error and coverage thresholds supported by independent evidence; ongoing audit and rollback remain operational |

There is no discovered TARIC adapter or usable catalog configured here. CP1 still needs an initial inference backend. A selected base/frontier baseline is a **separately reviewed configuration choice**, never a silent default. If Lennart chooses a trained model from the start, a small CP2 data/benchmark/training canary may bootstrap CP1. The broader improvement program follows the assisted pilot; it does not wait for high automation. There is no commitment that 99% coverage is attainable.

Pilot feedback is selection-biased: the manual-path subset excludes the external application's unchanged same-JAN auto-matches. Pilot acceptance rates cannot validate those unseen legacy matches, establish overall accuracy, or substitute for independent verification. Mock outputs and passing tests establish software behavior, not classification accuracy.

## Foundation delivered and honest limits

| Module | Implemented | Not implemented |
| --- | --- | --- |
| `utils/taricContracts.js`, `utils/taricRecords.js` | Strict bounded allowlist validation; typed safe errors; versioned hashes; evidence/result/catalog checks; unverified snapshots | HTTP parser/authentication, authoritative catalog acquisition or applicability review |
| `services/taricEvidenceService.js` | Injected direct-model local resolver; bounded Mongo projection and query time; identity checks; deterministic evidence snapshots; injectable successful-fetch allowlist persistence and CAS refresh; winner revalidation | A usable network fetcher, distributed limits, live Mongo verification |
| `models/taric_recommendation.js`, `models/taric_feedback.js` | Schema factories; scoped unique index declarations; bounded validated immutable snapshots; append-only service behavior and common query guards; no TTL | Registration in `database.js`, actual index creation/proof, DB access roles, migrations, retention executor |
| `services/taricRecommendationService.js` | Internal `prepare`, scoped replay/conflict and feedback; disabled readiness; pure explicit config and synthetic result validation boundary | Provider invocation, inference orchestration, queued jobs, route-level authorization, durable endpoint lifecycle |
| `tests/unit/taric*.test.js` | Synthetic identity, source, bounds, persistence/race, idempotency, scope, feedback and disabled-provider tests | Transport tests, real DB concurrency/index tests, production or human classification validation |

`prepare({scope,key,request})` stores either `prepared` (evidence exists, **no suggestion**) or `failed` (safe code and possibly no evidence). A prepared snapshot is immutable and is not subsequently upgraded in place. `readiness()` always returns `{ready:false,code:'PROVIDER_DISABLED',provider:null}`. Even a structurally valid inference configuration does not enable anything. No backend is instantiated/imported, no model is downloaded, no GPU reserved, and no environment configuration is added.

`validateProviderResult` is a pure boundary for future implementations and synthetic tests, not a provider client. No default recommendation, fake baseline, confidence or explanation is generated. The service does not accept caller-supplied name/specification replacements as factual evidence. `scope` is a **trusted server injection** argument, not authentication: exposing it directly to a request would be a security bug.

The future injectable provider should implement `infer(input, controls)`: input contains only the validated factual snapshot/hash, descriptive context and weak HS6; controls contain pinned backend/base/adapter/template/catalog IDs, applicable approved codes, deadline, byte/token caps and an abort signal. It returns the strict output described below or a sanitized typed failure. The application owns configuration, authorization, parsing, catalog checks and persistence. This patch implements the validators for that boundary, not the `infer` method, cancellation or provider invocation.

No existing file/runtime default is changed. New modules are not imported by `app.js`/`database.js`; no routes, UI, scheduler or indexes are mounted/started. The legacy fallback still has its existing failed-row behavior. Legacy callers are not redirected to this implementation.

### Fetch transport prerequisite

Source inspection of installed `curl-cffi` shows `parseResponse` calling `curl.getRespBody()` before exposing `dataRaw`; its request interface does not expose an established streaming response byte budget. `maxSize` is the connection pool size, not body bytes. A post-buffer length check would not meet the preallocation bound. We have therefore **not changed or wrapped the legacy transport** and have not claimed safe transport readiness.

`fetchFactual` defaults to null. Only a separately audited infrastructure dependency may be injected. It takes a validated gcode and returns normalized factual fields, including an exact returned `gcode` (optional `scode` must agree). The factory assumes that dependency itself enforces a fixed `https://api.amiami.com/api/v1.0/item` origin/path, `gcode` and fixed `lang=eng` query, redirects disabled (or host validation at every hop), TLS, bounded headers, status/content-type checks, streamed decoded and wire byte limits, whole-operation deadline and zero retries. It must scrub body snippets, raw exceptions and URLs with secrets from every logging/error path. The resolver validates identity again before persistence.

The resolver does **not** turn an arbitrary supplied fetcher into a safe transport. It has no fake timeout implemented as `Promise.race`, and no after-buffer check advertised as a streaming guarantee. Timeout/oversize/redirect mocked-network tests are deferred with the missing transport. CP1 must implement and test that transport before enabling online fallback. A native streaming client might be sufficient but upstream compatibility has not been exercised; do not silently fall back to legacy curl or HTML scraping when blocked.

## Evidence rules

1. JAN is exactly 8 or 13 ASCII digit **strings**. Preserve leading zeros; no numerical coercion, padding or country-prefix inference. This version checks syntax only, not the check digit. A syntax-valid JAN is not a verified GS1 identifier. Any future checksum policy needs a versioned compatibility decision.
2. `item_code` maps to gcode with the conservative grammar `[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*`, at most 64 characters, preserving case. URLs, slashes, underscores, spaces, query strings and percent encoding are unsupported. Other historical AmiAmi formats require reviewed expansion, not coercion. Unsupported inputs retain the external manual path.
3. JAN-only resolution groups matching DB rows by top-level gcode and reads at most two distinct codes. Two distinct codes are `JAN_AMBIGUOUS`. An explicit item code disambiguates only when its stored JAN agrees exactly. Missing JAN is `IDENTITY_UNVERIFIABLE`, never agreement. No JAN-only online search.
4. Top-level gcode and required listing.gcode must agree. Populated details.gcode and details.scode must agree too. This is deliberately conservative: legitimate differing scode/variant conventions are rejected until separately modeled. Conflicts are not repaired by overwriting evidence. Item-code misses and incomplete/error rows may use the injected fetch path; missing stored JAN may be refreshed, but a known mismatch is rejected.
5. A credible details.itemName is preferred. A real listing.itemName is allowed and explicitly marked `listing_name_fallback`. A string equal to gcode, case-insensitively after trimming, is never a factual name. `detailStatus=fetched` is not sufficient. The caller's descriptive_name is weak context, never a fallback factual name. No call to `/api/productDetails` (generated summaries).
6. Snapshot facts: name, specifications, details, remarks, brand, seriesTitle, characterName, releaseDate. Except name they may be null. Missing specifications/details produce warnings; a real name with other details can still be useful. The downstream model/reviewer must abstain when decisive material, function or composition facts are absent; it must not invent them. This foundation does not decide factual sufficiency for classification.
7. Source text is preserved, including whitespace/HTML as inert strings. Do not render it as HTML or execute embedded instructions. No arbitrary upstream URLs, raw blobs, images or model summaries are persisted. The canonical source URL is built from validated gcode. Source fetched timestamp (details.apiFetchedAt, then detailFetchedAt) is recorded or null; timestamp absence is flagged. Listing observation time is not misrepresented as detail-fetch time. Neither timestamps nor hashes establish truth/freshness.
8. SHA-256 covers canonical sorted-key JSON of the schema version, identities, exact facts, provenance and warnings. It excludes only the hash itself, and does not rely on listingHash. Resolution method, name field, identity agreement and field availability are explicit. Returned JSON is bounded to 64 KiB; name <=1,000 and other fact strings <=12,000 JS code units each. Over-limit facts fail instead of silently truncating. Mongo projections retrieve at most limit+1 code points for string fields, with a two-second per-query maxTimeMS. Metadata/date schema assumptions and aggregation semantics need live sandbox verification before use.
9. The fetch path has process-local limits: two concurrent attempts, twenty per rolling minute, once per gcode per minute, zero internal retries. It can refresh incomplete/legacy failed rows using `_id`, gcode and `updatedAt` CAS. Missing CAS metadata refuses refresh. Only successful validated facts are written; no fake failed rows. A race winner is reread and validated; if its facts differ, its local provenance is returned. A still-invalid winner fails. These are not distributed budgets or an overall request deadline.

## Security contract

This contract fixes the design boundary; outstanding credentials/catalog/provider/retention choices block **activation**, not these dormant helpers. It follows [security-framework.md](security-framework.md).

| Field | Contract |
| --- | --- |
| Zone | Logged-in/private, including the machine API; never secret-public/global API key |
| Interactive principals | Users with explicit semantic capabilities; admin/family/user are bundles, not shortcuts. No default grants added here |
| Machine principals | Dedicated hashed, expiring, independently rotatable/revocable bearer service principal; stable integration principal ID survives credential rotation; fixed server-derived owner ID |
| Data classification | Private requests/evidence/choices; credentials secret; minimize personal data |
| Capabilities | Proposed `taric.recommend`, `taric.feedback.write`, `taric.inspect`, `taric.export`, `taric.delete`; grants reviewed explicitly |
| Object scope | Owner **and** stable integration principal on each record/query/job/feedback. No cross-integration read. Future browser inspector must resolve explicitly authorized integration membership under its owner, not accept arbitrary scope |
| Admin override | None in v1. Future admin-managed review needs an explicit reviewed policy |
| Browser mutations | Non-GET plus shared `middleware/sessionCsrf.js`; reuse `requireCapabilities` and `utils/authorization` for browser capabilities. Machine bearer requests use service authentication, not session cookies/CSRF |
| Abuse limits | Proposed 10 new recommendations/minute/principal, 60 feedback/minute/principal, one active request/principal, two global provider jobs, 20 global AmiAmi fetches/minute; server-wide shared enforcement before multi-process activation. Retries/replays still subject to ingress rate limits |
| Request limits | JSON only, 4 KiB recommendations, 1 KiB feedback; reject unknown fields, duplicate idempotency headers, excess depth/arrays, compressed bodies and unsupported content encodings. One item/request, no batches |
| Output contexts | JSON; future escaped Pug/textContent only; no hidden reasoning, probability claims, raw provider payloads or stack traces |
| Private storage | Private Mongo collections; any later export is authorized attachment outside public paths; no public generated files |
| Outbound | Only audited fixed AmiAmi origin plus a separately selected/versioned inference backend. No model tools, arbitrary URLs, redirects or data forwarding selected by request/model |
| Cache/headers | `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex, nofollow`; JSON content type. No analytics. Disable CDN caching; WAF is supplementary |
| Logging | Shared logger; stable category and allowlisted error code only in foundation, no facts, names, JANs, prompts, response snippets, raw errors or credentials. Future security audit uses opaque IDs/operation/outcome, bounded aggregation for repeated failures |
| Retention/deletion | No TTL or deletion runs in foundation. Activation requires approved retention and deletion/export policy below; no indefinite live collection by accident |
| Negative tests | Capability/revocation/expiry, both scope axes, foreign/missing same 404, parser order/body/header bounds, CSRF browser-only, forged ownership, outbound redirect/size/deadline, invalid model output, failed evidence, replay/conflict and rendering |
| Legacy boundary | Read-only projected AmiAmi lookup, conditional successful factual refresh only; no unscoped product-summary calls, legacy API authentication, model gateway or fallback service reuse |

API router must be mounted **before both the global 5 MB JSON parser and legacy `/api` authentication**. Current authorization helpers use user-role shapes and may return HTML; they are not a service-principal authenticator. Build reviewed shared machine authentication with JSON errors; never route through the legacy global API key. Authentication precedes request work, capability and scope checks precede object reads/writes, and revocation must be rechecked before deferred sensitive work. Reject cookies as an alternative credential for the machine endpoints. Secrets stay in header/secret storage, not generic app settings/model registry.

## Proposed v1 HTTP contract (not mounted)

All identifiers/codes are strings. Unknown fields rejected. IDs are opaque 24-character lowercase hexadecimal strings. Each POST requires exactly one `Idempotency-Key` matching `[A-Za-z0-9_-]{16,128}`; recommendation and feedback use independent keys/namespaces. The client retains a key and exact payload through retries. Reusing a scoped key with different canonical input returns 409. Idempotency lifetime must equal the retained record/key-tombstone lifetime, not a transient process cache.

`POST /api/taric/v1/recommendations`

```json
{"jan":"00123456","item_code":"FIGURE-0001","descriptive_name":"Example figure","input_hs_code":"950300"}
```

`jan` and `item_code` are optional individually; at least one is required and both are allowed only if resolved identity agrees. `descriptive_name` is required, nonblank, <=500 characters. `input_hs_code` is required and exactly six ASCII digits. Empty/missing/short/long/numeric HS input is a 400; the external app keeps manual selection and does not manufacture `000000`, infer HS or pad values to call this pilot. Expanding to optional HS later requires a deliberate contract version. Arbitrary name/specs/catalog/model/owner overrides are not accepted.

Terminal response shape (fields always present, null where unavailable):

```text
{
  schema_version: "taric-foundation/1",
  recommendation_id: string | null,
  state: "suggested" | "abstained" | "failed",
  suggestion: null | {code: ten_digit_string, basis_fields: fact_field[],
    catalog_id: string, catalog_version: string, output_validated: true,
    verification: "unverified", training_approved: false, warnings: warning_code[]},
  evidence: null | {schema_version, gcode, jan, facts, provenance, warnings, hash},
  versions: null | {backend_id, base_model_id, adapter_id: string|null,
    template_id, catalog_id, catalog_version},
  input_hs_is_weak: true,
  manual_selection_required: true,
  error: null | {code: safe_error_code}
}
```

`facts` and provenance have exactly the allowlisted fields described above; factual data is private to the scoped caller. `basis_fields` references present evidence fields and is a model assertion, not independent proof of causation. Provenance identifies the resolution source, missing facts, model/base/adapter/template/catalog versions, syntax/membership validation and warnings. It is JSON-safe audit information, **not chain-of-thought or pretend probabilities**. An HS-prefix mismatch is a warning, never rejection solely due to the provided HS. Ten-digit syntax or allowlist membership is not classification truth or legal applicability.

Provider output for the foundation validator is exactly `{code: ten_digit_string, basis_fields: fact_field[]}` (1–8 unique fields); unknown fields including confidence/reasoning are rejected. Before activation, the provider wrapper must parse bounded JSON exactly once, reject fences/trailing text, and define/test a versioned abstention output (`{abstain:true,reason_code:"insufficient_facts"|"unsupported_item"}` proposed). Abstention parsing is **not implemented** by the foundation result validator. Provider/template IDs come from pinned server configuration, never generated output.

`POST /api/taric/v1/recommendations/:id/feedback`

```json
{"selected_code":"9503000000"}
```

v1 intentionally has no freeform feedback text, client decision, verification flag or extra facts. Response: `{feedback_id, recommendation_id, selected_code, decision, catalog_status, catalog_id, catalog_version, missing_evidence, verification:"unverified", training_approved:false}`. `decision` is derived from saved original suggestion: same code `accepted`, different `changed`, absent suggestion `manual`. `catalog_status` is `unknown` without a configured catalog, `not_approved` for unsupported membership, or `approved_member`; never “verified.” Unsupported but syntactically valid manual selections are retained. Malformed selections fail validation. Accepting/changing a model suggestion does not approve a training label. One final choice per recommendation; correction under another key returns 409 until supersession is implemented explicitly.

| HTTP status | Proposed behavior / safe error codes |
| --- | --- |
| 201 | Newly persisted suggested/abstained outcome or feedback |
| 200 | Replay of a successful terminal record; same ID/content. Failed replays preserve their error status |
| 202 | Only if the later bounded asynchronous lifecycle is implemented: `{recommendation_id,state:"pending",status_url}` and `Retry-After`; status GET is identically scoped |
| 400 / 413 / 415 | Invalid fields/identifiers/idempotency header (`INVALID_REQUEST`, `INVALID_FEEDBACK`); body too large (`BODY_TOO_LARGE`); unsupported media/encoding (`UNSUPPORTED_MEDIA_TYPE`) |
| 401 / 403 | Future shared auth `UNAUTHENTICATED` (missing/invalid/expired/revoked) or `CAPABILITY_DENIED`; internal `INVALID_SCOPE` never exposes arbitrary owners |
| 404 | `NOT_FOUND` for both nonexistent and foreign resources |
| 409 | `IDEMPOTENCY_CONFLICT`, `EVIDENCE_RACE`; safe retry/manual handling |
| 422 | `JAN_AMBIGUOUS`, `EVIDENCE_NOT_FOUND`, `IDENTITY_MISMATCH`, `IDENTITY_UNVERIFIABLE`, `EVIDENCE_INVALID`, `EVIDENCE_INCOMPLETE`, `CATALOG_REJECTED` |
| 429 | `FETCH_LIMITED` or future `RATE_LIMITED`; bounded Retry-After, no unbounded client retries |
| 502 / 503 / 504 | `FETCH_FAILED`, `INVALID_RESULT`, future `PROVIDER_FAILED`; `FETCH_DISABLED`, `PROVIDER_DISABLED`, `CONFIG_NOT_READY`, `STORAGE_FAILED`; future `DEADLINE_EXCEEDED` |

Request validation/auth errors need not create records. Persist a record/ID for accepted requests ending in lookup failure, abstention or provider error when storage works, allowing a manual choice to be reported. Such records explicitly mark missing evidence in feedback and remain training-ineligible. If persistence itself fails, `recommendation_id:null`; external selection still proceeds normally. Do not attach raw errors or turn an evidence failure into a fabricated recommendation. The internal `prepared` state is not a successful public recommendation response.

Do not freeze a synchronous-only HTTP design before measuring cold/warm Qwen latency. Choose either a bounded synchronous pilot within the agreed client deadline or a persisted 202 + scoped polling lifecycle. Proposed starting budget is 10 seconds client wait, <=3 seconds lookup and remaining budget for inference; these are recommendations to measure/confirm, **not active defaults**. Current config validation permits explicitly chosen deadlines up to 60 seconds; that is a ceiling, not a promise of synchronous feasibility. Qwen long startup may require pre-readiness or 202. Client/HTTP cancellation does not prove remote GPU work was cancelled. Account for orphan calls and never automatically retry a possibly-started job without a reviewed policy.

## CP1 implementation work packages, dependencies and acceptance gates

1. **Foundation (complete in this patch).** Freeze/test strict data contracts, projected factual resolver, dormant schemas, scoped internal preparation/feedback and disabled readiness; document prerequisites. Gate: synthetic tests and existing scraper regressions, reviewed diff, no app imports/network/model/DB operations. This gate does not claim CP1 complete.
2. **Confirm pilot setup and pin approved configuration (next).** Choose applicability/jurisdiction/date and catalog source/license/update process; backend/base/adapter (or explicit reviewed baseline); template and output contract; credential owner/integration; measurable deadline/cost caps and retention. Obtain a small authorized representative review set. Gate: manifest with immutable IDs/content digests, applicable approved codes, explicit backend compatibility, privacy/data recipient review, no fake defaults. Depends on 1. Config validation is necessary but not sufficient.
3. **Implement shared service-principal authentication and private API boundary.** Hash independent secrets, stable principal/owner, expiry/revocation/rotation, explicit capabilities, bounded header parsing, deny-by-default grants, shared rate/concurrency enforcement. Add JSON errors/private headers and mount in the correct parser/auth order. Browser inspection uses existing capability and CSRF primitives. Gate: middleware integration tests prove anonymous/foreign/revoked/expired/missing-capability denial, admin is not a bypass, 4 KiB/1 KiB limits operate before the 5 MB parser, body/header attacks and no leakage. Depends on 1–2; do not mount an unauthenticated interim endpoint.
4. **Finish safe evidence transport.** Establish actual streaming byte/deadline bounds with fixed origin and redirects denied; no raw body/error logging; normalized returned identity checks and allowlist writes. Confirm item-code grammar/scode policy on authorized fixtures, sandbox-test Mongo projection/CAS and actual unique gcode index, and define freshness policy. Suggested transport starting caps: 256 KiB decoded body, 256 KiB wire body, 16 KiB headers, 3-second absolute deadline, no retries. Gate: mocked network tests for redirect escape, status/type, timeout, compressed/oversize chunked responses and identity; malformed payload never written; legacy scraper regressions unchanged. Depends on 1–2. No live scrape required to write tests.
5. **Implement private inference wrapper and readiness.** Do not instantiate existing Qwen gateway clients until their private use is bounded/sanitized. Adapter must be explicitly selected and base-compatible, or explicitly approved baseline mode. Pin prompt/template, provide minimum factual evidence and weak HS, reject prompt-injection/tool requests; no arbitrary tools or generation options. Enforce connection/read/overall deadline, response bytes/tokens, zero or reviewed retries, cost/concurrency caps and scrub errors before logger. Readiness requires actual catalog/template/backend compatibility and approved applicability, not merely settings present or adapter name nonempty. Gate: disabled config makes zero outbound calls; synthetic valid/invalid/abstention/HS-disagreement cases; provider status/timeout/oversize/error privacy tests; later separately authorized backend smoke evaluation. Depends on 2 and 4; an allowlist does not establish classification accuracy.
6. **Build endpoint lifecycle and durable persistence.** Choose measured synchronous vs 202, final immutable snapshots, duplicate request claims, crash recovery/leases, owner/principal rechecks, attempt history, deadline/error/abstention outcomes and graceful shutdown. Register private models deliberately and provision/verify scoped indexes in an authorized setup step; do not depend on autoIndex. The foundation creates only final preparation snapshots, and does not reserve an idempotency key before evidence work: simultaneous calls may duplicate work before the unique insert resolves. No exactly-once remote execution claim. Future job records must be separate from immutable snapshots, with explicit transitions `pending -> running -> suggested|abstained|failed`; prepared foundation snapshots cannot be silently mutated/upgraded. Gate: real disposable Mongo index/concurrency/duplicate-key tests, crash-before/after-provider/persist tests, revocation during queue, feedback retry/foreign linkage tests, no duplicate final choice. Depends on 3–5.
7. **Minimal inspection and privacy operations.** Scoped admin/operator view of request/evidence/version provenance, final choice, missing facts/errors and unverified status; no raw reasoning. Escaped Pug/textContent and Graphite/Ember/Golden Amber theme. Authorized private export, retention/tombstones and deletion policy execution, bounded audit reporting. Gate: scope, CSRF, XSS and export/deletion tests; reviewers can trace a sample without declaring it verified. Depends on 3 and 6. No dashboard in this foundation.
8. **External minimal change and human end-to-end pilot.** Insert request/show/choose/feedback only before existing manual selection; preserve current same-JAN auto-use and normal UI fallback. Store a retry key per item interaction, final-choice feedback key, safe local retry policy and correlation ID. Never block final selection on feedback availability. Gate: human accepts and changes suggestions; missing JAN/item evidence, unsupported HS, timeout, provider failure, revoked credential, duplicate retry and unavailable feedback all leave manual workflow usable. Demonstrate no auto-application and no name/spec overrides. Depends on 6–7; external changes separately implemented/authorized, not part of this patch.
9. **Shadow then assisted rollout, with stop controls.** First authorized shadow samples compare suggestions without applying them; then small opt-in assisted cohort with human choice. Record coverage/error/latency/cost and missing-evidence/override reasons separately; independently review a stratified subset, including manual failures. Stop/disable principal or inference immediately on severe error, leakage, drift or budget breach; keep manual path intact. Gate: operating checklist, rotation/rollback rehearsal, limits, retention owner, independent evaluation report and explicit decision to continue. Depends on 8; no deployment requested by this foundation.

### External application pseudocode (future only)

```text
if existing_same_JAN_auto_match_applies:
    run existing behavior unchanged
else:
    outcome = null
    if identifiers and HS6 satisfy the pilot contract:
        try within agreed wait budget:
            outcome = POST recommendation with stable new request key
            if 202: poll scoped status only within remaining budget
        catch timeout/network/lookup/provider/error:
            retain persisted recommendation_id if safely returned
    show existing manual TARIC chooser
    if outcome contains valid suggestion:
        show suggestion, source facts, field gaps, versions and warnings
        require explicit human choice; do not pre-apply
    final_code = human selects/changes code in existing chooser
    save final selection through existing external workflow
    if recommendation_id exists:
        POST feedback with separate stable key and {selected_code: final_code}
        retry same key/payload only within approved retention/retry budget
        feedback failure never undoes or blocks human selection
```

## Persistence, immutability and retention

Recommendation fields: ownerId, principalId, scoped idempotencyKey, canonical versioned requestHash, createdAt, snapshot containing request/evidence/suggestion/versions/state/error_code. Feedback fields: same scope and independent key/hash, recommendationId, createdAt, final selection snapshot, original recommendation hash, decision/catalog status/missing evidence and fixed `verification=unverified`, `training_approved=false`. Snapshot validators reject hidden reasoning/provider blobs and extra fields. Code/name/fact bounds are enforced; schema-level Mongoose casting is not the HTTP boundary, so callers must use validators first.

Unique indexes are declared on `(ownerId,principalId,idempotencyKey)` per collection and `(ownerId,principalId,recommendationId)` for one final feedback. Mocks simulate these constraints; they do not prove they exist in Mongo. Ordinary save/update/replace/delete paths are guarded; raw collection access, bulk writes and database administrators can bypass Mongoose. Database roles/repository discipline and retention tooling must enforce the production boundary. Never expose injected models or raw collection methods to requests. Supersession/corrections are **deferred**: add immutable events linked to original and prior feedback with atomic one-current-event rules, audit reason and tested scoped access before supporting them.

No TTL is installed. Before collection starts, confirm recommendation: keep raw pilot requests/evidence/feedback for **90 days**, short-lived job diagnostics for **7 days**, aggregate content-free metrics for **one year**, and only explicitly approved de-identified immutable training datasets beyond that. These durations are proposed, not active policy or selected user preferences. Define idempotency tombstone duration at least as long as the agreed client retry window; after expiry clients must not assume replays are safe. A tombstone should retain only minimal opaque scope/key digest/status, never source text.

Deletion must cover scoped request/evidence/feedback, derived exports/caches and pending jobs together. Decide legal/business retention obligations and backup expiry before activation. Removing training source requires lineage-based exclusion from future datasets; deleting a row does not untrain an existing adapter. Document existing dataset/adapter dispositions and stop promotion if required. Export only authorized data with schema/version/provenance and missingness; never promote an accepted label to verified. Retention/deletion/export execution and tombstone schemas are follow-on work, not implemented here.

## CP2 dataset and model improvement plan

Use authorized [Chat5 source exports](chat5-conversation-export.md), preserving source references and ambiguity flags, plus reviewed existing mapping sources. Read the [Qwen3 adapter training guide](qwen3-adapter-training-guide.md) and [routing plan](qwen3-lora-routing-plan.md) for the existing Qwen3 4B LoRA/32B QLoRA infrastructure; those documents do not establish a TARIC adapter exists. No private conversation content is embedded here.

Separate **legacy mappings**, **human-selected pilot labels**, and **independently verified labels**. Frontier assistance can propose cleanup, deduplication, label conflicts and evidence sufficiency; it cannot self-certify truth. Keep source/evidence hashes, catalog applicability/version, reviewer decisions and exclusion reasons. Examples lacking decisive facts remain excluded even if a human chose a code. Do not train on hidden reasoning or reconstruct speculative historical prompts from Chat5 pairing.

Freeze immutable dataset, split and prompt/template manifests with hashes. Group by product identity/JAN/gcode, family/near-duplicate product, source/conversation and time where applicable to prevent leakage; hold independent final test labels outside training and selection. Benchmark selected base/frontier baseline, current mapping heuristic, 4B adapter and 32B adapter with identical evidence/catalog/template policy. Report top-code error, abstention/coverage, unsupported output, per-group errors, latency/cost and uncertainty from sample size; acceptance rate alone is insufficient. Preserve rare/challenge cases and measure the unchanged legacy auto-match population independently if later included.

Use the existing training wrapper only after authorized data review; adapter names/base hashes/dataset/template/catalog versions must be immutable, with candidate -> canary -> promoted/retired registry entries and rollback to prior candidate/manual. Do not train, download, reserve GPUs or invoke a frontier backend as part of this foundation.

## Setup decisions still required

No adapter, catalog source, credential, deadline or retention was selected by the user. Resolve these in CP1 package 2 with concrete options and measured constraints; don't silently activate recommendations from configuration guesses:

- Applicable catalog/jurisdiction/effective date, authorized source/license and approval/update owner. Recommended: small reviewed versioned applicable code set first, preserving manual choices outside it as unsupported.
- Initial backend: suitable explicitly versioned adapter if one is demonstrated, separately reviewed base/frontier baseline if chosen, or CP2 canary first. Recommended: benchmark the selected option before assisted rollout; do not infer availability from the gateway code.
- Integration owner/stable principal, issuance/rotation/expiry and explicit capability grants. Recommended: one dedicated revocable principal for this external app, no global key reuse.
- Client wait budget, measured cold/warm latency and sync vs 202 decision; cost/concurrency and request caps. Recommended starting limits above need load/latency validation.
- Retention/retry/tombstone/backup deletion durations, review and export owner, training permissions. Confirm before collecting real data; no silent TTL or indefinite storage.

## Validation record

Foundation tests use synthetic rows/providers and disconnected Mongoose models only. Focused command:

```sh
npm test -- tests/unit/taricContracts.test.js tests/unit/taricEvidenceService.test.js tests/unit/taricRecommendationService.test.js tests/unit/taricModels.test.js tests/unit/amiamiScraperService.test.js tests/unit/amiamiScraperServiceStartup.test.js tests/unit/amiamiItemFallbackService.test.js --coverage=false --runInBand
```

Run the full `npm test -- --runInBand` suite after the focused gate. No startup/prestart, production access, live scrape/provider call, Mongo migration/backfill, training, mounted route, external app edit or deployment belongs in this patch. Network transport and live disposable Mongo tests remain blocked on their explicitly deferred implementation/setup; neither mock persistence nor passing unit tests proves live index semantics, upstream compatibility, classification accuracy or CP1 readiness.

Implementation validation on 2026-09-17: focused run passed **7 suites / 73 tests** including existing scraper/fallback regressions. The final full run passed **308 suites / 3,565 tests**, with **1 suite / 4 tests skipped** by the existing Windows-only GPT image storage condition. Configured coverage thresholds passed. Diff review/whitespace checks passed; only the eleven new foundation/plan/test files changed.
