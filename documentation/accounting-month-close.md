# Monthly account reconciliation

The `account_db` ledger has no per-record owners. Like the personal Accounting
panel, closing is scoped to the validated principal whose immutable ID matches
`DASHBOARD_PERSONAL_OWNER_USER_ID`. Development validation uses synthetic data;
production figures must remain private during operator verification.

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

The generic admin database viewer denies deletion of `account_dbs`,
`transaction_dbs` and `accounting_write_locks` with HTTP 403, including for the
owner/admin, missing records and the string lock ID `ledger`. These collections
remain readable under the existing admin authorization, with no Delete buttons;
the UI directs users to audited Accounting operations or offline operator lock
recovery. The controller rejects protected writes before any database lookup.
Viewer responses and denials are private/no-store. This is a narrow destructive
access restriction, not a redesign of legacy admin read authorization.

The repository writer inventory found no generic ledger edit/update/import route.
The credit-card CSV importer writes a separate ledger; business seeding reads the
budget ledger and writes business metadata. `setup.js` no longer normalizes or
bulk-updates transaction categories during startup. Existing category strings
remain supported by Accounting; any future category migration requires its own
reviewed offline procedure, consistent backup and stopped writers. Do not revive
the former unordered bulk update: partial migration can occur on standalone
MongoDB, including after a client error. Future generic database mutations must
apply the same protected-collection denial; future dedicated ledger writers must
use the mutex and enforce closed-period protection.

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
The mutex is released only after the callback completes successfully or an
explicit application rejection proves there is no pending mutation (for example,
a closed-period guard, stale review, or acknowledged compare-and-set miss).
Unexpected errors, including driver/network/time-limit failures, retain it and
log an offline-recovery error. A rejected client promise does not prove MongoDB
stopped the write. This deliberately also retains the lock on unclassified read
or validation errors; the operator must establish the actual outcome. A missing
token-scoped lock during release is logged as an operational failure.

The lock applies even with closing disabled or no finalized accounts, across
all accounts and dates. It blocks budget-ledger insertion/deletion, account
creation/deletion and closing; it does not block reads, category definitions, separate
credit-card writes or external-asset writes. Preview/reminder reads do not lock.
This trades availability for consistency on standalone MongoDB: an abandoned
lock can block otherwise unrelated budget accounting indefinitely. It is suitable
only where the operator can accept an outage of unbounded duration until manual
recovery establishes safety.
It is not a general multi-tenant/high-availability accounting design.

Direct database writers and future importers must use this mutex and closed-period
guard, or follow a separately reviewed offline maintenance procedure with all
writers stopped. Backups must be consistent; restores require stopped writers.
Stopping writers alone does not authorize rewriting finalized financial history.
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
  Closing no-store headers are set before parent authentication/capability checks
  and body parsing, including denials on both aliases.
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
  command. Check the executable and Node version of the actual service process,
  not merely the deployment shell. Confirm the service working directory, deployed
  commit and process count through the service manager. Keep `MONGOOSE_URL`,
  `SESSION_SECRET` and normal application settings.
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
  session affinity across every authenticated request (including /mypage), not
  just a load-balancer assumption. A restart requires signing in/reloading and
  reconciling again. If topology/affinity cannot be verified, do not enable live
  closing. No persistent session store or shared review key is added here.
- Confirm DB permissions for `account_dbs`, `transaction_dbs` and the new
  `accounting_write_locks` collection (actual Mongoose collection names).
  Closing updates `balance`, `balance_date`, `closedThrough` and `balanceHistory`
  together in one account-document update. Verify acknowledged writes (never
  `w: 0`) and journal/durability settings with the DB operator. No TTL index may
  exist on the lock. Inspect existing locks before starting; a persistent lock
  requires the recovery procedure, not startup deletion.
- Stop/drain every old app process and any external ledger writer, prevent
  automatic restarts of old code, and take a consistent operator-managed backup
  of `account_dbs` and `transaction_dbs` while writes are stopped (or use a
  consistent full DB backup). Preserve existing histories and confirm that the
  backup is restorable using an isolated restore test, preserving dates, Number
  values, IDs and histories. The existing Dropbox backup covers images only;
  it is not a database backup. Preserve any lock record separately as recovery
  evidence; never restore an old mutex into a running service. Launch only the new
  code through the normal service manager; this repository does not establish an
  exact service-stop/start command.

Production evidence supplied for this hardening task is a read-only preflight,
not proof of the active deployment: it reported a standalone MongoDB, supported
collection/index creation, three eligible accounts and 2,673 transactions passing
baseline/date/precision/magnitude/round-trip and bound checks, and compatible
owner grants. No private values belong in release evidence. Its inspection
checkout was `3b66e1ec236cd0394f541e41f3dcc3bd9e36dc9a`; the actual running revision,
Node executable, process count, service environment and external writer inventory
were not established. Windows blocked service-topology inspection. These remain
manual deployment gates, even though the inspected configuration had a valid
owner and Asia/Tokyo matched. Recheck data eligibility if writers have run since.

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

If a process crashes or a database result is uncertain, the lock deliberately
remains. A persistent busy error or release-failure log requires an operator to stop all ledger
writers, verify no operation is active, inspect the account history/transaction
state for the interrupted write, and only then remove the `ledger` lock record.
Never clear a live lock or add a TTL index. Refresh/reconcile before retrying;
a save may already have committed even if the browser did not receive success.

Exact recovery sequence, for the human DB operator only (never run from the
admin UI, setup, a scheduler, or an automated busy-error handler):

1. Stop **all** app processes, workers, maintenance/import/sync scripts and external
   ledger writers against the intended database. Prevent service-manager,
   scheduled-job and deployment-controller restarts, including old releases.
   Stop/drain in-flight requests. A closed browser, old timestamp, client timeout
   or empty process list on one machine does not establish safety. Have the DB
   operator inspect active operations privately and establish that no ledger or
   account mutation remains in flight. If external writers or server-side work
   cannot be ruled out, **leave the lock intact and keep writes disabled**.
2. In an operator-authenticated `mongosh` already connected to the verified app
   database, capture the exact lock for review; do not output it into release logs:

   ```javascript
   const locks = db.getCollection('accounting_write_locks');
   const inspectedLock = locks.findOne({ _id: 'ledger' });
   if (!inspectedLock || typeof inspectedLock.token !== 'string' || !inspectedLock.token) {
     throw new Error('Expected lock missing or malformed; stop and investigate');
   }
   ```

   While writers remain stopped, preserve a private consistent backup of
   `account_dbs`, `transaction_dbs` and this lock record. Inspect interrupted
   account/transaction state against the pre-operation backup, intended request
   and `balanceHistory`. The lock contains token/time, not operation/account IDs;
   do not guess which request it represents. Determine whether an insert/delete
   committed, whether account creation/deletion completed, or whether a close's
   baseline/date/`closedThrough` and history append committed together. A close
   is one atomic document update. Never close twice or reset its baseline merely
   because a success response was lost. If the outcome cannot be established,
   escalate for ledger reconciliation and keep writers stopped; lock removal is
   not data repair. Do not replay an uncertain insertion blindly.
3. Only after the state review, backup and continued quiescence are verified,
   explicitly clear **the captured token**, not a newly read replacement token:

   ```javascript
   const cleared = locks.deleteOne({
     _id: 'ledger', token: inspectedLock.token, startedAt: inspectedLock.startedAt,
   }, { writeConcern: { w: 1, j: true } });
   if (!cleared.acknowledged || cleared.deletedCount !== 1) {
     throw new Error('Inspected lock was not cleared exactly once; stop and investigate');
   }
   ```

   Any error, changed/missing lock or uncertain delete acknowledgment requires
   another offline inspection; do not broaden the predicate, automatically retry,
   re-read and adopt a different token, drop the collection, add a TTL or clear a
   live lock. Record the operator, reviewed revision, time, outcome and backup
   reference privately without putting tokens/financial values into app logs.
4. Resume only the reviewed release and verified writer topology. Sign in/reload
   Accounting and /mypage, reconcile actual balances privately, and generate a
   new review before retrying a user-confirmed close. Watch category `accounting`
   for repeated busy/acquisition, uncertain-outcome and release-failure messages.
   A release failure can be logged even when the preceding write returned success.

Rollback requires stopped/drained writers and a fresh consistent backup first.
Before any live close, code rollback is possible only after resolving any uncertain
write/held mutex; old writers do not honor it. After a close, prefer rolling
forward with these guards retained. Older code, including `eff4484`/`bdde0ccc`,
allows the admin bypass; pre-feature code also lacks closed-period protection.
Do not resume those writers on finalized data. Retain baselines, histories and
transactions; do not restore an older account snapshot over newer transactions
or clear a mutex as part of rollback. Any full-data restore must be reviewed as a
coherent ledger recovery, including subsequent writes and human reconciliation.

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
- Hardening: `controllers/admincontroller.js`, `public/js/database_viewer.js`,
  `app.js`, `setup.js`; regressions in `tests/unit/adminDatabaseViewerAccounting.test.js`,
  `tests/unit/setupAccountingSafety.test.js` and the mutex/body suites.
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

Hardening checkout verification: worktree initially clean on `main` at
`bdde0ccc8f26f50464792516fc2ed21c45ae60a5`, whose direct parent is
`eff4484814c8d310b1db2e18f1237f1f7f40cccd`. The shell initially selected Node
24.12.0; release tests explicitly use installed Node 24.20.0. This work does not
establish or modify the production runtime. No production deployment, live close,
setup main pipeline or sync service is part of development validation.

This hardening validation on Node 24.20.0:

- Focused Jest run: **15 suites / 173 tests passed** (3.595 seconds), covering
  reconciliation, both route aliases, balance arithmetic/continuity, dashboard
  balances/reminders and tasks, ledger conflicts, admin protected collections,
  startup maintenance, authorization and pre-parser denial caching.
- Full `npm test -- --runInBand`: **293 suites / 2,938 tests passed**, zero
  snapshots (71.213 seconds), with configured coverage thresholds satisfied.
  Collected coverage: statements 71.78%, branches 50%, functions 80.79%, lines
  72.64%. The original shell's Node 24.12.0 was not used for these runs.
- `git diff --check` passed. Database/integration imports in the new tests are
  stubbed; the lost-acknowledgment scenario simulates a later server-side commit
  and verifies subsequent writers cannot run. This is not a real MongoDB crash,
  network-partition or durability test. JSDOM verifies viewer controls, and HTTP
  tests render the closing form; live desktop/mobile layout remains an operator
  check. No real account was reconciled or approved by this work.
