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

Before the first live close, back up the account baseline records and ledger
using the normal operator procedure. In the authenticated owner session, verify
three accounts are represented, compare calculated figures privately, and close
only after the human reconciliation. Check the prior-month-end date and the
current balance's continuity on Accounting and /mypage; check that reminders
vanish on refresh. Verify another admin cannot access closing and Cloudflare
never caches these private responses. Do not include financial screenshots in
public release evidence.

If a process crashes during a write, the lock deliberately remains. A persistent
busy error or release-failure log requires an operator to stop all ledger
writers, verify no operation is active, inspect the account history/transaction
state for the interrupted write, and only then remove the `ledger` lock record.
Never clear a live lock or add a TTL index. Refresh/reconcile before retrying;
a save may already have committed even if the browser did not receive success.

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

Release verification on Node 24.20.0: all 290 Jest suites / 2,910 tests passed,
including configured coverage thresholds. Focused suites and `git diff --check`
also passed. Tests used synthetic ledger data and mocked database operations;
no production connection, startup pipeline, deployment or live close was run.
HTTP tests render the actual Pug form and exercise its authorization and POST
controls. Visual browser verification was unavailable because no browser was
connected; check desktop/mobile layout during the operator's live verification.
