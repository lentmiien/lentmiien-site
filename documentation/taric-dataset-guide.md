# TARIC review → verified dataset → manual Qwen training

Open [Request history & human review](/admin/taric/history) from the [TARIC manager](/admin/taric). This guide covers the current manual workflow. Complete, genuinely checked sources with an independently approved description can now become working Qwen CSV rows. No conversion, upload, training, or promotion happens automatically.

## 1. Understand the history

Use **Apply filters** with the date, JAN, code, adapter, error, category/name, mode, request status, final feedback, review status, missing-name or eligibility controls. **Clear filters** resets the scope. Dates and “Through date” inclusive-day boundaries are UTC. **Next 50 requests** paginates the displayed population; statistics and export selection cover the entire filtered population, not just the page.

“Usage in filtered population” separates live requests and archived reviewed sources. A retained source and its live request count once. Benchmark attempts are excluded. Proposed codes describe model behavior. Final feedback decisions are **accepted**, **changed**, or **manual**; their shares use the number of final feedback records as denominator, never the number of requests. These shares are not model accuracy. A human accepting a suggestion does not verify its training label.

The pilot scans at most 2,000 filtered live + archived sources / 32 MiB, with bounded conflict peers. Narrow dates/JAN/mode/status when the limit is reached. These indexed base filters apply before the bound; other filters may not reduce the scanned population enough. A storage failure is an error, not a zero-count population.

## 2. Review the actual source and the label separately

Open a request and inspect its captured input, factual name/specifications, proposal or rejected diagnostic, final human choice, missing fields and errors. A diagnostic is **UNVALIDATED**. The target defaults to final feedback when present; otherwise only an accepted suggestion can be explicitly confirmed. Never infer factual item details from the JAN, category, current lookup or a plausible model description.

Select **Verified label** only after genuinely checking the classification against an appropriate source. Fill **Review target TARIC (10 digits)** and tick **I independently verified this exact target against the displayed source snapshot.** If correcting the training label, tick **This is a training-label correction…** and identify the reason/source in **Review note / verification source / withdrawal reason**. This changes the review target only; it does not change original final feedback or the GCS operational mapping.

Fill **Independently approved short description (optional; blank means not approved)** with a separately checked, nonempty description of at most 255 characters, then **Save explicit review revision**. This field is optional for code-only verification and Site source export, but REQUIRED for the current Qwen dataset. Model text is never automatically approved. The converter maps this field to `description_summary`, which supplies the response JSON's `description`. Neither the model description nor an unreviewed official-looking description is a fallback.

A verified code outside the 53-code v0 test catalog is allowed. Catalog membership and ten-digit syntax are not legal validation. For `EVIDENCE_NOT_FOUND` or missing factual names, the label can remain verified but the source stays ineligible until actual facts are available. The current review form does not edit or enrich facts. Record the gap for a future enrichment workflow or obtain a new, properly captured request and review it; do not fabricate fields to make a CSV row pass.

## 3. Status, stale reviews and retention

The statuses are **Unreviewed**, **Needs review / withdraw verification**, **Verified label**, and **Excluded** (filter values use `unreviewed`, `needs_review`, `verified`, `excluded`). Save an explicit withdrawal/exclusion when a label should no longer be used. A review stores an append-only audit revision with its source hash. Changing final feedback after verification makes the old review stale, even when the code agrees. Conflicting current verified targets within the same JAN or normalized input group also block eligibility, including known conflicting peers outside the displayed filters.

If a save, pagination or download returns **409**, the snapshot changed. Reload the detail or apply filters again, inspect the new source and review revision, and repeat the explicit review or preview. Do not retry an old approval blindly.

Raw requests and feedback expire after 90 days. Verified canonical snapshots, review audit and frozen exports remain private until operator retirement/deletion. A retained source bound to final feedback can still be exported after raw expiry. Proposal-only archives remain stale and ineligible. Operators must set a retention policy and remove retired snapshots, exports and downstream local datasets as appropriate; withdrawing a review does not delete or rewrite an already downloaded file. The repository `documentation/taric-history.md` describes bootstrap, indexes and scoped retention/deletion responsibilities.

## 4. Export a fresh, sufficiently broad source pool

In **Prepare reviewed source candidates**, choose **Newest verified first** or **Balanced by TARIC**, an **Overall row limit (1–200)** and **Per-code cap (1–100)**. Defaults are 100 and 20. Use **Preview current filters**, inspect exclusion diagnostics and description readiness, then **Freeze manifest & download JSONL**. The preview is invalidated when filters/options change. Zero candidates is a useful signal to check missing facts, staleness, conflicts, holdouts and review status; it is not automatically an export bug.

The Site selector keeps the latest exact normalized-input duplicate and excludes known independent published holdout overlaps. Same-JAN changed facts can be distinct records, but remain one product group. Missing specifications are allowed. The export is at most **200 rows / 8 MiB**, not a full backlog dump. To give the offline profile room to choose, deliberately widen the relevant filter scope and raise the Site limits within those pilot maxima. A converter cannot recover anything Site omitted or balance the entire database from a partial export. Asking for more rows than available never creates duplicates.

Download immediately before conversion. Re-export after any review/feedback change and discard superseded training artifacts. Hashes check internal consistency, not authenticity, signatures, later revocations, official classification or completeness. The converter requires a **trusted current private Site export**. It cannot know about review changes, new conflicts or new holdouts after download. It accepts one export only; merging older partial snapshots and inferring revocation from absent rows are unsupported.

## 5. Run the offline converter

Requirements: Linux, Python **3.9+** standard library, and a checkout containing `scripts/taric_dataset_converter.py`, its `taric_dataset` module and the `config` files. No pip packages, Node runtime, API keys, database, providers or network access are needed for conversion. Python is not needed by the web guide. The tool accepts verified JSONL only; the existing external legacy CSV converter is untouched and its CSV inputs are not certified as verified data.

From the Site checkout, replace the private input path below with your fresh download. The private parent must already exist with mode 700. Use a NEW output directory for each immutable run:

```bash
mkdir -m 700 -p "$HOME/private-taric-datasets"
chmod 700 "$HOME/private-taric-datasets"
python3 scripts/taric_dataset_converter.py \
  --input /private/path/reviewed.jsonl \
  --profile balanced-recent \
  --output-dir "$HOME/private-taric-datasets/run-001" --dry-run
```

Inspect aggregate counts and warnings. No row text is printed and dry-run writes nothing. Missing required facts, valid HS6/code10, or explicit description are skipped by the supplied profiles and counted by reason. If every row lacks a description, return to step 2, approve descriptions individually and export again. Zero selected rows exits unsuccessfully and does not create an empty “ready” dataset. A strict profile can fail the whole run on missing required data.

Run the identical command **without `--dry-run`** to create the files. The tool publishes all four artifacts together in a new mode-700 directory with mode-600 files. It refuses existing directories/files/symlinks, including concurrent publication; there is no `--force`. Failed staging is cleaned up. Use a local filesystem supporting Linux atomic no-replace rename. Keep private parents outside `public`, shared/synchronized folders and tracked repository data. The tool does not decide whether your chosen storage location is backed up appropriately.

From `/home/lennart/Programming/data-processing`, the same CLI works by absolute script path; no new Git workspace or changes to that project are needed:

```bash
python3 /home/lennart/Programming/lentmiien-site/scripts/taric_dataset_converter.py \
  --input /private/path/reviewed.jsonl \
  --profile /home/lennart/Programming/lentmiien-site/config/taric-dataset-profiles/balanced-recent.json \
  --output-dir "$HOME/private-taric-datasets/run-002" --dry-run
```

Remove `--dry-run` after checking the report. Named profiles resolve relative to the Site script, regardless of working directory; explicit JSON paths resolve normally from your working directory. Keep the reference project and its existing examples/outputs unchanged.

### Profiles

Profiles control selection, never label trust, required schema or system prompts. The defaults are editable policy choices, not optimal quotas:

| Built-in | Selection | Overall / per code / per product |
| --- | --- | --- |
| `newest-verified` | All eligible up to explicit caps, newest verification first | 200 / 200 / 200 |
| `balanced-recent` | Lexicographic TARIC round-robin, newest inside each code | 200 / 20 / 1 |

The per-product cap uses the Site JAN group, otherwise its normalized-input fingerprint. JAN is a string identifier, never a numerical model feature. No randomness, oversampling, synthetic rare examples or augmentation is used. Ties use request ID descending, matching Site. Recency is `review.at` / `verifiedAt`, not download time. Both built-ins have no age window; “recent” means preference for recent verifications. The effective cutoff defaults to the export `validatedAt`. Optional `--as-of 2026-09-24T00:00:00.000Z` must be no later than that cutoff; reviews after it are excluded. An earlier cutoff selects from current exported revisions, not historical revisions that were superseded.

Full synthetic custom profile example, saved as a private JSON file and passed with `--profile /private/path/profile.json`:

```json
{
  "schema": "taric-dataset-profile/1",
  "name": "synthetic-balanced-example",
  "version": 1,
  "mode": "balanced",
  "maxRows": 80,
  "perCode": 10,
  "perProduct": 1,
  "maxAgeDays": 180,
  "missingRequired": "error"
}
```

Every property is required and unknown keys are rejected. `schema` is fixed; `name` is 1–64 lowercase letters/digits/hyphens starting with a letter or digit; `version` is an integer 1–1,000,000. `mode` is `newest` or `balanced`. All three caps are integers 1–200; they cannot expand the Site export. `maxAgeDays` is null or an integer 1–36,500, measured inclusively backward from the effective cutoff. `missingRequired` is `skip` or `error`. JSON booleans are not integers. A machine-readable profile schema is in `config/taric-dataset-profiles/schema.json`.

Optional input limits `--max-input-bytes`, `--max-line-bytes`, `--max-input-rows` may narrow, never exceed, hard limits of 8 MiB, 2 MiB per line and 200 candidates. Profiles are limited to 16 KiB; nesting to 20 levels. UTF-8 with an optional initial BOM is accepted. JSONL records must be newline-terminated. Duplicate/unsafe JSON keys, floating/nonfinite numbers, malformed or inconsistent hashes/bindings, unsupported fields/statuses and proposal-only archives fail closed. Known skipped holdout/conflict/stale records cannot also appear as selected candidates. Holdout identities are not enumerated in this export: the converter relies on Site's fresh check and cannot discover unknown overlaps independently.

### Artifacts and exact field mapping

| File / field | Source or meaning |
| --- | --- |
| `cleaned.csv`: `descriptive_name` | `source.inputs.descriptive_name`, verbatim |
| `full_item_name` | `source.facts.name`, verbatim |
| `specs` | `source.facts.specifications`, verbatim; null becomes empty string |
| `hs_code` | Original six-digit string rendered as `0000.00`, preserving zeros; original HS6 also in manifest |
| `taric_code` | Explicit reviewed target string, ten ASCII digits |
| `description`, `taric_description` | Empty: current source schema provides no separately approved text for these fields |
| `description_summary` | Explicit `review.approvedDescription`, never model fallback |
| `prompt-response.csv` | Exactly `system,prompt,response`, UTF-8 quoted CSV |
| `manifest.json` | Versions, resolved profile/hash, effective cutoff, exact input digest, export ID/digests, ordered source/review IDs/revisions/hashes, JAN/groups, original HS6, renderer/template hashes, both CSV hashes and report hash |
| `selection-report.json` | Aggregate eligibility/exclusion counts, optional missingness, per-code/rare/empty-class counts and excluded request IDs/reasons |

The cleaned file has exactly the eight original columns, in the order above. JAN/provenance are in the private manifest rather than intrusive training columns. Source facts are not trimmed or normalized for training; only duplicate/group identity uses Site's NFKC/lowercase/whitespace normalization. HS punctuation and null-to-empty optional specifications are the documented transformations. The static `config/taric-training-template.json` is shared with Site's `trained-csv/1` renderer. The response is indented JSON with exactly `taric_code` as a string and nonempty `description`. It is not an official catalog description.

Check aggregates and file hashes locally, parse CSV with a CSV reader (embedded quotes/newlines are valid), and inspect a small private sample yourself. The same input bytes/profile/cutoff and converter version produce identical selection and artifact bytes; output paths and wall clock are not embedded. Counts below your desired sample size and empty/rare classes indicate available coverage, not generated replacements. Conflict detection is rechecked across all provided rows before profile filtering, then duplicates and caps apply. The latest duplicate wins even if its description is missing; an older complete row is not silently substituted.

Do not open raw cleaned fields as executable spreadsheet formulas. They are verbatim programmatic training inputs, so values beginning `=`, `+`, `-`, or `@` are not silently apostrophe-escaped. Training fields start with fixed system/prompt text or JSON `{`, but that does not make arbitrary source CSV safe for spreadsheet execution. Do not commit exports, CSVs or sidecars or put them under `public`.

## 6. Upload and train manually

Open [Qwen3 LoRA](/admin/qwen3-lora) or [Qwen3 QLoRA](/admin/qwen3-qlora). Upload **`prompt-response.csv`** using the existing dataset upload flow. In **Columns**, use `system`, `prompt`, and `response` for system/user/assistant respectively. Read the [Qwen training guide](/admin/qwen3-training-guide) for the actual tool controls. Record the dataset manifest/hash, profile, source export and resulting adapter version alongside your experiment.

The existing trainer uses full-conversation loss, and chat templating/truncation can remove target content. Check the actual backend configuration and matching tokenizer/sequence limit before training; different backends/settings can differ. This converter performs no token counting or truncation guarantee. Do not assume a historical 2048-token profile or a 32B default remains appropriate. Review complete rendered conversations and targets locally with the actual tokenizer when preparing a run.

Upload readiness does not mean promotion readiness. Finish a reviewed independent benchmark v1 with grouped holdouts before promotion. The training-derived v0 is a replay diagnostic, not an independent benchmark. Converting or verifying rows does not open normal release gates, autoapprove a benchmark, switch an adapter, or start training.

## 7. Repeat deliberately

New genuinely verified entries → fresh source snapshot → selected profile and deliberately reviewed replay sources → manual training → compare base/current/candidate on the independent benchmark → manual promotion under existing gates. Today one fresh export is the entire converter input; select a scope containing the desired older and newer examples within the pilot limits. There is no automatic recent-with-replay quota, central corpus merge or incremental supersession engine.

| Implemented now | Still to build or prepare |
| --- | --- |
| Human review, separate description approval, audit and retained final-feedback-bound sources | Official catalog plus internal goods-description composition |
| Source preview/export, bounded dedup/conflict/known-holdout checks | A missing-fact enrichment and re-review workflow |
| Offline strict source validation, two deterministic profiles, cleaned/Qwen CSVs, private manifests | Final dataset registry and automated training orchestration |
| Existing manual dataset upload and training tools | Independently reviewed gold v1 benchmark and promotion evidence |
| Fixed formatter and reproducible CSV/file hashes | Exact tokenizer length/truncation preflight |
| Preserved JAN/input groups for later separation | Fixed grouped train/dev/test split management, augmentation and external joins |
| A bounded single-export workflow | Larger corpus/export support, multi-export incremental feedback supersession and replay quotas |

These gaps do not block a first manual upload when eligible facts and approved descriptions already exist. They do limit evaluation claims, scaling and automation.

## Deployment and security contract

This change adds a static guide and offline tooling. In the deployed Site checkout, update with `git pull --ff-only origin main` through the normal Site release process, then restart the web process using the existing deployment procedure. Include the committed documentation, templates, config and static assets. Do not run `npm start` as a smoke test: its prestart pipeline mutates data. This update needs **no new environment variables, collection/index/bootstrap changes, database migration or provider/GPU setup** on top of the deployed history implementation. Python is needed only on the conversion workstation. Confirm `/admin/taric/history/guide` and the history link after deploy using an authorized account; anonymous/missing-capability users must be denied. Cloudflare must not cache this path. Rollback reverts code/navigation; keep private artifacts until deliberately retired.

Security zone: logged-in, private static documentation; same `taric.tool.manage` capability as history (admin bundle by default; family/user require an explicit grant). Machine principals: none. Object scope: none for static guide; underlying history remains explicitly admin-managed. No admin bypass, browser mutation, new CSRF operation, analytics, secret URL or outbound service. The inherited private/no-store, no-referrer, noindex and CSP headers apply. Fixed repository Markdown is sanitized, with only local admin navigation links; no user-controlled path. Rendering failures use the shared logger without content. No private row storage or new retention is introduced by the page. Negative tests cover authentication, capability, route order, inert markup and zero history/provider calls.

Offline files remain under the local operator's control, with explicit size/schema bounds, no networking, private permissions, atomic publication and no overwrite. Hashes are reproducibility/integrity metadata, not authorization. The full source population and benchmark identities behind Site's `snapshotHash` are not present in JSONL, so that hash is preserved but cannot be independently recomputed offline. The candidate-lines digest and canonical source/review hashes CAN be checked. This is an explicit legacy dependency on the trusted Site exporter, not a signed attestation service.

## Validation recorded for this implementation

The read-only compatibility check on the authorized legacy reference files found 67 input rows and 67 output rows. Both previously recorded digests were unchanged. All system/prompt/response strings matched the inspected original pure formatter functions and the existing output exactly; complete output CSV bytes also matched. No external script entry point was executed and no reference files were written. This is formatter compatibility evidence, not verification or import of legacy examples.

Tests use synthetic source data through the actual Site export service and the real Python CLI. Run `python3 -B -m unittest discover -s tests/python -p 'test_taric_dataset_converter.py'` or `npm test -- tests/unit/taricDatasetConverter.test.js tests/unit/taricHistoryGuide.test.js --coverage=false`. The Jest wrapper explicitly skips the Python suite if Python is unavailable; the standalone Python command requires it. Database-backed history suites still require their separate disposable test database configuration. No production conversion or training was performed.
