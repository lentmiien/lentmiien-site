# Approved TARIC codes

## Security contract

- Feature: persistent approved-code registry and stable training descriptions.
- Zone: logged-in; interactive principals: accounts with `taric.tool.manage` (admin bundle only by default; family/user have no default grant). No new machine management access.
- Data: private business labels. Scope: explicitly admin-managed shared registry, one record per ten-digit code; authorized managers may read/edit every registry record. History retains its existing owner scope.
- Browser writes: POST, shared session CSRF checked before parsing; existing private/no-store headers, CSP and 120/minute management rate limit.
- Limits: UTF-8 CSV <=2 MiB, <=10,000 rows, one file, no fields; <=4,000 heading characters, <=2,000 goods-summary characters, <=255 description-summary characters. Lists are code-prefix filtered and paginated at 50 records; edits use revision compare-and-swap.
- Rendering: escaped Pug and DOM textContent/value; no analytics, inline scripts, or outbound services. Uploaded buffers stay in memory and are cleared after processing; no public files.
- Logs: storage failures and unapproved model proposals, without product text or uploaded contents.
- Retention: registry records persist without TTL; approval can be revoked without deleting text. Existing immutable training exports keep their frozen description provenance.
- Negative tests: missing authentication/capability/CSRF, malformed and oversized CSV, conflicting duplicate codes, unknown fields, stale edits, forged export description provenance, missing/revoked code exclusion.
- Migration: additive collection; existing benchmark/test catalogs and release gates remain independent. Legacy review-description exports remain available explicitly.

## Import and editing

Open `/admin/taric/codes` from the classification or history page. CSV requires `taricCode` (or `taric_code`); optional fields are `headings`, `goods_summary`, `description_summary`. Codes must be ten digits (spaces/dots between groups are accepted); leading zeroes are preserved, never guessed. Blank optional fields are allowed. Repeated codes merge matching/nonconflicting text; conflicting values reject the whole file before database writes. Preview reports additions and existing records. Import approves new records only, preserving all existing text and approval states. Use the edit form to change text or revoke approval.

A description summary is a human-maintained, stable label for that code. The headings and goods summary provide its context; importing or generating a classification never automatically rewrites it.

## Training and output checks

The history export UI defaults to registry descriptions. A candidate still needs a verified, current human code review and all existing eligibility checks. Missing/revoked registry codes and blank stable descriptions are excluded. Every exported candidate contains a frozen registry record and its hash; previews become stale if relevant registry values change. The converter validates this binding and uses the registry summary for `description_summary`, the goods summary for `description`, and headings for `taric_description`. Original per-item reviews and model output stay unchanged. Legacy per-review descriptions can be selected for older workflows.

Model generation (interactive, benchmark and local re-do) checks returned codes against the registry and logs unapproved proposals. Successful responses carry `approved_code` metadata and an `unapproved_taric_code` warning; rejected diagnostic proposals carry the same check when captured. Approval is an operational allowlist, not a legal validity judgment. Existing release/test allowlists still apply independently; this warning does not automatically approve or replace generated codes. The admin test view and history detail show current registry approval.

No import enables normal mode, changes a benchmark, approves an individual product classification, or starts inference. No new environment variables are required. Provision the additive collection/indexes through the existing TARIC bootstrap command when automatic collection creation is disabled.
