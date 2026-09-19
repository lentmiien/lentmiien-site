# My account document scrolling

The dashboard displays every currently rendered row at its natural height. Query
limits, ordering, filters, hidden/collapsed preferences and the responsive grid
are unchanged. No server, permission, database or configuration changes are needed.

Removed constraints:

- Shared summary lists (including recent chats): 350px maximum height, internal
  vertical scrolling and scroll containment.
- Task list: 350px maximum height and internal vertical scrolling.
- Dashboard cards: overflow clipping. Long text wraps; task links can shrink
  within their columns without introducing horizontal page overflow.
- Lazy Life log point list: the shared 180px scrolling viewport is overridden
  only inside `.account-dashboard`.
- Dashboard Life log map: touch-start cancellation. Native taps still place or
  move points through the click handler; swipes can scroll the document.

Deliberate exclusions: Customize and Tools dialogs keep their viewports and
modal scroll locking. Native form controls, the small task hold progress graphic,
and body-map/point-preview coordinate surfaces retain their sizing and clipping.
They are controls/graphics, not dashboard content lists. The standalone Life log
retains its existing point-list styles and touch behavior.

## Repeatable checks

Run the focused Jest checks:

```sh
npm test -- tests/unit/accountDashboardLayout.test.js tests/unit/accountDashboardClient.test.js tests/unit/accountDashboardTaskClient.test.js tests/unit/accountFormsIntegration.test.js tests/unit/mypageTaskHolds.test.js --coverage=false --runInBand
```

Run the browser regression using separately installed Playwright, Chromium and
the exact Bootstrap 5.3.3 stylesheet used by the shared layout:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROMIUM_EXECUTABLE=/absolute/path/to/chrome \
BOOTSTRAP_CSS=/absolute/path/to/bootstrap-5.3.3.min.css \
node tests/browser/accountDashboardLayout.cjs
```

The fixture binds only to loopback, renders the real Pug templates, loads the
actual shared/page CSS and dashboard/task/Life log JavaScript, and supplies
synthetic API responses. It never starts `app.js`, connects to MongoDB, reads
credentials or sends production requests. Other external resources are blocked.

Checks at 320px, 390px and 1440px cover all 17 sections, long/unbroken text,
initial and longer refreshed lists, lazy Life log reminders/follow-ups/points,
card containment, absence of internal content viewports, page width, responsive
columns, collapse/expand, hidden sections and saving preferences through a mock
endpoint. Wheel scrolling is checked at all widths; emulated touch swipes over
chats, tasks, points and the body map are checked at both phone widths. Native
map taps are checked too. Screenshots are written to the system temporary
directory as `mypage-layout-<width>.png` and `mypage-layout-life-<width>.png`.

These are fixture checks in Chromium, not a real authenticated UI check or a
physical-phone/Safari test. JSDOM tests check the CSS cascade and dynamic DOM;
only the browser check validates measured layout and scrolling.

Deployment is separate: use the normal release process, ensure the updated
`account_dashboard.css` is served after any asset cache refresh, and restart the
application normally so startup form-asset fingerprints include the Life log script. No
migration, new dependency or environment variable is required.
