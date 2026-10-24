# My Account overview

The overview always appears before the customizable cards and scrolls with the
document. Hiding or collapsing a card below does not hide its overview summary.
It includes the welcome, Tokyo date, Customize account and User settings controls.
Each source shows at most two previews, a count, and a link to its full tool.

## Security contract

- Zone: logged in; session principals only; private and sensitive account data.
- Capabilities: `dashboard.account.read` plus each existing section's grants and
  constraints from `accountSurfacePolicy` (shared authorization). Accounting also
  requires `finance.account.close`. No new grants or role changes.
- Scope: tasks belong to the validated username; chats require membership even
  for admins; cooking is the entitled shared household plan with owner-scoped
  recipe details. Life Log and accounting require the configured personal owner,
  with no admin override. Ask Lennart and Codex retain explicitly admin-managed
  operations scope and their semantic capabilities.
- API: read-only `GET /mypage/api/overview`, with no query parameters. No browser
  mutations, CSRF changes, uploads, external services, files or provider calls.
- Limits: existing 100 requests/minute/principal dashboard budget; at most four
  source loaders concurrently; database queries have a two-second timeout and
  bounded results. Two previews per group; counts are calculated in the database.
  Life Log and account-baseline scans allow 100 records and fail visibly beyond
  that. Cooking reuses the bounded 12-meal adapter and labels its count as a lower
  bound if the source limit is reached. No automatic polling.
- Rendering: escaped Pug shell and textContent DOM updates; only local links.
  No prompts, transcripts, life-log values, balances or account identifiers in logs.
- Privacy: private/no-store API and fetch, no analytics; no persistence or changes
  to source retention. Unauthorized source metadata and counts are omitted before
  any source read. Source failures are independent and visible, with fixed warnings
  and source IDs only. Unknown totals are never represented as zero.
- Negative tests: anonymous/missing surface grants; source capabilities; foreign
  owner and nonmember filters; unknown query parameters; inert text/URLs; generic
  failures, safe diagnostics, resource bounds and no-store headers.
- Legacy dependencies: reuse existing cooking and reminder rules through scoped
  adapters. Existing cards, completion controls and preferences stay available.
  No migration, dependency or environment change. Deploy web/assets together and
  restart normally; `/mypage` and its APIs must continue to bypass CDN caching.
  Rollback is code-only; no records or preferences are changed by this feature.

## Time and preview rules

- Tasks: incomplete todo/buy tasks whose start is absent or has arrived, with an
  inclusive deadline from now through now + 24 hours, earliest deadline first.
  Overdue, future-start and undated tasks remain in the existing full sections.
- Cooking: today's date in Asia/Tokyo, using the existing cookbook links.
- Life Log: all due reminders among up to 100 enabled schedules, oldest due first,
  using Tokyo calendar dates and the latest nonfuture entry for each type/label.
- Accounting: only baselines still eligible for closing the previous Tokyo month;
  links open the existing review/confirmation flow, never perform a close.
- Ask Lennart: pending requests, oldest first; only request type and time.
- Codex: queued/running turns grouped by session, running sessions first; links
  open the session and duplicate turns do not inflate the session count.
- Chats: member conversations updated from now minus six hours through now,
  inclusive, most recent first. Future timestamps are excluded.

Manual refresh updates the overview independently of the full cards. Empty,
loading and failed summaries have distinct states. Existing page sections remain
hideable, reorderable and collapsible using Customize account.

## Verification

Focused checks use synthetic fixtures and do not start `app.js` or read credentials:

```sh
npm test -- tests/unit/accountOverviewData.test.js tests/unit/accountOverviewClient.test.js tests/unit/accountDashboardRoute.test.js tests/unit/accountDashboardLayout.test.js tests/unit/accountDashboardClient.test.js tests/unit/accountDashboardData.test.js tests/unit/accountSurfacePolicy.test.js tests/unit/accountDashboardTaskClient.test.js tests/unit/accountDashboardLinks.test.js tests/unit/accountFormsIntegration.test.js --coverage=false --runInBand

PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/path/to/chrome BOOTSTRAP_CSS=/path/to/bootstrap-5.3.3.min.css node tests/browser/accountOverview.cjs
```

The browser check uses the real Pug, shared/theme CSS and dashboard JavaScript at
320, 390, 768 and 1440 pixels. It checks the bounded previews, page scrolling,
keyboard dialog/focus behavior, long titles, refresh/empty/error states and
independence from hidden cards. Synthetic screenshots are saved in the system
temporary directory as `mypage-overview-<width>.png`. The existing
`tests/browser/accountDashboardLayout.cjs` additionally checks the full cards,
saved customization, lazy Life Log forms, wheel/touch scrolling and containment.

Counts/filtering are tested against query contracts and synthetic results; these
checks do not measure live MongoDB query plans. Physical-phone/Safari behavior and
an authenticated read against production data remain deployment verification.

Validation on Node 24.20.0: full Jest run passed 433 suites / 5,769 tests, with
17 suites / 261 tests skipped and all configured coverage thresholds satisfied.
Focused overview/dashboard checks and Chromium checks passed at all listed widths.
