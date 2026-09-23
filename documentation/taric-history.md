# TARIC history and reviewed candidate export

## Security contract

- Feature: private request/outcome history, explicit human label review, candidate export preparation.
- Zone: logged-in. Interactive principals: holders of `taric.tool.manage`; admin bundle only by default, no family/user default grant. Machine principals: none.
- Classification: private. Scope: explicitly admin-managed requests under the server's `taric_settings/tool.owner`, across integration and browser principals. Foreign owners are never joined, counted, reviewed or exported. No caller-selected owner. The existing semantic middleware and `adminPrincipal` both check current authority.
- Mutations: shared session CSRF header, POST, strict JSON; actor from session principal. Read-only GETs do not enqueue work or contact providers.
- Limits: 2,000 live requests per configured owner, 32 MiB projected population, 50 rows/page, 100 revisions/request, 2,000-character review note, 255-character approved description; 200 export rows, 8 MiB JSONL, 100 published independent benchmarks / 50,000 cases. Database reads and review CAS have 2-second server deadlines. Existing admin rate limit and a two-operation concurrency cap per application instance apply. Limit failures fail closed with an explicit explanation; no partial statistics or conflict scan.
- Rendering: escaped Pug and DOM textContent, no provider blobs/hidden reasoning/credentials, no analytics, local assets, existing admin CSP. Cache: private/no-store, no-referrer, nosniff, noindex.
- Storage: separate server-owned review/audit and immutable export documents in private MongoDB, no filesystem artifacts. Retained until an operator explicitly removes them under their retention policy; no new TTL. Existing requests/outcomes still expire after 90 days. An expired source cannot be re-exported, while downloaded/frozen manifests persist.
- Outbound services: none. Logging: shared logger, operation/status only; never facts, notes or output payloads. DB failures produce 503, never empty successful statistics.
- Negative tests: session/capability/CSRF, owner scope, unknown/operator parameters, bounds, stale revisions/source, unvalidated proposals, immutable feedback, snapshot mismatch and output field allowlists.
- Migration: idempotent existing bootstrap registers two additional collections and their indexes. No data migration, automatic verification, release gate, credential, benchmark, worker, provider or GCS changes. Cloudflare must not cache these paths. Rollback removes navigation/routes; retain audit collections.

## Semantics

Verification is a human label attestation, not official TARIC validation or training approval. Ten-digit syntax is checked; catalog membership is contextual only. Review defaults to final human feedback. Without feedback, an accepted model suggestion requires explicit target confirmation. A correction requires an existing target, a note/source and a separate confirmation. Rejected diagnostic proposals cannot supply the default target. Description approval is always separate, never inherited from a model.

Every review appends a revision using single-document CAS, binding a hash of allowlisted source inputs, factual evidence, outcome, proposal, provenance and source dates. Arrival of any feedback, even an agreeing code, makes an earlier review stale. Concurrent source changes are detected on subsequent reads; a saved review does not lock immutable request/outcome collections. Active requests cannot be reviewed. The current source hash and expected revision must match; audit history is never rewritten. A stale verified revision remains in the audit but is ineligible.

Profile `reviewed-code-candidates/1` needs a current verified target, captured full item name, descriptive name, and six-digit original HS. Specifications are optional and missingness is preserved. Approved description is optional; missing description warns that the current adapter's mandatory-description formatter is still pending. These are source candidates, not trainer-ready Qwen/LoRA files.

Conflicts are checked across the entire bounded owner population before filters: active current verified labels disagreeing within a JAN group or exact normalized canonical input group are derived as needs-review and excluded. Same-JAN changed facts remain distinct dedupe records but share a split group; contradictions are conservatively blocked until a reviewer explicitly withdraws/corrects a label. No source-applicability override or semantic near-duplicate detector is claimed. Exact duplicate inputs choose the latest verification, then stable request ID. NFKC/case/whitespace normalization is only for identity; exported facts retain their exact source values. Published, uncontaminated, independent release-eligible benchmark overlap/source/group hashes are checked; v0 is not a holdout. Unknown identities/paraphrases still need human checks.

Selector `reviewed-selector/1`: newest verification first or balanced by TARIC (lexicographic code round-robin, newest inside each code); default limit 100 and per-code cap 20, maxima 200 and 100. These are bounded pilot defaults, not optimized training policy. No duplication, oversampling, fabricated classes, split assignment or augmentation.

Preview is read-only POST and returns a digest of the complete bounded source/review/holdout population, filters, options and selection. Download POST recomputes and compares it, then repeats a population check before freezing those exact rows. A change returns 409 and requires a new preview. The manifest records its validation cutoff, source/review hashes, options, exclusion decisions, algorithm/profile and SHA-256 of the exact candidate JSONL lines. The first JSONL line is the manifest, remaining lines are candidates. A single document stores the exact complete JSONL and its SHA-256; no transaction/replica set needed. The cutoff is the final observed snapshot, not a cross-collection transaction or promise that no later edits can occur. Subsequent reviews do not rewrite frozen exports.

History statistics and filters cover requests only, never benchmark attempts. All timestamps/date boundaries are UTC (date-to inclusive day). Feedback shares use final-feedback count as denominator; they are not model accuracy. Cursor is `(createdAt, request ID)` descending, and statistics cover the whole filtered population, not just the page. This pilot intentionally refuses populations above its cap; scaling beyond it needs a materialized review/conflict index, not silent sampling. Upstream application/run/revision is not persisted by the current schema and is shown as unknown.

## Operator bootstrap and verification

Windows, Node 24.20.0, from the Site repository (human operation only):

```powershell
node scripts/taric-tool.js --bootstrap
node --env-file=.env scripts/taric-tool.js --bootstrap --execute --allow-database-write
```

Do not pass `--owner` for an existing installation. The second command retains the existing owner/settings. New collections: `taric_reviews` (unique owner/request, owner/latest review time) and `taric_exports` (owner/createdAt/_id); existing bootstrap also checks all existing TARIC indexes. No new dependencies or environment variables.

Open `/admin/taric/history`. Check a real request's proposal versus final choice, facts/missingness and UTC times. Compare filters and feedback denominators. Explicitly verify a good final choice, reload and inspect audit. Verify an incomplete label and confirm candidate eligibility remains blocked. Test withdrawal/correction with a reason. Later, when authorized, preview both selectors, inspect conflicts/holdouts/missing-description warnings, then download and parse the private JSONL. Do not automatically verify records or download production data as part of deployment. Two tabs should produce 409 on stale review/save or preview/download after a change. Check keyboard navigation, narrow layout and both theme modes.

Stored adapter/fingerprint and normal-mode runtime identities are shown. Template renderer/hash and catalog version are read only from the referenced stored run configuration when present; test requests have no persisted run/template/catalog snapshot, so those fields remain explicitly absent rather than inferred from today's configuration.

## Implementation validation (2026-09-24)

Synthetic fixtures only, isolated standalone MongoDB 8.0 at a loopback-only port; no production application startup, production data, providers or GPU calls.

- Focused command: `TARIC_TEST_MONGO_URL=mongodb://127.0.0.1:27028/taric_test_final npm test -- tests/unit/taricHistoryDomain.test.js tests/unit/taricHistoryMongo.test.js tests/unit/taricHistoryUi.test.js tests/unit/taricToolMongo.test.js tests/unit/taricAdminUi.test.js tests/unit/taricBootstrap.test.js --coverage=false --runInBand` — 6 suites, 108 tests passed.
- Full command: `TARIC_TEST_MONGO_URL=mongodb://127.0.0.1:27028/taric_test_final npm test -- --runInBand` — 337 suites, 4,115 tests passed; 3 suites / 10 tests skipped by existing environment guards (two opt-in Python Gateway suites without configured helper/interpreter, Windows ACL tests on Linux). Configured coverage thresholds passed.
- All changed JavaScript passed `node --check`; both Pug templates compiled; `npm run lint:openapi -- taric-assisted.v1.yaml` passed (machine OpenAPI unchanged); `git diff --check` passed.
- Mongo tests cover actual indexes/bootstrap idempotence, owner-scoped joins, chronology ties, review CAS races, source changes, late feedback, immutable feedback/export, heldout/group conflicts, HTTP session/capability/CSRF controls, storage errors, row/byte limits, and exact Unicode JSONL hashes. DOM tests cover inert hostile text, human-choice labeling, filter URLs, review/preview CSRF and stale responses.
- Security/diff review checked scope predicates before reads/writes, server-derived actor/owner, allowlisted response fields, no GET mutations, private headers, bounded concurrency and append-only provenance. No release-gate logic was changed.
- Browser discovery returned no connected browser. No visual browser result or screenshot is claimed; complete the operator layout/keyboard checks above. The local synthetic harness and disposable database were removed after testing.
