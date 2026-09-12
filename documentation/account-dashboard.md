# My Account and Tools navigation

`/mypage` is an account dashboard with independent cards. Tools moved to the shared,
searchable icon drawer. It preserves original icon IDs, public navigation, bookmarks,
Quick Add, `actionBtn`, `chatmode`, `history_list` and `head_list`. An authorized full
catalog remains discoverable even when shortcuts are hidden. The first eight visible
shortcuts follow the saved order. Native dialogs support Escape, focus containment and
restoration; task links retain 900 ms holds, Space completion and Enter navigation.

## Security contract and inventory

- Feature: account dashboard, navigation catalog, preferences, scoped Life Log entry/body-map
  operations, scoped embedding search.
- Zone: logged in. Public navigation links remain fully public. No machine principals.
- Classification: private account state; sensitive financial, health, device and household data.
- Capabilities: `dashboard.account.read`, `dashboard.preferences.write` default to admin,
  family and user. Unknown roles require explicit grants. Admin additionally receives
  `dashboard.operations.read`, `dashboard.personal.read`, `dashboard.personal.write`,
  `dashboard.embedding.search`. These are narrow **surface** capabilities, never tool grants.
- Existing tool grants are checked through `utils/authorization.js` typed group/user queries.
  Admin does not imply `accounting`, `budget`, `chat5`, `cooking`, `scheduletask`, `ocr`,
  `asr`, `music`, `sora`, `image_gen`, `emergencystock` or `embedding`.
  Codex, Runpod and human-request capabilities reuse their existing role bundles.
- Object scope: validated principal `_id` for preference writes and owned jobs; validated
  principal `name` for legacy task ownership, GPT Image creator and Chat5 membership.
  Chat membership includes shared chats and has no admin bypass. Ownerless Music/Sora
  stores are explicitly shared libraries; ComfyUI bulk is admin operations. Shared 3D
  history requires `shared: true`. Scope/permissions are applied before queries or counts.
- Personal scope: valid `DASHBOARD_PERSONAL_OWNER_USER_ID` must equal validated `req.user._id`.
  Missing/invalid binding denies all personal cards, metadata and catalog aliases, including
  Accounting, Budget, external assets, credit cards, receipt/payroll, Health, Life Log and
  Minute Logger. Personal bookmark destinations and the old `/mypage/life_log` alias are filtered too. No name/email/admin
  identity fallback. Life Log and Minute Logger additionally retain admin constraints.
  The dashboard embedding corpus is owner-only plus `embedding` and the semantic search
  grant. Direct legacy tool authorization remains unchanged.
- Household scope: existing `cooking` / `emergencystock` grants explicitly entitle those
  shared household datasets. Tapo is admin household operations. No global personal
  health/budget statistics are exposed to another admin or ordinary user.
- Browser mutations: POST preferences/Life Log/search and existing PATCH task completion;
  shared session CSRF with Origin validation. GET shell/settings do not write preferences,
  search, refresh providers, or run maintenance. Life Log identity is entirely server-selected.
- Limits: account requests 100/minute/principal; JSON 40 KiB and strict field allowlists.
  Each card query has a 2 second database timeout and bounded projection/list. Client
  concurrency is four; HTTP timeout 15 seconds; manual refresh, no polling. Hidden/collapsed
  cards make no requests until shown/expanded. Failed cards do not break the shell.
  Tasks 40, agenda 20, chats 5, pending summaries 5, Codex 8, pods 30, cooking 12,
  financial accounts 100 and transactions 2,000 (overflow yields unavailable), emergency
  categories 200 and active items 2,000 (overflow yields unavailable). Life Log uses 8 recent
  entries, 10 reminders and a grouped last-entry query; body-map follow-ups cover 48 hours,
  maximum 100 entries with a fixed local body-map image and up to 100 validated points. Entry fields are bounded to 160/1,000/10,000/24,000 characters.
- Search: user-initiated only, six requests/minute and two simultaneous operations/process;
  2,000 character query, newest 500 matching vectors/index, dimension max 8,192, DB timeout
  2 seconds, up to 50 output matches. The existing ranking, deduplication and combined
  reranking algorithms are reused through a bounded adapter. Combined mode sends up to
  50 previews of 2,000 characters to the configured high-quality embedding service.
  Transport timeout 5 seconds/call, no redirects, 120 KB request/4 MiB response maximum.
  The search adapter does not persist embeddings or log query/preview bodies.
- Outbound: no dashboard shell/card providers except explicitly expanded AI Gateway:
  fixed `/gpu`, `/gpu/reservation`, `/containers` paths, 4 second timeout, 256 KiB response,
  no redirects, shared 30 second cache and concurrent-request coalescing. No workload start.
  Embedding uses existing configured trusted embedding endpoints on explicit search.
- Rendering: escaped Pug/textContent and fixed local card destinations; same-origin escaped
  Pug Life Log fragment. No raw prompts, endpoints, IPs, coordinates or provider errors.
  Public/private files and legacy download routes are unchanged; dashboard creates no media.
- Cache/analytics: private no-store, no analytics; CSRF tokens stay in session. Operational
  failures use the shared logger with section names, never record/provider payloads.
- Retention: preferences remain with Useraccount. Source retention is unchanged. Dashboard
  Life Log writes share existing log retention; no new copies, histories or periodic work.
- Negative tests cover roles, typed collisions/revocation, owner binding, aliases, scopes,
  pre-query denial, preference preservation, CSRF/Origin, invalid payloads, JSON auth,
  Tokyo midnight/overlap, finances, stale states, shell isolation, chat hooks and completion.

## Data semantics and deliberate limits

Tasks show Overdue, Due today, Ongoing and Upcoming groups with start/deadline dates.
Only My Page restricts starts to an inclusive now + 14 days; missing starts are available
anytime. Missing deadlines never expire a task. The existing query budgets remain: up to
12 overdue deadlines, 12 deadlines today and 16 later/missing deadlines, each filtered by
start before its limit. The full Upcoming Tasks page has no horizon or row cutoff.
See [task planning release notes](task-planning-release.md) for exact time boundaries,
month grouping and verification. Agenda includes overlapping presences and today's due
tasks using Asia/Tokyo. Cooking is explicitly household data.
Ask Lennart lists safe pending request types and oldest times, never prompts. Codex shows
admin queued/running operations without provider helpers.

Accounting reports ledger expenses including payer/receiver fees, by payer currency, and
compares this month to the prior full month. Transfers and separate card ledgers are excluded
from spending to avoid double counting. Current balances reconstruct all movements strictly
after each dated baseline through today in Asia/Tokyo, using `utils/accountBalances.js`.
No cross-currency grand total or currency conversion is invented.

### Transaction validation and spending failure isolation

An external payment was mistakenly classified as Expense instead of Income. The previous
spending helper required a tracked payer currency and threw before balance rows could render.
The card route returned a generic 503, so one bad spending row hid otherwise valid balances.
Zero pending finalizations and month-end boundaries were not responsible. Monthly close
updates account baselines/history, never transaction types or amounts.

Contract evidence and the maintained rule:

- `transaction_db` stores one amount and payer/receiver fees, account references and a type;
  it has no transaction currency, exchange rate or separate converted amount.
- The legacy entry form labels `EXT` as **Other business** on either side. Its amount label
  assumes the selected accounts share a currency; type is independently selectable. The
  REST form also permits independent account/type selection. Neither previously enforced
  that an expense needs a tracked payer. The owner confirmed the incident was misclassified
  Income; receiving money from `EXT` must not be silently treated as an expense in the
  receiver's currency.
- Explicit types take precedence. With no explicit type, existing readers infer income
  for an external payer, expense for an external receiver, otherwise saving/transfer.
  Income and saving/transfer are excluded from spending, but all types affect account
  balances according to their payer/receiver direction. Supported spending includes both
  fees and remains separated by currency; two selected tracked accounts must agree.
- `budgetService.getSummary()` uses the explicit expense classification and sums amount
  plus both fees without a payer currency lookup or per-currency grouping. That explains
  why `/accounting` could still load; it does not establish that a conflicting entry is
  correct or make its mixed-currency aggregate comparable to this card.
- Both `budgetService.insertTransaction()` (REST aliases `/accounting/api/transaction`
  and `/budget/api/transaction`) and `budgetcontroller.add_transaction_post()` (legacy)
  use `accountingLedgerWrite.insertTransaction()`. It now rejects Expense with `EXT` payer
  with HTTP 422 and a fixed explanation to review type/payer. It accepts Income, Expense
  and Saving/Transfer types (normalizing case/whitespace) and also validates the
  normalized document's date, numeric range/precision and required schema fields before
  acquiring the lock. Existing form coercion is unchanged (the legacy form uses integers).
  Tracked references must be valid IDs and resolve to accounts with one valid shared
  currency, checked under the existing write lock with at most two accounts and a 2s
  query timeout. Validation never guesses or rewrites transaction classification.
- Field errors take no lock; account/currency rejections release the lock without saving.
  Existing finalized-period checks and uncertain-write lock retention remain in force.
  Separate credit-card CSV imports write another ledger and are unchanged. No generic
  transaction import route exists in the inventoried application. Future writers must use
  this writer; direct database writes bypass application validation.

For inconsistent existing expenses (external payer, unresolved/conflicting currencies or
invalid amounts), the card returns HTTP 200 with `state: partial` and a bounded **Spending
summary unavailable** row naming the affected month and directing review in Accounting.
The entire affected month's spending is suppressed across all currencies; the other month
may be shown, but no difference is calculated unless both are complete. Unknown totals
are never displayed as zero. Unexpected spending exceptions also produce an unavailable
spending section. Valid balances and the close-review link remain visible; automatic
per-account tasks remain independently derived and can correctly be empty. Invalid balance
rows explicitly remain unavailable and mark the card partial. Database failures and query
limits still fail visibly; truncated ledgers never become complete figures.

Diagnostics use fixed messages with `stage`, `reasonCode` and (for known spending issues)
`period: current|prior` and aggregate `affectedCount`. Stages distinguish `summary_read`,
`spending`, `balance_history_read`, `balances` and write `transaction_validation`. Reasons
include `EXPENSE_EXTERNAL_PAYER`, `EXPENSE_CURRENCY_UNAVAILABLE`,
`EXPENSE_CURRENCY_CONFLICT`, `EXPENSE_AMOUNT_INVALID`, `SPENDING_TOTAL_OUT_OF_RANGE`,
`SPENDING_CALCULATION_FAILED`, `BALANCE_REVIEW_REQUIRED`, query limits and
`ACCOUNTING_STAGE_FAILED`. Writer reasons distinguish invalid date/amount/fields/accounts,
missing/conflicting currency and lookup failure. Logs contain no record IDs, names, values,
raw errors or database payloads. There is one diagnostic per affected period/reason per
manual card load, rather than per transaction.

This is maintenance within the existing logged-in security contract: existing surface/tool
capabilities, configured personal-owner binding, private/no-store responses, escaped DOM
rendering, request limits and legacy write-route authorization remain unchanged. No routes,
mutation authority, migrations, dependencies, configuration or live-data corrections are
introduced. The existing legacy mutation controls are not rebuilt by this patch.

Release verification (operator steps; not performed against production during development):

1. In an isolated staging ledger, submit an external-payer Expense through each enabled
   REST alias and the legacy form. Expect 422 guidance, no transaction/business creation
   and no retained write lock. The REST form must retain inputs. Correct only Type to
   Income and confirm one acknowledged save and the expected receiver balance. Also test
   normal expenses, same-currency transfers and rejected missing/conflicting currencies.
2. Release the reviewed commit using the normal service process. No migration is required.
   Do not invoke `npm start` as a smoke test: its prestart runs maintenance/sync. Restart
   existing application processes through the established release procedure so adapters
   and the content-hashed dashboard script are refreshed together.
3. Live read-only: sign in as the configured entitled owner, refresh `/mypage` Accounting
   and inspect `GET /mypage/api/cards/accounting`. The already corrected ledger should
   return 200/ready with correct dated balances and spending. Zero pending close tasks
   is valid. Open the close review only; do not confirm it or create test transactions.
4. Check production logs for the new fixed stages/reasons. If a partial state remains,
   review the indicated month/type/currency issue through authorized read-only tools;
   do not assume missing spending is zero or auto-correct records. Confirm another admin
   still receives 403 for the personal card and the API remains private/no-store.
5. In staging with synthetic inconsistent history, verify the warning, intact valid
   balances/close link and honest one-sided/two-sided comparisons on desktop and mobile.
   Rollback is code-only to the previous release; it removes input protection and restores
   the old whole-card failure behavior, but requires no financial-data rollback.

Regression coverage uses synthetic records, actual Mongoose validation without a database
connection, mocked persistence, HTTP route tests and DOM rendering/refresh tests. It covers
external-payer Expense rejection/Income acceptance, safe lock release, finalized empty and
populated ledgers, month comparisons, fees/currencies, Tokyo midnight/month/year/leap-day
boundaries and sanitized logs.

Release validation, 2026-09-12: Node 24.20.0 via Volta. Focused dashboard, ledger,
close, business and controller tests passed (`npm test -- --runInBand --coverage=false`
with the relevant `tests/unit/` paths). The final `volta run --node 24.20.0 npm test --
--runInBand` passed: 294 suites / 2,989 tests; 1 suite / 4 tests skipped. All configured
coverage thresholds passed (71.78% statements, 50% branches, 80.79% functions, 72.64%
lines). `git diff --check` passed. Live financial data, deployment and real browser
screenshots were not part of verification; UI rendering/refresh was checked with DOM tests.

Recent jobs merge at most ten rows from each selected entitled source into ten stable rows.
GPT Image outputs are grouped by generation ID. ASR/GPT Image and Music are saved histories;
they cannot reliably describe currently running work. Sora's generation-stop lifecycle is
shown in navigation; stored library remains accessible. Prompt to 3D history expires. Job
rows intentionally open the correct tool page rather than inventing unsupported deep links.
ComfyUI single generation remains in navigation without a fabricated owned feed.

Runpod displays actual provider status and sync time, never desired state. Minute Logger
shows only the configured device's latest battery/activity/time. Tapo uses dated daily/monthly
kWh snapshots and last-known watts. Missing/stale weather ingestion is never an all-clear.
Emergency stock uses the existing pure snapshot calculation without maintenance or sync.
New model announcements use already loaded provider caches; no refresh occurs here.

The expanded Life Log retains basic/medical entries, diary notes, reminders and body-map
entries/follow-ups. Audio transcription remains in the entitled ASR tool; the legacy Life Log formatting endpoint
is unchanged. The account panel omits the former audio-upload and AI-polish controls rather
than adding new provider mutations. Entry, diary, reminders and body-map functions remain.
The old hardcoded secret-public cooking-request URLs are not republished in the new registry;
public cooking, both calendars and cookbook remain available.

## Deployment and rollback

For form script revisions, CSRF diagnostics and the protected-form audit, see
[the CSRF form repair notes](csrf-form-repair.md).

1. Bind `DASHBOARD_PERSONAL_OWNER_USER_ID` to Lennart's confirmed Useraccount MongoDB `_id`
   in deployment configuration. No live identity/grants were queried or changed during this
   work. Confirm the ID and existing tool grants in the deployment environment.
2. Optionally configure `DASHBOARD_MINUTE_LOGGER_DEVICE_ID` to the intended stored deviceId.
   No personal summary appears without the owner binding. The existing `MINUTE_LOGGER_PATH` also restricts the dataset. Both selectors remain server-only.
3. Keep `CSRF_ALLOWED_ORIGINS` consistent with the deployment origin/proxy configuration.
   Existing AI Gateway/embedding endpoint configuration is reused. No schema migration or
   broad role migration is required. Unknown/custom roles need explicit dashboard capability
   grants; granting these alone never unlocks protected tools or personal scope.
4. `/mypage` and its APIs must bypass CDN caching. No new Cloudflare bypass rules are needed.
5. Preferences use `dashboard_settings` (version 1) and `navbar_settings`. Existing
   `mypage_icon_settings` are read as a fallback and never overwritten. Read-time migration
   has no GET writes. Unauthorized choices survive revocation in storage, but are filtered
   from effective responses. Rollback to the previous code preserves the original icon layout.

## Manual deployment verification

- Sign in as Lennart: confirm only existing granted cards/tools appear; expand personal
  cards, inspect currency/date labels and last-known freshness against their tool pages.
- Sign in as another admin: inspect HTML, customization and API denials for Life Log,
  Minute Logger, Accounting/Budget aliases and embedding. Try missing/invalid owner config.
- Sign in as ordinary/explicit-grant users: verify own chats/jobs/tasks only and no shared
  sources under Mine. Verify Shared filters and legacy tool links.
- Desktop/mobile: search Tools, expand subgroups, use Tab/Shift+Tab/Escape, restore focus;
  confirm chat history/action hooks and bookmarks. Verify no horizontal overflow.
- Save/reorder/hide/collapse/reset sections and shortcuts; reload. Verify failed saves remain
  visible, and hidden/collapsed cards issue no requests. Test with a source unavailable.
- Complete a task by keyboard and 900 ms hold; test early release, touch scrolling and server
  rejection. Verify the row disappears only on acknowledgement.
- Search embeddings with CSRF, date filters and each mode; verify the bounded-window notice.
  Expand Life Log, add a synthetic entry/body-map follow-up, and verify it in the timeline.
- Expand AI Gateway explicitly; confirm three status reads at most per cache interval,
  no logs endpoint, provider refresh or workload changes. Check stale/missing sources.

Validation uses synthetic records and mocked integrations. Production app startup, live
records and providers are intentionally not part of the test run.

## Original dashboard rollout validation

Node 24.20.0 via Volta. Full Jest run with coverage passed (253 suites / 1,939 tests). Required coverage thresholds passed:
67.35% statements, 43.72% branches, 77.56% functions, 67.98% lines for the configured
coverage inventory. Synthetic Pug rendering and DOM interaction tests cover the shell,
modal hooks, lazy loads/concurrency, hidden cards and acknowledged completion. A browser
connection was unavailable, so screenshots and live responsive browser checks remain on
the deployment checklist. No production startup, records, providers or secrets were used.
