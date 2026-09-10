# Monthly account reconciliation

The `account_db` ledger has no per-record owners. Like the personal Accounting
panel, closing is scoped to the validated principal whose immutable ID matches
`DASHBOARD_PERSONAL_OWNER_USER_ID`. No balance or transaction data was inspected
when implementing this feature.

## Workflow and conventions

1. Enter all transactions affecting each tracked account through today.
2. Open **Finalize previous month** from Accounting, the /mypage Accounting panel,
   or an automatic reminder in /mypage's task panel.
3. Compare the calculated current balance with the official figure in its own
   currency. Both checkboxes start unchecked: transactions are complete through
   today, and the calculated current balance matches the official figure.
4. Save each account separately. The page reloads with the remaining accounts.
   An account disappears from the next task-panel refresh when its baseline is
   at or beyond the prior month's final day. Refresh /mypage after closing.

Calendar dates are YYYYMMDD, interpreted as end of day; Tokyo determines today
and the prior month, including January rollover and leap years. Only entries
strictly after the saved baseline and through today enter current balances.
Payers lose amount plus payer fee; receivers gain amount minus receiver fee.
Both sides apply for transfers, including self-transfers. Types do not change
balance signs; currencies are never combined or converted by this feature.
The separate credit-card ledger is not added again.

The saved closing balance is the baseline plus movements through the prior
month's last day. Current-month movements are excluded. A years-old baseline
can move directly to that date without inventing intermediate reconciliations.
An account with an equal/newer baseline is not eligible and is never rolled back.
Future-dated entries are excluded from today's reconciliation and remain intact.

Every save recomputes a server-signed review fingerprint bound to the principal,
calendar day, account fields and ordered relevant transactions. Changed entries
(including offsetting changes), a changed baseline, repeat submits, another tab's
save, day/month rollover, or application restart invalidate an old review.
No browser-supplied balance/date is accepted. Saves use an atomic baseline
compare-and-set and append the old baseline and new close to `balanceHistory`.

/mypage reuses the previous/current-month spend read and fetches only older,
non-overlapping history where a baseline requires it. It never shows a stale
snapshot as current. Invalid data gives an unavailable message; read limits
fail visibly instead of displaying truncated totals. Decimal arithmetic is
exact for the existing Number values (up to 20 decimal places, safe magnitude),
and a proposed balance that cannot round-trip through the Number schema is
rejected rather than rounded. No currency-specific rounding is introduced.

The existing credit-card workflow exposes pending-confirmation alerts and
explicit confirmation; this checkout does not contain a scheduled-task
creation workflow for it. Account reminders are derived on read, owner scoped,
and cannot be completed with the normal task hold/Space gesture. They create
no Task records and need no scheduler or task migration.

## Write coordination and historical protection

All repository budget-ledger insertion/deletion paths and account create/delete
paths now share a database mutex (`accounting_write_lock`, `_id: ledger`) with
month closing. Concurrent writers fail with a retryable conflict rather than
racing the baseline calculation. This works on standalone MongoDB; it does not
require replica-set transactions or new dependencies. It is deliberately a
non-expiring lock: an expired lease could allow overlapping writers.

Once explicitly closed, transactions affecting an account on/before its
`closedThrough` date cannot be inserted or deleted via these paths. Finalized
accounts cannot be deleted. Existing older baselines remain grandfathered until
explicit confirmation. All transactions remain stored; no reconciliation
rewrites, deletions, or intermediate monthly snapshots occur. For corrections,
use an appropriate open-period correcting entry after reviewing its accounting
meaning. Reopening reconciled history is outside this feature.

Ordinary contention does not queue or retry automatically: it returns HTTP 409
with "The ledger is busy. Retry shortly; contact the operator if this persists."
Closed-period rejection is also 409, but instructs the user to use an open-period
correction. The Accounting transaction form retains unsaved input on failure;
rejected deletion retains the row and restores its button. Only an acknowledged
write shows success. A lost network response can still follow a committed write:
inspect/refresh the ledger before retrying an uncertain transaction insertion.

The lock applies even with closing disabled or no finalized accounts, across
all accounts and dates. It blocks budget-ledger insertion/deletion, account
creation/deletion and closing; it does not block reads, categories, separate
credit-card writes or external-asset writes. Preview/reminder reads do not lock.
This trades availability for consistency on standalone MongoDB: an abandoned
lock can block otherwise unrelated budget accounting indefinitely. It is suitable
only where the operator can accept a short coordinated outage and manual recovery.
It is not a general multi-tenant/high-availability accounting design.

Direct database writes, backups/restores and future importers must run while
application writers are stopped or use this same mutex and closed-period guard.
No automatic workflow has authority to close accounts.

## Security contract

- Feature/zone: monthly account baseline close; logged in.
- Interactive principals: configured personal owner only; no machine principals.
- Classification: sensitive finance data. No outbound services or new media.
- Capabilities: `finance.account.close` plus existing accounting/budget access.
  Admin receives the semantic capability by default; family/user receive none
  unless explicitly granted via the shared evaluator. All roles, including
  admin, must match the configured personal owner; no admin scope override.
- Object scope: the existing single-owner ledger, guarded before any record read
  or write. Missing account IDs are generic 404; foreign principals are denied
  before lookups. Identity comes only from the authenticated principal.
- Browser writes: POST only, shared session CSRF token and Origin validation.
  Strict five-field allowlist, exact checkbox values, ObjectId/review validation;
  4 KiB body limit before the legacy parsers; 20 requests/minute per principal.
- Bounded reads: 100 accounts; 50,000 relevant transactions per account review;
  five-second database query limits. Dashboard retains its two-second query
  budget and 2,000 spend/50,000 older-transaction limits. No truncated balances.
- Rendering: escaped Pug, native forms, theme tokens; no custom inline scripts.
  Private/no-store, no-referrer, noindex, analytics disabled on closing pages.
- Logs: shared logger for unavailable reads, failures and lock recovery. No
  balances, transaction content, request bodies, account names or tokens logged.
- Retention: replaced baseline/confirmed principal/time retained in the account
  document, alongside the financial ledger; no automatic expiry/deletion.
- Negative tests: authentication/capability/owner, CSRF/Origin, malformed and
  excessive input, forged/stale/repeated reviews, precision and calendar edges,
  closed-history mutation and concurrency. Legacy surrounding routes retain
  their existing authorization and are not redesigned by this addition.

## Release and live verification

No startup script, database migration, new secret or dependency is required.
Use the existing confirmed `DASHBOARD_PERSONAL_OWNER_USER_ID`; missing/invalid
configuration disables closing. Do not infer the owner from account names.
Verify MongoDB can create/write the new lock collection and appended schema
fields. Roll out with old application workers stopped: old processes do not
participate in the mutex. Do not run `npm start` as a verification command;
its prestart mutates data and may synchronize Dropbox.

Operator preflight (configuration names only; do not publish their values):

- Use Node 24.20.0 from `package.json`; `npm ci` is the existing clean-install
  command. Keep `MONGOOSE_URL`, `SESSION_SECRET` and normal application settings.
  `OPENAI_API_KEY` remains a normal startup-preflight dependency, not a new
  accounting requirement. Never run `setup.js` as a backup or smoke test.
- The owner key already exists in `env_sample`; this release does not set it.
  Privately verify it against the intended validated Useraccount `_id`, and verify
  the owner's `accounting` or `budget` grant. `finance.account.close` is bundled
  for admin; other owners need an explicit grant. The /mypage Accounting card also
  requires `dashboard.account.read` and `dashboard.personal.read`; its task card
  requires dashboard access and `scheduletask`.
- Preserve working `CSRF_ALLOWED_ORIGINS`, `TRUST_PROXY`, `SESSION_COOKIE_SECURE`
  and `SESSION_COOKIE_SAMESITE` settings for the HTTPS origin. Closing reuses the
  existing session and CSRF mechanism; do not weaken these to bypass a failure.
- Keep the review GET and confirmation POST on the same live app process.
  Review signatures use a per-process random key, and `app.js` uses in-memory
  sessions. A single process is supported; multiple workers require existing
  session affinity. A restart requires signing in/reloading and reconciling again.
- Confirm DB permissions for `account_dbs`, `transaction_dbs` and the new
  `accounting_write_locks` collection (actual Mongoose collection names).
  Closing updates `balance`, `balance_date`, `closedThrough` and `balanceHistory`
  together in one account-document update. No TTL index may exist on the lock.
- Stop/drain every old app process and any external ledger writer, prevent
  automatic restarts of old code, and take a consistent operator-managed backup
  of `account_dbs` and `transaction_dbs` while writes are stopped (or use a
  consistent full DB backup). Preserve existing histories and confirm that the
  backup is restorable. Launch only the new code through the normal service
  manager; this repository does not establish an exact service-stop/start command.

Before the first live close, ensure the backup covers the reconciled ledger.
In the authenticated owner session, verify all intended eligible accounts are
represented (there is no fixed three-account requirement), compare figures privately, and close
only after the human reconciliation. Check the prior-month-end date and the
current balance's continuity on Accounting and /mypage; check that reminders
vanish on refresh. Verify another admin cannot access closing and Cloudflare
never caches these private responses. Do not include financial screenshots in
public release evidence.

Open `/accounting` (or `/budget`) and click **Finalize previous month**, which
opens `/accounting/close-month/` (or `/budget/close-month/`). Alternatively use
/mypage **Accounting**, or **To do & to buy** → **Automatic accounting** →
**Finalize previous month · [account]**. Confirm **Calculated current balance
through today — compare with official figure**, **Current-month net movement**
and **Balance to save at [date]**. Check both **I have entered all transactions
affecting this account through today.** and **I confirm this calculated current
balance matches the official figure.**, then click **Save confirmed month-end
balance**. There is no additional dialog. Expect a 303 redirect and the saved
status on the refreshed page. Refresh the review after any correction or restart.
Use /mypage refresh/reload to verify its accounting balance and reminder removal;
the underlying reads are `/mypage/api/cards/accounting` and
`/mypage/api/cards/tasks`. Check desktop/mobile layout and uncached responses on
both closing aliases and /mypage; verify a different admin receives no close data.

If a process crashes during a write, the lock deliberately remains. A persistent
busy error or release-failure log requires an operator to stop all ledger
writers, verify no operation is active, inspect the account history/transaction
state for the interrupted write, and only then remove the `ledger` lock record.
Never clear a live lock or add a TTL index. Refresh/reconcile before retrying;
a save may already have committed even if the browser did not receive success.

Exact recovery sequence, for the human DB operator only:

1. Stop all application/maintenance/import writers against this database and
   disable their automatic restart. Stop old and new versions, not just the
   browser session. Have the DB operator verify no in-flight ledger/account
   operation remains, including requests whose client timed out. Lock age alone
   does not prove this; do not clear the record if quiescence cannot be established.
2. Preserve a private backup of the current account/transaction state and lock
   record. Inspect `accounting_write_locks` for `_id: 'ledger'` and `startedAt`.
   The lock records a token/time, not the operation or account. Use the interrupted
   request context and inspect the ledger plus account `balanceHistory` privately.
   Check whether insertion/deletion/close already committed. A close's new baseline
   and history append are atomic; do not apply the close twice or restore an old
   baseline merely because the response was lost.
3. Only after steps 1–2, in an operator-authenticated `mongosh` already connected
   to the intended application database, remove only the inspected lock:

   ```javascript
   const locks = db.getCollection('accounting_write_locks');
   const stale = locks.findOne({ _id: 'ledger' });
   // Execute only with all writers stopped and the interrupted state reviewed.
   if (stale) locks.deleteOne({ _id: 'ledger', token: stale.token });
   ```

   Expect exactly one deletion if a lock existed. If not, stop and investigate
   instead of broadening the delete. Never drop the collection, clear a live lock,
   add a TTL, or automatically run this on startup.
4. Resume only the reviewed release, sign in/reload the ledger, reconcile its
   actual state and regenerate the review before any retry. Watch category
   `accounting` for repeated busy/acquisition/release failures. A release failure
   is logged even when the preceding write returned success.

Rollback before any live close is a normal code rollback. After closing, retain
new baselines, histories and transactions: older accounting computations still
use the same strictly-after-date semantics. An older release lacks the new
closed-period write protection, so avoid legacy historical mutations or retain
the write guard. Do not automatically restore older balances over newer closes.

## Implementation map and verification

- Calculations: `utils/accountBalances.js`, `services/budgetService.js`.
- Closing: `services/accountingCloseService.js`, `routes/accountingClose.js`,
  `routes/accounting.js`, `controllers/accountingController.js`,
  `views/accounting_close.pug`, `views/accounting_dashboard.pug`,
  `public/css/accounting_close.css`.
- History and write coordination: `models/account_db.js`,
  `models/accounting_write_lock.js`, `services/accountingLedgerWrite.js`,
  `controllers/budgetcontroller.js`.
- Dashboard and access: `services/accountDashboardData.js`,
  `services/accountSurfacePolicy.js`, `middleware/accountSurfaceBody.js`.
- Focused tests: `tests/unit/accountBalances.test.js`,
  `tests/unit/accountingCloseService.test.js`,
  `tests/unit/accountingCloseRoute.test.js`,
  `tests/unit/accountingLedgerWrite.test.js`,
  `tests/unit/accountDashboardData.test.js`, `tests/unit/budgetService.test.js`.

Original feature verification on Node 24.20.0: all 290 Jest suites / 2,910 tests passed,
including configured coverage thresholds. Focused suites and `git diff --check`
also passed. Tests used synthetic ledger data and mocked database operations;
no production connection, startup pipeline, deployment or live close was run.
HTTP tests render the actual Pug form and exercise its authorization and POST
controls. Visual browser verification was unavailable because no browser was
connected; check desktop/mobile layout during the operator's live verification.

Release-readiness follow-up: independently reran the six original focused suites
(90 passing tests), found and fixed false success on rejected ordinary ledger
writes, and added `tests/unit/budgetDashboardWrites.test.js` plus shared-error-
handler checks in `tests/unit/accountingLedgerWrite.test.js`. The 11 new cases
cover busy/closed-period responses, network failures, missing acknowledgments,
retained input/rows and successful writes. All 291 suites / 2,921 tests then passed
on Node 24.20.0 with coverage thresholds; `git diff --check` passed. The browser
script tests use JSDOM, and database tests use mocks; no real MongoDB crash test,
production configuration check, visual browser session or deployment was performed.
