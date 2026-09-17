# TARIC assisted classification release plan

Status: implementation complete for operator deployment; **not deployed or classification-validated**. Foundation: `e6bd072e0fa5899357dddb07f94c16a4bacca45c`. The external application is unchanged. Deployment steps are in [taric-runbook.md](taric-runbook.md); machine contract is [taric-assisted.v1.yaml](../public/yaml/taric-assisted.v1.yaml).

## Product boundary

The external application's existing same-JAN reuse and manual selection continue. This service can offer a suggestion immediately before manual selection; a person makes the final choice. Errors, invalid output, missing evidence, held releases and timeouts retain the manual path. There is no automatic selection, confidence claim, training approval, training wrapper, model download, or automatic promotion.

Only literal JSON `test:true` selects the pinned `taric-v1-20260917-2` adapter. It is an **untested baseline**, always requiring manual confirmation, and can never authorize normal release. Missing/false `test` requires the latest explicitly published independent v1+ benchmark and an actually passing adapter. Strings such as `"true"` and `"false"` are invalid. No base model or alternative adapter fallback exists.

## Implemented architecture

- `routes/taric.js` mounts `/api/taric/v1` before the global 5 MB parsers and legacy `/api` authentication. Dedicated bearer authentication precedes a 4 KiB JSON parser (1 KiB feedback), with strict duplicate-key/header rejection, no compression, and terminal JSON 404 handling.
- `models/taric_tool.js` registers seven named collections through `database.js`: settings, credentials, benchmarks (embedded immutable cases), runs (bounded case results), requests (durable jobs and immutable terminal outcomes), outcomes (final feedback), and controls (leases and fetch budget). Named unique indexes enforce scoped idempotency and queue capacity.
- `services/taric/service.js` owns authentication, admission, scope, credentials, feedback, configuration, import and publication. `worker.js` runs only after database readiness, pauses when unavailable, and participates in application shutdown.
- The foundation `taricEvidenceService` retains local JAN uniqueness, identity assertions, successful-only upserts/CAS refreshes and validated winner rereads. Pending/missing detail containers refresh by explicit gcode; missing specs on a fetched item remain valid. The new bounded native transport uses the scraper's fixed endpoint, headers and pure `normalizeDetail(..., {includeRaw:false})`; legacy scraper behavior is unchanged.
- `services/taric/transport.js` implements private Gateway calls without the legacy payload logger/retry wrapper. Only allowlisted, operator-configured origin and fixed paths are used. No request-selected destinations, redirects, retries, or challenge fallback. Identity/gzip/deflate/Brotli responses have separate streaming wire and decoded byte limits under one absolute deadline.
- `utils/taricProtocol.js` is the shared benchmark/recommendation renderer, strict parser and decoding version. It emits exactly the trained system/user template using caller category, stored title/specifications and dotted HS6. Other stored details remain evidence provenance; they are not appended as untrained prompt blocks.
- `/admin/taric` uses the Graphite/Ember/Amber theme, semantic capabilities, real session identity, shared CSRF header checks before upload allocation, escaped Pug and `textContent`, no analytics, and private/no-store headers. It supports one-time credentials, configuration/readiness, stored-item tests, preview/import, multiple adapter runs, explicit publication, cancellation/revocation, and paginated private inspection.

The old foundation recommendation/feedback schema factories and disabled preparation helper remain for compatibility with their tests. They are not the HTTP persistence path. No migration of nonexistent foundation collections is required.

## Source and trained template evidence

The authorized cleaned CSV was inspected read-only. Its headers are exactly:

`descriptive_name,full_item_name,specs,hs_code,taric_code,description,taric_description,description_summary`

- SHA-256: `799e95dcce447381ca49aeaae65fb7937896971e0d3f943d12c40996b9f51ef8`
- 55,373 bytes; 67 input rows; 67 accepted; 0 duplicates; 0 invalid; 53 distinct TARIC codes; 6 empty specs.
- Training CSV SHA-256: `22ea56418479ecc6d962ad1328eef54c3897aa5b99095093e8231984e8d070be`, matching dataset `20260917-143344-taric-v1-20260917-22ea5641`.
- All **67/67 system and rendered user prompts match exactly** against the generated training artifact. All source HS values are dotted; internal HS is canonical six-digit text and the renderer restores the dot.
- System literal SHA-256: `069a91f1435a0cba1980627635c6cf66c9afa41c8e055e4cd947b39acc943b46`.

Only fixed template code and nonsecret manifest metadata are committed. No private CSV, rows, real-item fixtures, prompt instances or raw responses are committed. Runtime has no development-path dependency. The importer is local; Gateway dataset download/changes are unnecessary.

## Benchmark integrity and winner policy

Version 0 accepts only the verified cleaned source digest. It carries permanent training lineage, contamination, and `releaseEligible:false`, even if explicitly published or scored at 100%. Its code list is labelled **training-derived/non-authoritative**, solely for test/v0 output membership. It is not an approved classification catalog.

Future v1+ imports require the same five primary columns; optional `description_summary`, `source_id`, `group_id`, `provenance` are supported. The importer validates all rows, preserves leading zeros, rejects conflicting duplicate labels, and reports exact duplicate counts. It freezes the administrator's scoring thresholds before any run. Reviewed targets, independence, exclusion from training, reviewer and provenance declarations are mandatory before independent publication. Sidecar `sourceLineage` is retained. Training lineage, the known file digest, or exact normalized input/source/group overlap marks a draft contaminated and prevents independent publication. Copying/renumbering v0 cannot clear lineage. Source falls back to normalized item title when no source ID is supplied.

These overlap checks **do not prove independence**: paraphrases, aliases and missing product-family group IDs require human review. Reformatting alone is detected through normalized hashes; undisclosed paraphrased training contamination is not algorithmically solved. Administrators must audit grouping and record honest declarations. Formula-looking textual CSV cells are never evaluated or exported to spreadsheets; HS/TARIC columns require strict string syntax.

Drafts never change the current release. Publication explicitly and monotonically replaces the current version, freezes labels/policy, and invalidates old scores through the configuration revision. Correct mistakes by importing a new version; there is no edit-in-place for datasets or policies. Independent runs require publication first. No v1 is created automatically.

All required cases remain in the denominator. Each adapter runs sequential cases, recording actual/requested counts, exact matches, invalid/error/abstained cases, and bounded parsed outputs. Optional description token Jaccard is **lexical diagnostic similarity**, not semantic correctness or a promotion criterion. `minExact:1` / `maxInvalid:0` are displayed conservative defaults that the admin explicitly accepts or changes before import. A perfect score on a small or contaminated dataset does not establish statistical quality.

A Mongo-allocated monotonic run sequence orders replacements independently of clocks or random IDs. The latest authoritative run for each adapter on the current benchmark supersedes its predecessor **as soon as it is queued**, regardless of success or fingerprint. Only complete, uncancelled, fully counted passing runs with current fingerprints qualify. Winner is highest exact-code fraction, ties by immutable adapter identity then adapter name. Code, dependency lockfile, renderer/parser/decoding, catalog, configuration revision, adapter or model identity changes invalidate scores. A draft does not; a newly published benchmark does. Old normal results are held on retrieval/replay if their admission is no longer current. Admission, worker start/pre-provider, completion, retrieval and replay check the gate; credentials are revalidated for delayed work. Feedback remains available for an existing terminal request even when the release is held.

## Runtime identity and inference bounds

The observed training base is `Qwen/Qwen3-4B-Instruct-2507`, rank 16 / alpha 32 / dropout .05, seven projection modules, sequence length 2048. Historical base/tokenizer snapshot revision remains **unresolved**. Test mode explicitly accepts this unresolved identity, without claiming it is verified. Normal mode requires operator-recorded trust source, deployment revision, immutable adapter digest/identity, base revision, tokenizer revision and expiry, plus matching metadata observed from the fixed trusted Gateway before/after inference. See the exact metadata contract in the runbook. Arbitrary hash text is not runtime proof.

Inference uses `/qwen3-lora/generate`, exactly two messages, server-selected adapter, `do_sample:false`, `temperature:0`, `repetition_penalty:1.05`, default `max_new_tokens:256` (cap 512). No tools, extra system message or `response_format`. Entire `content` must be strict JSON with only ten-digit string `taric_code` and nonempty description under 256 characters. Duplicate keys, fences, prefixes/suffixes, missing descriptions, truncation and mismatched `raw_content` are rejected. The envelope must identify model `Qwen/Qwen3-4B-Instruct-2507` and the exact requested `adapter_name`; missing/wrong identity or nonempty/malformed `tool_calls` is rejected. Empty/null/absent tool calls are accepted. No substring extraction, rescue code, trusted logprob/finish-reason claim or HS-prefix rejection; mismatch is only a warning (training hints frequently disagree with targets).

Without an available matching tokenizer, input UTF-8 bytes count as tokens, plus 128 chat-framing slack and reserved output tokens, all <=2048. This intentionally overrejects long/multilingual inputs and never silently truncates. All 67 authorized v0 inputs fit this bound at the default 256-token output reserve (no generation was performed). Tokenizer adoption requires a new fingerprint and benchmark rerun. AmiAmi has a 15-second absolute deadline and 256 KiB streaming cap. Gateway metadata has a 5-second deadline per call; generation 60 seconds / 16 KiB envelope / 4 KiB content. Identity encoding is requested; gzip/deflate/Brotli responses are also decoded incrementally with both wire and decoded limits at the stated cap. The absolute deadline includes DNS, connection, streaming and decompression. Unknown or stacked encodings, redirects and invalid JSON content types are rejected. Native TLS fingerprints may be challenged by AmiAmi; failure returns the manual path with no failed item insertion.

## Security contract

| Field | Policy |
| --- | --- |
| Zone | Logged-in/private; machine service principals, never legacy session/global-key authentication |
| Interactive authority | `taric.tool.manage` in the normal capability catalog; admin bundle by default, no family/user grant; explicit per-user grants supported |
| Machine authority | Stable `integration` principal; fixed bootstrap owner (`taric-tool` by default); scopes `taric.requests.create`, `taric.requests.read`, `taric.feedback.write` |
| Object scope / admin override | Machine reads/writes require owner AND principal; credential-generation replay/read isolation. Browser is explicitly admin-managed across this one tool; admin test jobs derive identity from the validated user and recheck stored account/capability before work |
| Credentials | 32 random bytes, `ttk_` prefix, SHA-256 hash only in DB, one active generation, 90-day expiry; one-time response, no flash/log/query storage; rotation/revocation invalidates queued authority |
| Data | Private source facts, benchmark cases and normalized results; credentials secret. Raw provider envelopes/prompt instances are not persisted |
| Browser CSRF | Non-GET, shared session token header and Origin check before upload parsing; no fake principals |
| Abuse | 180 unauthenticated ingress requests/minute/IP/process; 120 authenticated requests/minute across processes per integration; admin 120/minute/IP/process; 20 durable interactive slots, 8 benchmark slots; 500 cases/import, 6-hour run deadline |
| Provider concurrency | Shared Mongo inference lease, one case at a time; interactive priority between benchmark cases. Lease fencing rejects late results. Uncertain in-flight claims become interrupted, never automatic repeat; a durable inference hold requires explicit operator confirmation that the Gateway is idle. Cancellation stops future cases; it does not claim remote GPU cancellation |
| Source cooldown | Shared 20 fetch attempts/rolling minute and once/gcode/minute under inference lease, in addition to foundation local limiter |
| Upload | Authenticated admin only, CSRF first; memory upload <=2 MiB, one CSV and one <=8 KiB metadata field; strict UTF-8/header/row validation, preview hash required before UI import; buffers cleared after processing |
| Rendering/cache | Escaped Pug/textContent; restrictive CSP, no external scripts/analytics; private/no-store/no-referrer/noindex; safe JSON errors |
| Outbound | Fixed AmiAmi HTTPS endpoint and fixed operator-allowlisted Gateway origin; optional dedicated Gateway credential from environment; no user/model URLs |
| Logs | Shared logger records actionable stable codes/operations only, never credential values, raw errors, prompts, private rows or response bodies |
| Retention | Requests and feedback have 90-day TTL indexes (idempotency lasts while retained); benchmark cases/results and configuration audit metadata remain until deliberate operator removal under backup policy. No automatic training reuse. No public export endpoint |
| Legacy migration | Source model read/CAS adapter only; external app untouched; independent router terminates before legacy auth; old foundation helpers remain internal |

## Rollout stages

1. **Human deployment/setup:** apply the reviewed release normally, run explicit bootstrap/index creation, transfer/import private v0, configure Gateway and issue a dedicated key. Enable only for an authorized inference window. Verify `test:true` manual fallback and normal `RELEASE_CLOSED`.
2. **Diagnostic baseline:** run v0 against named adapters after separately authorized GPU validation. Inspect parsing/token-limit failures and exact-code scores; do not interpret training-derived scores as generalization.
3. **Independent evaluation:** collect reviewed independent grouped data and approved catalog; verify runtime identity; choose thresholds before import; publish v1+ explicitly; complete full adapter runs. The deterministic winner may serve assisted normal requests, still human-confirmed.
4. **Future improvement:** separately authorized data review/training, held-out benchmarks, drift monitoring and possibly restricted automation. No training or automation wrapper is implemented here.

Software validation is synthetic, including disposable Mongo index/race tests. It proves control behavior, not tariff accuracy. No live scrape, Gateway inference/training, production initialization or deployment occurred in the implementation turn. The separately running Gateway GPU smoke is outside this work.
