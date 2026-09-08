# Task planning repair — 2026-09-08

My Page now shows Overdue, Due today, Ongoing and Upcoming task groups, with both
available dates and explicit “Available anytime” / “No deadline” labels. Its task
links use the full row width: 900 ms holds remain, Space completes on key release,
and Enter/click opens Upcoming Tasks. Completion still waits for server acknowledgement.
The planning page again renders all owner-scoped incomplete todo/tobuy tasks into
months, including far-future months. Page-specific `taskGroups` and `overdueTasks`
locals avoid the layout's navigation `groups` collision; shared navigation is unchanged.

## Date rules and limits

- All displayed dates, deadline days and planning months use Asia/Tokyo, independent
  of the server/browser timezone. Dates show year, month, day, hour and minute.
- My Page includes starts less than or equal to one captured `now + 14 × 24 hours`.
  Exactly at that instant is included; one millisecond later is excluded. This is
  a rolling instant boundary, not the end of the fourteenth calendar day.
- Null and absent starts mean available anytime. A start at/before now is available;
  a later start is scheduled Upcoming until its instant arrives.
- Only an actual deadline before Tokyo midnight starting today is Overdue. Today's
  deadline interval is `[today 00:00, tomorrow 00:00)`; deadlines remain due today
  even after their clock time passes. Tomorrow midnight is not due today.
- Status precedence is Overdue, then future-start Upcoming, then Due today, otherwise
  Ongoing. Overdue remains visible within My Page's start window even with a missing
  start. For inconsistent records with a future start and a past deadline, the deadline
  is marked Overdue, and the start-window rule still applies.
- Missing deadlines never expire from start alone. Both missing means Ongoing.
  Started tasks with future deadlines are Ongoing; both available dates remain visible.
- My Page retains its existing bounded query budgets (12 overdue deadlines, 12 today,
  16 later/missing deadlines; at most 40 total). The start predicate applies before
  each query's limit. Groups are ordered by status, then planning date, then ID.
  The full planning page is the destination for records beyond these summary budgets.
- Upcoming Tasks has no two-week cutoff or new row limit. Overdue is shown first;
  remaining tasks use deadline month, otherwise future-start month, otherwise current
  month. No synthetic deadline is displayed for an undated task. An ongoing task with
  a future deadline remains in that deadline's month, with an Ongoing status.
- Both views exclude completed tasks and presence events through owner-scoped queries.
  Display availability and overdue status never block the existing completion operation.
  Dates/status are snapshots refreshed by reload or the My Page card's Refresh control.

## Security and scope review

This is maintenance of existing logged-in views and the existing completion operation,
not a replacement scheduling feature. The [dashboard contract](account-dashboard.md)
and [completion contract](mypage-task-shortcut.md) continue to apply: private task data,
validated-principal name ownership with no admin bypass, existing surface/tool grants,
`schedule.task.complete`, shared CSRF/Origin protection on the My Page PATCH, bounded
inputs and private/no-store responses. Space uses that same secured PATCH and shares
pending-request suppression, error announcements and focus restoration with holds.
No new route, mutation authority, capability assignment or external integration is added.
Pug escaping and DOM textContent keep synthetic injection fixtures inert. Upcoming
read failures use the shared logger with an error name, without task content.

The legacy Upcoming page's existing completion endpoint and button are preserved;
their older security model is not expanded or migrated in this repair. Negative tests
continue to cover My Page's anonymous/capability/owner/CSRF/Origin/method boundaries.
No schema, dependency, configuration, data migration or stored-data change is required.
No app startup, production connection, personal content, secrets or deployment was used.

## Verification

Node 24.20.0 via Volta. Full `npm test -- --runInBand` passed: 260 suites / 2,025 tests;
all configured coverage thresholds passed. No pre-existing suite failures were observed.
Focused service/query, date, real-layout Pug, client/hold, route-security and form-asset
integration suites passed. Date fixtures include null/absent fields, exact start and
horizon instants, Tokyo day/month boundaries, overdue, future deadlines, completed and
foreign tasks, and far-future plans. Pug regressions run with both empty and populated
navigation groups and verify links and escaped task content.

The isolated Chromium runner uses the actual Pug layout, task scripts, CSS and dashboard
adapter with synthetic model results. It binds only loopback, blocks external requests,
and mocks completion responses. It verifies desktop and 390px mobile rendering, no
horizontal overflow, all future months, click/Enter navigation, 900ms progress and hold,
Space completion/focus, rejection retention, pointer movement cancellation, touch scroll
cancellation and touch completion. Desktop/mobile/planning screenshots were reviewed.
No authenticated live browser or physical iOS/Safari check was performed.

To repeat browser QA, use an independently installed Playwright and Chromium (no project
dependency installation is required):

```sh
TASK_PLANNING_PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
TASK_PLANNING_CHROMIUM=/absolute/path/to/chrome \
TASK_PLANNING_BOOTSTRAP_CSS=/absolute/path/to/bootstrap-5.3.3.min.css \
volta run --node 24.20.0 node tests/browser/taskPlanning.cjs
```

The Bootstrap file is a local copy of the layout's existing stylesheet; no CDN request
is made. Screenshots are written to the OS temporary directory as
`task-planning-desktop.png`, `task-planning-mobile.png`, and `task-planning-upcoming.png`.
The date/query/layout suites also passed under `TZ=America/Los_Angeles`: 3 suites /
37 tests, verifying host timezone independence.

## Release and browser checks for Lennart

1. Review and release the finished commit through the normal release process. Include
   the controller, shared date utility, dashboard adapter, both Pug views, CSS and JS.
   Restart so content-addressed form assets pick up both changed My Page scripts.
   Do not run `npm start` merely as a smoke test; its prestart pipeline mutates data.
2. Check the released commit ID and confirm My Page loads new `/assets/forms/<hash>/`
   URLs for `account_dashboard.js` and `mypage_tasks.js`. Keep My Page/API responses
   outside edge caches and retain the existing CSRF origin configuration. No new
   Cloudflare rule, secret, environment variable, dependency or migration is needed.
3. Sign in as Lennart. Compare synthetic test tasks on both pages: missing dates,
   past start/no deadline, future start/no deadline, started/future deadline, due today,
   overdue, start at the horizon and just beyond it, and a task months/years ahead.
   My Page must exclude only the beyond-window starts (subject to summary budgets);
   Upcoming must show the full plan and navigation. Completed tasks must be absent.
4. On desktop and the target touch device, verify row space, readable Tokyo dates,
   group scrolling and normal link navigation. Hold for 900 ms: one task disappears
   only after success, no accidental navigation. Early release opens tasks; movement,
   scrolling, Escape and focus loss cancel a hold. On keyboard, Tab to the row, Space
   completes once, focus moves sensibly, and Enter opens tasks. Check screen-reader
   announcement of the hint and completion result, especially physical iOS/Safari.
5. Use only disposable synthetic tasks for completion smoke checks in an authorized
   test environment. Verify failure retention, no duplicate requests, missing/invalid
   CSRF or foreign-owner denial, and the existing Upcoming completion interaction.
   This preparation did not create or complete production tasks.
6. Rollback if needed by reverting this repair and restarting; no data rollback or
   migration is involved. This restores the previous UI defects as well.

## Supplied production evidence

The user supplied read-only evidence from deployed `9e655ac89508ef06446f4afdff68da10faab20c9`
identifying the redesign regression; production investigation was not repeated.

- [Evidence session](/codex/sessions/tool-session-bc4aaaf52791a549ec6ad9ff84f75ab75d400ca8a2e4e23529f86c8843eb28ee)
- [Evidence turn](/codex/turns/tool-turn-bc4aaaf52791a549ec6ad9ff84f75ab75d400ca8a2e4e23529f86c8843eb28ee)
