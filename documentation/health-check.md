# Health check history

## Security contract

- Feature: annual health-check dashboard and reviewed JSON import at `/health-check`.
- Zone: logged-in; sensitive health data; no machine principals or admin override.
- Capabilities: `health.check.read` and `health.check.import`, bundled for admin, family and user; both additionally require the validated principal ID to match `DASHBOARD_PERSONAL_OWNER_USER_ID`. Missing/invalid configuration denies access.
- Object scope: owner ID in every database predicate. Navigation uses the same owner and capability checks.
- Mutations: POST with shared session CSRF and Origin checks, after authentication and capabilities. Rate limited to 30 import requests per 15 minutes per owner.
- Limits: 3 MB JSON request, 100 exams, 100 sections/exam, 1,000 items/exam, 20,000 total stored items, 2,000 distinct imported measurements, bounded strings/mappings/choices, 8 MB stored history.
- Rendering: escaped Pug and DOM textContent; local feature scripts/styles; analytics disabled; private/no-store, no-referrer and noindex responses.
- Files/services: upload parsed in browser and sent as JSON; no file storage or outbound services. No AI provider receives health data.
- Logs: generic operational failures only, no uploaded content, notes, values or identifiers.
- Retention: accepted history retained until owner-authorized database removal; no temporary uploads or pending server-side copies. Preview signatures expire after 30 minutes and on restart.
- Tests: anonymous/non-owner/admin denial, capability absence, unset/invalid owner, CSRF/origin, bounded malformed input, escaping, scoped queries, conflict selection, idempotence and stale/concurrent import protection.
- Migration: new `health_check_histories` collection; one owner document (owner-derived `_id` plus unique owner index) with typed exam/measurement subdocuments and atomic revision compare-and-swap. No legacy health log changes or startup data import.

## Import semantics

Upload the standalone JSON structure (`exams[].exam_date`, `sections[].items[]`). The import page first suggests measurement mappings, then shows each changed field with separate keep/import choices. An exact repeat is ignored; absent fields and absent measurements never erase existing data. Explicit empty/null values are reviewed as changes. An import is saved atomically, including all its exams.

Exam identity is the exact exam date, allowing multiple exams in a year. Measurement identity is a stable category ID, preserving side/frequency and blood versus urine distinctions. Known names and source labels map automatically; uncertain mappings require an explicit selection. Unrecognized measurements may become new categories, with a user-editable category label. Units are never converted silently; charts split histories by unit.

Choose the report year before mapping (defaults to the newest exam year). Overall/doctor/metabolic/lifestyle notes and top-level report notes are imported only for that year. Historical placeholders in the 2026 reference are ignored, leaving older notes empty for later uploads. An older report can therefore fill those notes through the same per-field review. Exam-level dates, ratings, section ratings, measured values, ranges, findings and descriptions remain specific to each exam. Only institution/doctor metadata needed for context is retained; personal identifiers in `patient` are not stored.

The dashboard defaults to the latest exam, permits year and exam selection, and charts every numeric observation across all years. Missing measurements remain absent. Flags use each observation's own reference interval and reported rating. Unknown reference formats remain unclassified, never assumed normal. The copyable summary is deterministic: outside-range values, reported flags and exam notes, without generated medical advice.

## Deployment and verification

Use the existing `DASHBOARD_PERSONAL_OWNER_USER_ID`. Mongoose registers the new collection/index; the first approved import creates the history document. No new environment variables or dependencies. Exclude `/health-check` from edge caching. The source JSON must be uploaded by the owner after deployment; development does not write to the configured database.

Run `npm test -- tests/unit/healthCheck*.test.js --coverage=false`. Manually verify: empty state; 2026 report mapping; import review/save; repeat import; changed-value keep/import selections; 2025 report notes; year switching; all-year chart and unit separation; summary copying; mobile layout; non-owner denial. Use synthetic records for screenshots.
