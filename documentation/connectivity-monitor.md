# Connectivity monitor

The app process makes up to three parallel small HTTPS requests every two minutes:

| Probe | Request | Success means |
| --- | --- | --- |
| internet | Google `https://www.google.com/generate_204` GET, exactly 204 | This independent provider is reachable from the app PC |
| cloudflare | `https://www.cloudflare.com/cdn-cgi/trace` HEAD, exactly 200 | Cloudflare's edge is reachable; **does not test your tunnel** |
| publicApp (optional) | Configured HTTPS origin + `/apphealth`, GET, 200 and JSON `status: ok`, `database: ready` | The configured public app path responded with DB readiness |

These measure total small-request latency (DNS + new TCP/TLS + response completion), **not bandwidth**, Wi-Fi signal, packet loss rate, or Docker/service health. DNS uses cancellable A-record resolution with the system DNS servers; only IPv4 is tested, with no IPv6 fallback or OS hosts-file override. No pooled connections, redirects, proxies, authentication headers or cookies are used. Requests have a 5-second absolute deadline, 8 KiB header limit and 4 KiB body limit. Bodies, headers, resolved addresses, URLs and raw errors are never persisted or logged.

The public URL is optional, configured only by the operator as an origin. Its path is fixed to the existing cheap DB-readiness handler, which never calls this monitor. A unique query and no-cache request headers discourage stale responses; configure Cloudflare to bypass cache for `/apphealth` (the handler already sends no-store). An Access challenge, WAF block, redirect, DB outage or app failure can fail this probe. Do not add credentials or a broad Access/WAF exception just for monitoring. A healthy edge with a failed app probe narrows the symptom to the public app path but cannot prove cloudflared is the cause. Even app success cannot prove the request traversed a specific tunnel without correct DNS/routing/cache configuration. The working Docker cloudflared tunnel is the relevant path; this feature neither accesses Docker nor monitors the obsolete Windows service.

All configured probes are individually degraded on failure or latency **>= 1500 ms**. Each needs at least **10 minutes** of successive degraded samples before an alert attempt; alternating failures on different probes do not combine. Recovery resets that probe immediately. More than **1.5 sampling intervals** between observations (3 minutes by default), non-forward clock movement, or a configuration change resets observed duration. A short restart can continue an episode from the latest stored sample; a long restart cannot. This describes sampled observations, not proof about every instant between them. It cannot send while the PC/app is off, and is not an external uptime monitor or a diagnosis of Wi-Fi versus ISP versus provider load.

A global **1-hour cooldown** applies to Pushover attempts, including failures and later incidents. The attempt timestamp is saved before calling `utils/pushover.js` at normal priority. An unclean restart between saving and sending can consume a cooldown without delivery; this favors avoiding duplicate alerts. Notification states are `none`, `attempted` (delivery unknown), `sent`, `failed`, or `deferred`. No recovery notification or delivery retry queue is added. Repeated operational warnings are limited to once per issue category per cooldown per process.

Samples are stored in the application's existing MongoDB connection, collection `connectivity_samples`, with `expiresAt` TTL (`expireAfterSeconds: 0`). Defaults retain three days, about 2160 samples. TTL deletion is asynchronous. Changing retention affects new samples; history reads also enforce the current retention window. The latest sample stores continuity and cooldown, so no separate permanent incident collection is required. DB commands have a 3-second total timeout (2-second server execution budget), buffering disabled. During DB failure probes continue in memory, samples are not queued, and alerts are deferred until state can be restored and an attempt durably acknowledged. Missing persisted samples are visible as gaps. Restart continuity/cooldown cannot be guaranteed if the local database itself loses acknowledged data; use persistent Docker MongoDB storage.

## Configuration and release

`env_sample` documents all values. Invalid configuration disables the scheduler with an actionable error log and makes the history API return 503. Defaults:

| Variable | Default | Allowed |
| --- | --- | --- |
| CONNECTIVITY_MONITOR_ENABLED | true | true / false |
| CONNECTIVITY_INTERVAL_MS | 120000 | 60000–600000 |
| CONNECTIVITY_RETENTION_DAYS | 3 | 1–7 |
| CONNECTIVITY_SUSTAINED_MS | 600000 | 600000–86400000 |
| CONNECTIVITY_COOLDOWN_MS | 3600000 | 600000–86400000 |
| CONNECTIVITY_TIMEOUT_MS | 5000 | 1000–15000 |
| CONNECTIVITY_SLOW_MS | 1500 | 100–10000, below timeout |
| CONNECTIVITY_PUBLIC_ORIGIN | empty (app probe disabled) | trusted HTTPS DNS origin, port 443 only, no credentials/path/query/fragment |

The scheduler starts once per app process independently of DB readiness. The repository has no common multi-process scheduler leader election. Enable it on **exactly one app process**, disable on other replicas/development instances. The dedicated Codex worker does not import/start this scheduler. There is no distributed monitor lock.

Deployment/manual verification for Lennart (not performed by implementation work):

1. Pull the released commit into the normal app checkout. No dependency changes are required; use the pinned Node 24.20.0 and the normal release procedure. Do not run `npm start` just to test: its prestart performs maintenance/synchronization.
2. On the one monitoring app process, keep the defaults above. Optionally set `CONNECTIVITY_PUBLIC_ORIGIN` to the site's actual public HTTPS origin. Reuse existing `PUSHOVER_APP_TOKEN` / `PUSHOVER_USER_KEY`; no new secret is required. Ensure `MONGOOSE_URL` already targets the intended local Docker MongoDB and its data volume persists. Never paste credentials into URLs.
3. Confirm Cloudflare `/apphealth` cache bypass and the intended public routing. Leave the obsolete Windows cloudflared service out of this procedure. Restart through the existing app process manager once configuration is set; this monitor adds no deployment automation or production mutation.
4. Log in as admin and open `/admin/connectivity` (also linked from `/admin/performance`). After two minutes inspect `sampledAt`, each probe's `outcome`, `latencyMs`, `degradedSince`, and `publicAppConfigured`. Stale/missing/disabled observations or samples from an earlier configuration report `unknown`. The JSON page returns 360 newest records; follow `?before=<nextBefore ISO timestamp>` for older pages within retention. A paginated historical page's status describes that page's newest sample and is normally `unknown` due to age. Refresh manually; viewing history never triggers probes.
5. With your normal local MongoDB admin tooling, verify `db.connectivity_samples.getIndexes()` contains `expiresAt_1` with `expireAfterSeconds: 0`. Mongoose normally creates declared indexes. If automatic indexes are disabled, create just the new collection's indexes: `db.connectivity_samples.createIndex({sampledAt: 1})` and `db.connectivity_samples.createIndex({expiresAt: 1}, {expireAfterSeconds: 0})`. No existing data migration or index change is needed.
6. For optional outage testing use a disposable app instance and test DB, with every unrelated background worker disabled by its own configuration. Prefer the automated tests below; do not disconnect production Wi-Fi to validate this feature. Six degraded observations two minutes apart reach the ten-minute boundary; a single blip does not. Failed sends should leave `failed` and no second attempt within an hour. A gap over three minutes resets duration; a quick restart preserves saved cooldown. Inspect `connectivity_monitor` logs for DB/notification/configuration failures.
7. Roll back by setting `CONNECTIVITY_MONITOR_ENABLED=false` and restarting that app process, or reverting the release. Existing samples expire through TTL. Disabling does not delete data immediately.

Automated verification (mocked outbound probes, DB and Pushover; no live service needed):

```sh
npm test -- --runInBand --coverage=false tests/unit/connectivityMonitor.test.js tests/unit/connectivityProbe.test.js tests/unit/connectivityRoute.test.js tests/unit/connectivityScheduler.test.js
npm test -- --runInBand
```

## Security contract

- Feature/zone: connectivity history, **logged-in**. Interactive principals: admin by default; family/user denied unless explicitly granted `monitoring.connectivity.read` through the shared role store. Missing/incomplete principal denied. Machine principals: none; background work uses operator configuration, with no public controls.
- Data: private operational metadata. Capability/object scope: `monitoring.connectivity.read` grants read access to the entire admin-managed monitor dataset; no individual ownership or client-selected object IDs. No implicit admin bypass; admin has the explicit capability bundle.
- Browser mutations/CSRF: none. GET/HEAD only read stored history. No queue/probe/configuration operations exposed. Bounded query: optional ISO `before`, 360 records maximum, current retention window; unknown parameters rejected.
- Output: JSON numbers, fixed labels and timestamps; no HTML/script context or analytics. Private/no-store responses. No private files or media.
- Outbound services: two fixed HTTPS targets above, optional operator-controlled origin at a fixed path; Pushover via the existing utility. Reject private, loopback, link-local, reserved and non-IPv4 DNS results before requesting; pin resolved address to prevent rebinding. No redirects or credential forwarding. DNS/provider behavior can produce false alarms.
- Logs/retention: safe stable operational warnings, no target/raw errors or response content; three-day TTL, bounded overrides. No live provider or production data needed in tests.
- Negative tests: anonymous/family/user/incomplete principals denied, explicit grant allowed, malformed/unknown queries, DB failures, unsafe DNS, redirects, oversized/invalid responses, timeouts, cooldown failures, overlap and observation gaps.
- Legacy dependency: use shared capability evaluator, local Mongo connection and existing non-recursive `/apphealth`; no security exception or schema migration of existing features.
