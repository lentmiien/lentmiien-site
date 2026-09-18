# Codex dashboard and session history

## Security contract

- Feature: read-only historical session browsing on `/codex/api/session-history`.
- Zone: logged-in; interactive principals: admin, family, user; existing codex_system role also retains read capability. No machine authentication added.
- Data: private session metadata. Capability: `codex.session.read`, assigned to the existing Codex role bundles; other roles require explicit grants through shared authorization.
- Object scope: owner (`createdBy.id` from the validated principal); explicit admin override for reading all history. Both rows and counts use the same scope. Workspace metadata is loaded only for returned sessions.
- Browser mutations/CSRF: none added; existing form mutations retain shared CSRF handling.
- Limits: page 1–10,000, limit 1–24, workspace ID at most 160 characters, literal title search at most 100 characters, allowlisted session status; scalar query fields only. Database operations have a 3-second time limit.
- Rendering: escaped Pug and DOM textContent; no new rich HTML or outbound resources. Existing private media handling unchanged.
- Cache: private, no-store. No analytics added. No outbound calls or file storage added.
- Logs: operational query failures use the shared logger, with error name only; no query, title, identity or database error payloads.
- Retention: unchanged. Negative tests cover authentication/capabilities, owner scope, malformed/oversized input, injection, error privacy and safe rendering.
- Legacy dependency: existing dashboard stats, queue, detail and list APIs retain their behavior. This is an additive scoped read API, not a migration of the legacy feature.

## Behavior and release

Recent Sessions defaults to non-archived sessions ordered by updatedAt descending, then ID descending for ties. Filters include all/archived sessions, exact workspace, and literal case-insensitive title search. Counts cover all matching records, not just the loaded page. Status is session status (pending/active/failed/archived), distinct from running/queued turn status.

History refresh is independent of queue/stats polling. Page 1 refreshes automatically while keyboard focus is outside the history section; older pages remain stable until navigation or an explicit Refresh. Each navigation queries current database records, so concurrent updates can change page boundaries; this is live pagination, not a database snapshot. A now-empty page offers Previous and Latest. Stale responses cannot overwrite newer navigation. Errors keep the last successfully loaded rows and offer Retry.

Graphs use existing three-month token totals and turn status counts. They add no telemetry or dependencies. All detailed metrics and controls remain available.

Deploy through the normal application release/restart process; no environment changes, migrations, dependencies, or new worker tasks. Roll back by reverting this commit and restarting. No production deployment is performed by this change.

## Validation

- Focused Jest checks cover history validation, capability/owner restrictions, query construction and bounds, controller error privacy, filter/pagination states, stale requests, keyboard focus, DOM rendering, charts and existing request controls.
- `npm test -- --runInBand` covers the full repository with its configured coverage thresholds. Use the Volta-pinned Node 24.20.0 (`volta run --node 24.20.0 npm test -- --runInBand` when the shell bypasses Volta).
- Optional Chromium smoke test: `PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser/codexDashboard.smoke.js`. Set `CHROMIUM_EXECUTABLE` if using an existing browser installation. Playwright is deliberately not an application dependency.
- Browser checks use a local Express fixture at 320, 390, 768 and 1440 pixels, including 44px icon targets, no page overflow, keyboard disclosures, retained/submitted prompts, maximize/restore, real HTTP pagination/filter requests, polling/cancel on an older page, price saving and health dialog. Screenshots are written to `/tmp/codex-dashboard-<width>.png`.
- Limitations: browser API responses and Mongoose queries are synthetic/mocked; no live MongoDB or production session was used. Chromium checks do not substitute for Safari/VoiceOver or physical-device testing. No build or general lint script exists; changed JavaScript receives syntax checks and `git diff --check`. No OpenAPI specification changes are needed for this internal UI endpoint.
