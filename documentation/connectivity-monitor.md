# Connectivity monitor and analytics

## Security contract

- Feature/zone: connectivity analytics and history, **logged-in**. Admin receives the explicit `monitoring.connectivity.read` capability bundle; family/user have no default grant. The shared evaluator also accepts explicit grants. Missing/incomplete principals fail closed. Machine principals: none.
- Data/scope: private operational metadata; the capability grants read access to the entire admin-managed monitor dataset. No client-selected owners, object IDs, probe destinations, credentials, or commands. No admin authorization bypass.
- Browser mutations/CSRF: none. GET/HEAD only read stored data or render the page; refresh cannot trigger probes, notifications, index creation or configuration changes.
- Request limits: analytics accepts only `hours=1|6|24|72`; at most 5,001 database rows read, 5,000 included, 240 chart bins, 200 recent incident/gap/alert entries, newest 360 detailed rounds returned, 30 history rows rendered per page. Full-window charts/statistics include all fetched rows; older detailed rows remain accessible via raw API pagination. Truncation is disclosed. Database work has a 3-second client timeout and 2-second server budget. Raw history keeps 360-row ISO `before` pagination and the current retention bound. Unknown/structured/duplicate query parameters fail validation.
- Output: Pug escaping, static first-party script/CSS, client DOM `textContent`, numeric chart attributes and bounded allowlisted metadata; no inline provider data or third-party analytics. Shared layout theme and resources remain. Private/no-store responses. No private files/media created.
- Outbound services: two fixed HTTPS targets and one optional operator-controlled origin at a fixed path; normal-priority Pushover through the existing utility. Verified TLS, pinned public IPv4 DNS resolution, no redirects/proxies/cookies/auth headers. Local health uses only literal `127.0.0.1` and the actual server listener port supplied internally by app.js. DB ping uses the existing validated MongoDB connection, never a supplied URI.
- Logging: shared logger reports actionable monitor, persistence, notification, local diagnostic, history and index failures using fixed messages with no secrets, bodies, addresses, raw provider errors or target URLs. Runtime warnings are throttled per category/cooldown; index failures fail the CLI with a safe error.
- Retention: `connectivity_samples` only, default three days via per-record `expiresAt`. Explicit targeted index deployment below; no broad index synchronization/deletion. No backfill or production mutation in implementation/tests.
- Negative tests: principal/capability denial on every representation, malformed bounds, missing observations, DB failures, unsafe DNS/URLs, redirects, certificate verification, bad/oversized contracts, deadlines/disposal, legacy/config continuity, alert failure cooldown, local/DB isolation and index conflicts.
- Legacy plan: preserve public `/apphealth` readiness contract and raw JSON access; retain and label historical samples. Version 2 resets previous probe-contract streaks while retaining the global attempt cooldown. No stored sample migration or security exception.

## Probe contracts and diagnostic meaning

Each run starts its HTTP probes and DB diagnostic concurrently. External probes:

| Probe | Request | Success means |
| --- | --- | --- |
| internet | GET `https://www.google.com/generate_204`, exactly 204 | One independent provider responded from the app PC |
| cloudflare | GET `https://www.cloudflare.com/cdn-cgi/trace`, exactly 200, bounded text containing `h=www.cloudflare.com` and a three-letter `colo` field | **Cloudflare edge connectivity, not tunnel health** |
| publicApp (optional) | Configured HTTPS origin + `/apphealth`, GET, 200 and JSON `status: ok`, `database: ready` | Public app path returned the existing readiness contract |

Cloudflare documents the [managed `/cdn-cgi/trace` endpoint](https://developers.cloudflare.com/fundamentals/reference/cdn-cgi-endpoint/). Version 1 incorrectly used HEAD, producing persistent 404s in production. Version 2 validates GET; a workspace request on 2026-09-05 returned 200 and the expected contract in approximately 86 ms with verified TLS. This is **not production verification**. Trace contents are inspected in memory only, discarded after the request, and never stored or logged.

All external requests have a 5-second default absolute deadline covering cancellable DNS, TCP/TLS, response headers and body; 8 KiB header/4 KiB body limits; fresh connections and no retries. A-record resolution uses configured system DNS servers with no IPv6 fallback or OS hosts-file override. Resolve once, reject non-public/reserved IPv4 results, pin the address, and retain normal hostname/certificate verification. HTTP redirects remain errors. No global TLS setting is weakened.

Public app requests use a unique query and no-cache headers. Confirm Cloudflare cache bypass for `/apphealth` and correct public routing. An Access challenge, WAF block, redirect, database outage or app failure can fail this probe. Do not add credentials or broad Access/WAF exceptions for monitoring. A working edge and failed app narrow the symptom to the public app path but do not prove the Docker tunnel is at fault. This feature does not inspect Docker or the obsolete Windows cloudflared service.

Separate local diagnostics (never included in internet alert policy):

| Diagnostic | Operation | Meaning |
| --- | --- | --- |
| LOCAL health | Bounded GET `http://127.0.0.1:<actual listener>/apphealth` | Local HTTP listener and existing cheap Mongoose readiness contract; no self-HTTP session authorization needed, no new bypass |
| DB ping | `db.command({ping: 1, maxTimeMS: budget}, {timeoutMS: budget, signal})` | Actual MongoDB command duration including driver server selection and pool wait |

Local/DB budgets are the lesser of the external deadline and 2,000 ms. Missing listener or DB readiness returns `unavailable`. Driver CSOT and an AbortSignal bound/cancel outstanding DB work; no detached Promise.race timeout work or retry queue. Abort can close the affected driver connection. Ping is not a representative collection query; public health remains readiness-only.

## Stored timing and outcomes

- `outcome`: `ok`, `http_status`, `unexpected_response`, `oversized`, `timeout`, `dns_error`, `connection_error`, `unsafe_address`, or local `unavailable`.
- `httpReachable`: response headers arrived. A 404/502 is an HTTP error, **not evidence of lost internet connectivity**. A body timeout can still have HTTP reachability and a status code.
- `latencyMs` and `timings.totalMs`: elapsed duration to completion/failure. `slow` records threshold crossing independently of outcome. Analytics calls only slow `ok` results “slow success”. Timeouts and failures never enter success p50/p95.
- `timings.dnsMs/tcpMs/tlsMs/ttfbMs`: cumulative monotonic **milestones from request start**, not additive durations. Differences between completed milestones approximate individual phases. DNS uses explicit resolution before the pinned lookup; TTFB is when Node delivers response headers. Null means not observed/inapplicable; local checks have no DNS/TLS. A safe error code and last `failurePhase` supplement partial timings. TLS failures never mark TLS completed.
- `scheduledAt`, `schedulerLatenessMs`, `startedAt`, `sampledAt`, `endedAt`, `runDurationMs`: expected scheduling, monotonic timer lateness, run start, concurrent observation start, observation completion, and monotonic run-to-observation-completion duration. Initial state restore is included in the run duration; sample persistence and notification delivery occur afterwards. These are wall-clock labels plus monotonic durations; event-loop stalls can delay deadlines. Time spent asleep/offline cannot be reconstructed from a probe.
- `processId` (random per process), estimated `processStartedAt`, `runId`, `monitorVersion`, sampling interval and threshold snapshot distinguish restarts and configurations without storing hosts, PIDs, URLs or credentials. The private config signature is not exposed by JSON endpoints. Analytics exposes window-local labels such as `config-1` instead.

Healthy local health and ping during correlated external failures support investigation of the outbound/public path. They cannot identify Wi-Fi, ISP, resolver, Cloudflare, tunnel, browser or server load as the cause. The earlier production investigation had only 16 rounds, local health around 4–8 ms and DB ping around 1–2 ms, with no matching large event-loop/CPU spike. Those observations are insufficient for daily attribution and are not backfilled into new diagnostic fields. Capture a slow browser request waterfall, correlate app performance timestamps, and inspect Docker tunnel observations if symptoms continue.

## Analytics and alert semantics

- Browser URL `/admin/connectivity`: themed admin dashboard and navigation entry, with 1/6/24/72-hour selection, manual refresh, cards, aligned status bins, per-bin successful-response p95 charts, degraded stretches, gaps, alert activity and paged detailed history. Times use the browser timezone, explicitly labeled. Timeline rows support keyboard arrow selection and textual counts; details expose safe codes/timings.
- `/admin/connectivity/analytics?hours=24`: bounded analytics JSON. Different configurations remain labeled and may be included together in window statistics. Old Cloudflare HEAD failures stay HTTP failures; they are not rewritten as successes. Historical/unknown sampling cadence makes current-cadence coverage an estimate.
- `/admin/connectivity/api`: backwards-compatible 360-row raw JSON history. `/admin/connectivity` also returns JSON for `Accept: application/json`, default `*/*`, or old `?before=<ISO>` links. Explicit HTML navigation renders the page. Follow `nextBefore` for strictly older timestamps. One enabled scheduler per database is required; timestamp-only legacy pagination cannot distinguish simultaneous duplicate timestamps from multiple writers.
- Overall recent external status is unknown for disabled/stale/future/different-config samples **or any missing expected external probe**. Local probes have their own status. Absent new fields in legacy rows remain unknown. No observation is converted to health.
- Sample success is successful contracts / stored observations of that probe, not continuous uptime. Success latency uses nearest-rank p50/p95, including slow successes and excluding failed/timeout elapsed values. Counts include HTTP reachability, contract/HTTP errors, timeouts and other connection failures. Missing probe observations are counted separately from stored rounds.
- Coverage is occupied current-cadence time slots / expected slots in the selected window; duplicate rounds cannot inflate coverage. Chart bins with observations do not imply continuous coverage. Boundary/internal gaps greater than 1.5 relevant intervals are listed. Retention, disabled collection, app downtime or lost DB writes can all produce gaps. At the query cap, statistics cover only the included newest rows and are marked incomplete.
- Observed degraded stretches require successive observations of one probe; gaps, missing observations, config changes, non-forward sample times and recovery break continuity. The span is last observed time minus first, not a proven outage duration. Local degraded stretches are separate diagnostics.

External probes are degraded on a failed contract/connection or total latency **>= 1500 ms** by default. Each probe needs **10 minutes** of successive degraded observations before an alert attempt; alternating failures never combine. Recovery resets that probe; gaps over 1.5 intervals or a config/version change reset duration. A short restart can restore a streak, a long restart cannot. Config signature includes monitor version 2 so the faulty HEAD contract cannot perpetuate its streak. The prior global cooldown remains intact, including an attempt caused by the old contract.

A global **one-hour cooldown** applies to attempts, including delivery failures and new incidents. Save the attempt timestamp durably before normal-priority Pushover; no real notifications are sent by tests. A crash after recording but before sending can consume cooldown without delivery. States: `none`, `attempted` (delivery unknown), `sent`, `failed`, `deferred`. No recovery notifications, offline delivery retry queue or alert storms. Local diagnostic failures only produce throttled operational warnings.

When DB writes fail, continue observations in memory, do not queue samples, and defer alerts until saved cooldown can be restored and the new attempt durably acknowledged. The app's global database-readiness middleware can also make the admin page temporarily unavailable during a DB outage; this is not an external uptime monitor. Keep MongoDB on persistent storage. Enable exactly **one monitor app process**, disable all replicas/development instances; no distributed leader election is added.

## Configuration

No new environment variables or dependencies. Existing variables in `env_sample`:

| Variable | Default | Allowed |
| --- | --- | --- |
| CONNECTIVITY_MONITOR_ENABLED | true | true / false |
| CONNECTIVITY_INTERVAL_MS | 120000 | 60000–600000 |
| CONNECTIVITY_RETENTION_DAYS | 3 | 1–7 |
| CONNECTIVITY_SUSTAINED_MS | 600000 | 600000–86400000 |
| CONNECTIVITY_COOLDOWN_MS | 3600000 | 600000–86400000 |
| CONNECTIVITY_TIMEOUT_MS | 5000 | 1000–15000 |
| CONNECTIVITY_SLOW_MS | 1500 | 100–10000, below timeout |
| CONNECTIVITY_PUBLIC_ORIGIN | empty | trusted HTTPS DNS origin, port 443 only; no credentials/path/query/fragment |

Invalid configuration disables the scheduler with a safe error log; history/analytics returns 503. The dashboard shell can still render an error state. Use the repository-pinned Node **24.20.0** for release.

## Deployment and targeted retention indexes — Lennart only

Implementation does not deploy, connect to production MongoDB, modify indexes or send Pushover. The earlier production inspection found only `_id_` in `connectivity_samples`; declaring a Mongoose TTL index did **not** guarantee retention. Version 2 deliberately disables auto-index creation on this model. Use the explicit tool below; it never imports `database.js`, starts the app, or touches other collections.

From the deployed repository directory, with the existing production environment supplied securely (the script can load `.env` without printing it):

```sh
# Read-only: prints only expected index names/states, not credentials or data.
node scripts/setup-connectivity-indexes.js --verify

# After reviewing the intended DB and retention consequences, Lennart creates missing indexes.
node scripts/setup-connectivity-indexes.js --execute

# Confirm both sampledAt_1 and expiresAt_1 are ready.
node scripts/setup-connectivity-indexes.js --verify
```

Exit 0 means ready, 2 means required indexes missing in verify mode, 1 means failure/conflict. `--execute` is idempotent and sequentially creates only `{sampledAt:1}` and `{expiresAt:1, expireAfterSeconds:0}` on **`connectivity_samples`**. Equivalent existing indexes with other names are accepted. Incompatible definitions/options fail before any creation; an operator must review them. There is no `syncIndexes`, `dropIndexes`, collection drop, document rewrite, or automatic conflict repair. Connection/operation budgets bound the CLI; after an ambiguous timeout, verify before retrying because a server-side index build may continue.

**Creating the TTL index allows MongoDB to permanently remove expired MONITOR records in `connectivity_samples`, including the existing backlog.** Review/backup monitor history first if it is needed; MongoDB TTL runs asynchronously and can add deletion/I/O load when a backlog exists. It does not remove application records from other collections. Records without a valid `expiresAt` date will not be removed by this TTL index; this script does not backfill or delete them. Existing monitor records already declare `expiresAt`. Changing retention changes only newly written expiry dates; it does not extend older records. History reads also enforce current retention and expiry while TTL catches up.

Release checklist:

1. Pull the released commit using the normal deployment workflow. No dependency changes; use pinned Node 24.20.0. Do not use `npm start` as a smoke test: prestart runs maintenance/sync. Do not start a second monitoring process.
2. Run the verification/setup/verification commands above as Lennart against the intended DB. Review TTL impact first. Check safe `connectivity_monitor` logs if the tool fails.
3. Keep existing defaults and the intended `CONNECTIVITY_PUBLIC_ORIGIN`; confirm `/apphealth` cache bypass and public routing. Existing Pushover settings can remain; no new secrets, local URL or diagnostic port settings are needed. Restart via the existing process manager.
4. Verify GET from the deployed workspace **without disabling TLS**, storing only safe result metadata:

   ```sh
   node - <<'JS'
   const { probe, probeTargets } = require('./services/connectivityProbe');
   const { getConnectivityConfig } = require('./utils/connectivityConfig');
   const config = getConnectivityConfig({});
   probe(probeTargets(config)[1], config).then(result => process.stdout.write(JSON.stringify(result) + '\n'));
   JS
   ```

5. Log in and open `/admin/connectivity`. After two or more rounds verify monitor v2, Cloudflare GET success, LOCAL health and DB ping, phase timings, active config labels and browser timezone. Check `/admin/connectivity/api` for raw samples. Historical HEAD errors remain labeled; a version/config change resets streaks but not attempt cooldown. Missing/stale data must show unknown.
6. Confirm retention indexes through the tool and monitor TTL backlog asynchronously with normal database tooling. Do not force production outages or send test notifications. If slow loads recur, capture a browser request waterfall and contemporaneous app performance/Docker tunnel observations for Lennart's next investigation.
7. Disable collection with `CONNECTIVITY_MONITOR_ENABLED=false` and restart to stop probing/alerts. Existing records continue to expire. Rolling back code does not restore TTL-deleted history.

## Automated validation

```sh
npm test -- --runInBand --coverage=false tests/unit/connectivity
npm test -- --runInBand
```

Tests mock external providers/MongoDB/Pushover, apart from disposable loopback-only HTTP servers. No production records or secrets are used. UI verification can serve the Pug template and synthetic analytics through an isolated test server without importing app.js/database.js or starting workers.

Release validation (2026-09-05): all 239 Jest suites / 1,762 tests passed on pinned Node 24.20.0, including 111 connectivity tests; repository coverage thresholds passed. An isolated Chromium harness with synthetic data verified desktop/mobile layout, 1,200 aligned cells, keyboard selection, range refresh, history paging, explicit timezone, loading/empty/error states, no page-wide mobile overflow and no JavaScript errors. No app.js startup, production DB/index writes or real Pushover sends were used. The Cloudflare GET contract was separately verified from this workspace; live production verification remains Lennart's deployment step.
