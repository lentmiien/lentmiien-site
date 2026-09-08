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
from spending to avoid double counting. Balances are **recorded, dated snapshots**, not
reconstructed current balances. Open Accounting for full reconciliation and card analysis.
No cross-currency grand total is invented.

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

## Validation for this change

Node 24.20.0 via Volta. Full Jest run with coverage passed (253 suites / 1,939 tests). Required coverage thresholds passed:
67.35% statements, 43.72% branches, 77.56% functions, 67.98% lines for the configured
coverage inventory. Synthetic Pug rendering and DOM interaction tests cover the shell,
modal hooks, lazy loads/concurrency, hidden cards and acknowledged completion. A browser
connection was unavailable, so screenshots and live responsive browser checks remain on
the deployment checklist. No production startup, records, providers or secrets were used.
