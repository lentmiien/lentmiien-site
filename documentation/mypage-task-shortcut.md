# My Page task completion shortcut

## Behavior and release notes

Hold one todo/tobuy for 900 ms to complete it. A progress track fills throughout
the hold. Clicking an item or the section background still opens
`/scheduleTask/upcoming`; keyboard users retain ordinary links and that page's
completion buttons. Movement over 10 CSS pixels, scrolling, leaving the item,
pointer cancellation, a second pointer, Escape, or losing focus cancels an
unfinished hold. Releasing early preserves normal click navigation.

Only a confirmed successful response removes the selected item. Pending requests
cannot be duplicated. Failed requests keep the item and show an accessible error;
reload before retrying if a response was lost, since the server may have saved it.
After the last item, the section shows the existing “Show all tasks” link. There
are no displayed counts to adjust.

Completion shares the Upcoming page's task save and pending Pushover reminder
cleanup. Todo and tobuy both set `done: true` on one owner-scoped document.
An already-completed task still gets reminder cleanup, but is not saved again,
preserving its completion timestamp when the shortcut is retried.
The Task model has no recurrence rule or completion hook that creates another
occurrence; similarly titled tasks and any metadata remain untouched.

Deploy through the normal application release/restart process, including both
server files and static assets. No new dependency, environment variable, database
migration, secret, or Cloudflare change is needed. Keep private pages/API responses
out of edge caches. The existing `CSRF_ALLOWED_ORIGINS` configuration applies.
Rollback by reverting this change and restarting. No production inspection,
deployment, or production mutation is part of release preparation.

## Security contract

- Feature: My Page individual task completion shortcut.
- Security zone: logged-in; interactive principals: admin, family, user;
  machine principals: none; data classification: private.
- Capability: `schedule.task.complete`, explicitly bundled for admin, family,
  and user as an owner-only personal operation. Other roles require an explicit
  semantic grant through the shared evaluator. No admin ownership override.
- Object scope: owner, using legacy `Task.userId` and validated principal `name`;
  only `todo` and `tobuy`. Foreign/missing/presence IDs produce the same 404.
- Browser mutations: PATCH `/mypage/api/tasks/:id/done`, shared session CSRF
  token and Origin validation. The legacy completion route lacks these controls,
  so the shortcut uses a secured adapter sharing its completion implementation.
  Existing scheduling pages/routes retain their behavior.
- Request/work limits: one 24-hex task ID, body exactly `{ done: true }`, no query
  parameters, application body-size limit, one owner-scoped lookup/save and bounded
  existing reminder cleanup; one pending browser request at a time, no auto-retry.
  No public/secret-public access or new uploads, files, or outbound integrations.
- Output: escaped Pug attributes/text, DOM `textContent`, no inline task JSON.
- Cache: private/no-store for My Page and new API; My Page analytics disabled.
- Logs: stable failure message, category and error name only; no task text,
  credentials, token, or personal payloads. Existing reminder failure logging
  remains in the shared completion flow.
- Retention: existing task/reminder lifecycle; no new stored data.
- Negative tests: anonymous/incomplete principal, missing capability, role/grant
  matrix, foreign/missing/presence task, invalid ID/body/query, GET, CSRF/Origin,
  save/reminder failures, and safe rendering. Legacy name ownership is retained;
  no ownership migration or broader legacy endpoint rebuild is included.

## Verification

Focused Jest tests cover pointer gestures, navigation, progress, failure recovery,
template rendering, the secured route and shared completion semantics. Use a local
fixture with synthetic tasks for visual testing; do not start `app.js` or the
`npm start` pipeline merely to smoke-test this feature.

Before deployment, verify on the target touch device that vertical page scrolling
and horizontal long-title scrolling cancel the hold and that a successful hold
never opens Upcoming Tasks. Confirm the existing completion page still works.

Release-preparation validation (2026-09-07): Node 24.20.0; all 7 focused Jest
suites / 90 tests passed, and the full suite passed (243 suites / 1,859 tests,
coverage thresholds met). Isolated Chromium checks with synthetic Pug data and
mock completion responses passed for normal item/background navigation, filling
progress, mouse and touch completion, click suppression after removal, API
failure recovery, touch movement and horizontal-title-scroll cancellation,
keyboard navigation, and the existing Upcoming page's completion button.
Desktop and 390-pixel mobile
screenshots were visually reviewed. No connected browser was available; these
checks used local headless Chromium and made no production requests. Physical
iOS/Safari device behavior remains a release smoke check.
