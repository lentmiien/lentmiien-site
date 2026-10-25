# JMA municipal readiness v3: pre-deployment review

Baseline: `444c92f52e6c196e053ced7b2dde7b73bc8c52bb`. This is a parser/readiness repair, not a new product, route, provider or feature. Production was not accessed during development. The supplied 2026-10-24T23:54Z observations are incident evidence, not independently verified production results.

## Authoritative review

Downloaded development-safe public references on 2026-10-25:

- [JMA technical materials](https://xml.kishou.go.jp/tec_material.html).
- [Official XSD bundle](https://xml.kishou.go.jp/jmaxml_20241031_Schema(xsd).zip): `jmx_mete.xsd`, `type.Kind`, declares Name, Code and Status with `minOccurs="0"`. Schema optionality alone does not establish a hazard or clear state.
- [Product manuals](https://xml.kishou.go.jp/jmaxml_20261009_Manual(pdf).zip): `気象特別警報・警報・注意報_解説資料.pdf` (VPWW53), §3-2-4-1-1-1, printed pp.17–18; `気象警報・注意報（Ｈ２７）_解説資料.pdf` (VPWW54), same section, printed pp.13–14 and Appendix 1, p.27.
- [Official sample archive](https://xml.kishou.go.jp/jmaxml_20260917_Samples.zip): **24 VPWW53/54 XML documents**, all four hierarchy levels. Municipal statuses: 発表 721, 継続 834, 特別警報から警報 18, 特別警報から注意報 59, 警報から注意報 15, 解除 220, status-only 発表警報・注意報はなし 285. All missing Code/Name municipal Kinds were that status-only form.
- [2026 transition samples](https://www.jma.go.jp/jma/kishou/know/bosai/keiho-update2026/tech-info/zip/20260227_sample_keikasochi.zip), linked by [JMA's transition technical page](https://www.jma.go.jp/jma/kishou/know/bosai/keiho-update2026/tech-info/index.html): **116 VPWW53/54 XML documents**, four hierarchy levels, 47,432 municipal Kinds with 発表 and valid identifiers.

All **140** documents were parsed through `parseJmaAlert` and the revised readiness classifier: 136 nonlocal, 4 local coverage, none unresolved. These are JMA-authored examples, not live production bulletins. XSD declarations and manual semantics were inspected; this is not a claim of executing an XSD validator. Six byte-for-byte originals, including all seven statuses collectively, are committed under `tests/fixtures/jma/official/`; `manifest.json` records sources, archive members and SHA-256 hashes. Tests verify hashes, XML syntax, all four levels, readiness and local evidence after explicitly test-only relocation of every municipal Item. Synthetic incident reconstructions are separately labelled.

Downloaded sample archive SHA-256: `96332ca3f8e107be36fedff26e576b533c731616f85312d85b058f2118c2b6c2`; transition archive: `ffc7d2f313dad7d277a45aab853a43c5994977f846d39d601a1580ba05c97f8b`; XSD bundle: `adcea5e6f4af9bdf48b47dbc9cb2143f7499831eeec8dd633bc661a9420bede3`; manuals bundle: `441a5b802a42049b61f68d56c47040fe0f4c81f31b4427515f41b484bc4adc9f`.

The product manuals explicitly define the status-only form and prohibit Code `00` in municipal Body/Warning Kind. `00`/解除 in Head/Headline is a different representation. The old synthetic municipal `00` fixtures were wrong and are now replaced with official status-only clear. The manuals' illustrative cancellation snippet pairs 雷 with `17`; Appendix 1 and actual XML use `14` for 雷 and `17` for 融雪. The implementation follows the code table and XML, not that inconsistent snippet.

## Exact acceptance predicate

Only explicit municipal Warning types count: `気象警報・注意報（市町村等）`, `市町村等`, `気象警報・注意報（二次細分区域）`, `二次細分区域`. Whitespace at text boundaries is trimmed. Grouped/parent areas, Head/Headline, MeteorologicalInfos, LastKind and NextKinds never establish current municipal evidence.

Every municipal block must have Items; every Item must have at least one Area with a seven-digit string Code and at least one Kind. A malformed sibling also blocks completeness. Area display Name is not required. Kind fields must be scalar strings or XML `#text` wrappers, not arrays/numbers/objects without scalar text.

| Kind state | Exact predicate |
| --- | --- |
| `clear` | Status exactly `発表警報・注意報はなし`; Code, Name and Condition absent/empty. No missing-identifier exception for any other Status. |
| `active` | Status exactly `発表`, `継続`, `特別警報から警報`, `特別警報から注意報`, or `警報から注意報`; recognized two-digit VPWW53/54 hazard Code; optional Name, but if supplied it must match the code-table name. Downgrade-to-warning requires a warning code; downgrade-to-advisory requires an advisory code. |
| `cancelled` | Status exactly `解除`, recognized hazard Code, same optional/matching Name rule. Cancels that hazard only. A complete local snapshot containing only cancelled hazards can establish clear. |
| `unknown` | Anything else, including missing Status, missing active/cancelled Code, unrecognized code/name/status, municipal `00`, Kind Status `取消` or `切替`, or contradictory fields. |

Accepted hazard codes: warning `02–08`; advisory `10`, `12–27`; emergency `32`, `33`, `35–38`. Names and severity come from the product code table, so absent display Name does not discard identified evidence. No broader clear synonyms were established by the authoritative sources.

Conflicts are checked **per Area Code across Items and municipal blocks**: clear plus any active/cancelled Kind, or active plus cancelled for the same hazard Code, makes the bulletin incomplete. Different municipalities can legitimately be active, cancelled and clear. Same-revision conflicting local bulletins also remain unknown through the existing summary CAS. An `InfoType=取消` bulletin is a retraction, not a municipal cancellation or all-clear; it remains unresolved even with a body. Bodyless corrections/retractions remain unresolved. Empty EventID never associates such a bulletin with an existing local event.

Exact locality, product matching, cutoff for old `1410000`, six-hour local evidence age, five-minute future tolerance, 45-minute health age, and report/control/serial/correction ordering remain unchanged. Only `1410011` establishes current local coverage; `1410000` is accepted only before `2026-05-28T04:00:00Z` for VPWW53/54. Remote completeness cannot invent a local clear.

## Finite classifier output

Kind classification is exactly `active | cancelled | clear | unknown`. Bulletin classification is `{ version, resolved: boolean, reason }`. Version is **`jma-v3-local:warning-readiness-v3`**. The finite reason enum is exported as `REASONS`:

```text
missing_municipality_block
missing_municipality_item
invalid_municipality_area
missing_municipality_kind
invalid_kind_field
missing_kind_status
unsupported_kind_status
clear_kind_has_identifiers
missing_kind_code
unsupported_kind_code
kind_name_code_mismatch
kind_status_code_mismatch
conflicting_municipality_states
missing_metadata
different_product
unknown_bulletin_status
non_operational_status
unknown_product
bulletin_retraction
local_coverage
unknown_local_state
nonlocal_municipalities
ambiguous_local_code
```

Unresolved logging uses these fixed reasons, sanitized public bulletin filename, version and `disaster_ingestion` category. No raw values, XML or private data enter log metadata. Stored unresolved bodies log on a changed version/reason, not on every retry.

## Bounded automatic migration

- Parser version remains `jma-v3-local`; readiness version advances from v2 to v3. This avoids classification-only provider refetches.
- Normal polling selects at most 512 identities from current feed entries and persisted pending candidates; stale v2 results, including false results, are eligible immediately regardless of their recent checkedAt.
- At most **256 stored-body attempts per poll**, with a **15-second work deadline checked before starting each attempt**. In-flight database work can finish after that deadline; existing per-query deadlines remain 1.5/2 seconds. Failed attempts count and rotate behind unattempted entries. No archive scan.
- Reapply local evidence, then write the new readiness marker. A failed read/summary write/marker write remains retryable and cannot certify readiness. Current-version unresolved bodies retain the 15-minute retry interval.
- For v2 only, the frozen deployed evaluator computes the exact previous summary signature. Equal-revision repair is permitted only if that signature matches. Newer summaries, unrelated equal-revision evidence, and `signature='conflict'` cannot be overwritten by this repair. This handles status-only local clear or remote sibling completeness previously poisoning a local summary.
- The independent network-detail cap remains **80 attempts**, including failed requests. GET/dashboard/card read paths and bootstrap marker are unchanged. No environment, dependency, index or schema migration, reset, bulk repair, startup invocation or manual DB write is required.
- `warningReady` still requires both fresh warning feeds, no warning-feed errors, zero pending and no pending overflow. Historical deferred counts are irrelevant only after those gates resolve. Local display additionally requires fresh positive local evidence.

## Pure pre-deployment diagnostic

Use the exact **[pasteable diagnostic expression](diagnostics/jma-warning-v3.js)**, generated from the revised functions and their exact pure dependencies. It returns `diagnoseJmaWarnings`. It contains its own closed module table; its local `require` cannot access Node or external modules. It has no filesystem, process/environment, database, Mongoose, provider, app initialization, timers, logger, or output calls. Do **not** run the build script on production or import the application/service files there.

The production verification tool should obtain projections through its already-approved read-only/native connection, or use already-projected evidence. Do not initialize Mongoose models (including autoCreate/autoIndex) to obtain them. Preserve parsed raw strings and arrays; do not coerce Codes to numbers.

Project only:

```text
source sourceId sourceUrl status infoType eventId reportAt controlAt serial
entryUpdatedAt localWarningCheck raw.Head raw.Control raw.Body.Warning
```

Construct one row for **every one of the 48 pending identities**, including a row with `alert: null` and `identity` if a body is missing, plus all resolved local candidate records needed to replay the most recent local revision and any equal-revision VPWW53/54 counterpart. Preserve the pending list exactly; do not substitute title/author-based locality filtering. Resolve missing/ambiguous local record selection before trusting the projection. Inputs are ordinary in-memory values:

```javascript
// diagnose = the function returned by evaluating the entire attached expression.
// storedByUrl and resolvedLocalRecords are existing read-only projections.
const records = [
  ...pending.map(p => ({ pending: true, identity: p.url || p.id,
    candidateAt: p.updatedAt,
    alert: storedByUrl.get(p.url || p.id) || null })),
  ...resolvedLocalRecords.map(alert => ({ pending: false,
    candidateAt: alert.entryUpdatedAt, alert }))
];
const result = diagnose({ records,
  expectedPending: pending.map(p => p.url || p.id),
  now: '2026-10-24T23:54:00Z', // use the matching snapshot time, not an invented fresh time
  feedHealth: { at: '2026-10-24T23:53:19Z', warningFeedsPresent: true,
    warningFeedErrors: 0, warningPendingOverflow: false }, // verify these stored fields
});
// Return only selected result fields through the verification tool's output.
```

Limits: at most 512 supplied rows; exact unique pending identity membership is checked. Missing bodies and unresolved current evidence block projected readiness. The caller must verify the supplied feed gates and completeness of resolved local selection; an in-memory predicate cannot prove those external facts. This is a projection, not proof of live DB writes or summary migration success. An existing stored conflict marker must be reported separately and is never repaired by deployment at that revision.

At the supplied snapshot, acceptance is: `completeSelection=true`, `suppliedPending=48`, `unresolved=0`, `projectedWarningReady=true`, `projectedLocalState='active'`, active codes exactly `['14','15']`, local `at=2026-10-24T23:07:00Z`, fog `20` inactive, and every pending row resolved with a finite reason. A fresh authoritative local status-only record should instead project clear. **Do not call the release production-validated until this check passes against the actual stored bodies.** Re-running an old snapshot at today's clock must report stale once the six-hour window expires.

## Validation

Focused suites cover official original XML, every documented status, code-derived optional names, malformed/unknown fields, same-area conflicts across all hierarchy placements, mixed municipalities, remote status-only completeness, genuine local clear, bodyless empty-ID corrections/retractions, exact locality/time/order constraints, the previous 232-candidate regression, and the 48-v2-pending reproduction with 6,715 historical deferrals. The latter reaches readiness with two advisories and no classification network requests, then accepts a newer explicit local clear. Count/time/network limits and failure retry cases remain covered.

The diagnostic is tested in an isolated JS context without external capabilities; its generated text must exactly match the production source predicates. Tests verify no input mutation, exact pending membership, missing-body rejection, timestamp/health gating, local conflict handling and parity with the application classifier.

Final verification: **187 focused tests / 5 suites**, **5,966 full-suite tests / 439 suites**, with 261 tests / 17 suites skipped by existing configuration. Coverage thresholds passed (statements 71.78%, branches 50%, functions 80.79%, lines 72.64%). The frozen v2 evaluator was also compared with the deployed baseline source on 280 original/test-relocated projections; all signatures matched. JavaScript syntax and `git diff --check` passed. No dependency or curated OpenAPI changes. No production, application startup, deployment, or provider polling was invoked.
