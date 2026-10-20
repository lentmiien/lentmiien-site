# Startup Diagnostics & Recovery

`setup.js` now runs a structured diagnostics pipeline every time you execute `npm start` (or `node setup`). The goal is to harden startup by surfacing actionable errors early, adding retries around flaky services, and emitting machine-readable summaries for agents/alerts.

## Flow Overview

1. **Preflight checks** (env vars, disk space, Mongo connectivity) run via `utils/startupChecks.runPreflightChecks`. Missing non-database configuration and disk failures stop the script and emit a critical alert. Mongo unavailability is deferred so the web process can enter its recovery loop.
2. **Section runners** execute each maintenance task with timing, contextual logging, and error classification (`ok`, `warning`, `failed`, `skipped`):
   - directory + cache provisioning
   - tmp/data cleanup and PDF job pruning
   - PNG → JPG conversions (skips gracefully if the folder is absent)
   - log rotation
   - Mongo maintenance (test-data purge, OpenAI usage sync with retries, Sora cleanup); this section is skipped when Mongo recovery was deferred
   - Dropbox backup/setup (only when OAuth tokens + env vars exist)
3. **Summary output** aggregates section statuses and is logged under `startup:summary`, making it easy to trace regressions without sifting through the full log stream.
4. **Alerting** (Slack + Mailgun) fires for preflight failures, critical sections that abort the script, or any remaining warnings at the end.
5. **Application readiness** starts the HTTP listener with `/apphealth` returning `503`. All other HTTP and new Socket.IO traffic receives a generic unavailable response until MongoDB connects. Connection attempts use capped exponential backoff with jitter.
6. **Recovery** changes `/apphealth` to `200`, starts database-dependent workers exactly once, and allows normal traffic. Later disconnections immediately restore the readiness gate; scheduled ticks skip database work until Mongoose reconnects.

## Database Emergency Workflow

After the configured grace period, the primary web process submits one emergency-priority Pushover notification for the outage. Failed API submissions use a bounded retry policy; a successful receipt prevents duplicate submissions across Node restarts. The notification state is persisted in `logs/database-availability-pending.json` with mode `0600`. When MongoDB recovers, the process retries cancellation of remaining emergency deliveries, makes bounded attempts to send a normal recovery notice, upserts the incident into `database_availability_incidents`, and removes only the dedicated pending file. Normal structured application logs remain in their existing local JSONL files and are not deleted or mirrored wholesale.

If Pushover is not configured or delivery fails, database retries continue and the failure is written through `utils/logger`. The local incident contains only bounded, redacted operational fields; connection strings and credentials are never stored in it.

## Planned maintenance

Before work that may interrupt the app, run these commands **in the deployed checkout**:

```sh
node scripts/maintenance.js start 60 deployment
node scripts/maintenance.js status
# End the window as soon as the work is finished:
node scripts/maintenance.js end
```

The duration is 1–1,440 minutes; reasons are `deployment`, `host`, `database`,
`network`, or `other`. No environment change or application restart is needed.
The flag is stored atomically in ignored `private_data/operations/maintenance.json`,
outside static mounts and independently of MongoDB. Keep this directory across
deployments; processes using separate checkout copies need the flag in each copy.
It survives Node/MongoDB restarts and expires based on its persisted UTC deadline.
An unreadable or invalid flag **does not disable alerts** and produces an actionable
warning. Correct or remove an invalid local file before setting another window.

While active, the database unavailable transition and connectivity availability
warnings are recorded at notice level, and new database/connectivity Pushover
outage alerts are deferred. Probes, incident recording, readiness gating, retries,
and recovery continue. Expiry/early end restores database alerts within 30 seconds
and connectivity alerts on the next monitor round if the outage persists.
Suppression does not consume notification attempts or a new connectivity cooldown.
An emergency already sent before maintenance still follows its existing
acknowledgement/recovery lifecycle.

Every application log entry during the window carries a top-level `maintenance`
object (opaque ID, start/end, reason). Other warnings/errors keep their original
severity: the tag is context for investigation, not proof that maintenance caused
them. Connectivity analytics retain actual failures and show maintenance rounds
separately from alert attempts. This flag is not an application traffic switch or
a replacement for external monitoring when the entire host is down.

Security contract: local operator tooling only, no HTTP/Socket.IO entry point,
browser mutation, public principal or outbound request. OS access to the deployed
checkout is required; no application role grants this command. The fixed private
file contains only bounded operational metadata (no free-text reason or secrets),
is written with mode 0600 and expires within 24 hours. Start/end are logged; the
file is deleted on explicit end or replaced after expiry. No schema migration or
new environment variables are required. Tests cover persistence, expiry, invalid
state, bounds, log context, alert suppression/resumption and retained failures.

The recurring human-tool response reconciler also checks database readiness on
each tick. It skips disconnected periods and resumes on the next interval without
overlapping its own recovery work.

### Production report follow-up (2026-10-20)

Workflow `83cbac45-9be4-421b-bbe7-02a0fa7f2ca7` was checked against checkout
`9d9e302`, which includes the report's `a60f43b` deployment and subsequent Runpod
safeguards. The October 14 outage's host cause remains unproven; no restart or
startup-policy change is justified from the app logs alone. The Local AI
preconnection initialization fix (`autoCreate/autoIndex: false`, explicit
readiness-time provisioning) is already present and retains its regression tests.
TARIC intentionally separates request/benchmark/reprocessing outcomes and rejects
missing evidence and out-of-catalog proposals; those validation gates are unchanged.
Production data/catalog/model quality needs a separate measured review.

Confirmed fixes address the Local AI guard/acquisition overlap, bounded private
media waiting, upload-stage diagnostics, Codex scope/polling mismatch, controlled
AmiAmi placeholder recovery, and database readiness gating. Gateway monitoring
now distinguishes a real `upstreamStatus` from the controller's `responseStatus`
fallback and includes only allowlisted transport codes, without upstream payloads.
No claim is made that earlier Gateway failures were maintenance-related or that
silence proves recovery. No production actions, catalog retries, alerts, index
reinitialization, or deployment are performed by this verification work.

Verification used the pinned Node 24.20.0: 540 focused tests passed, then the full
Jest run passed 414 suites / 5,395 tests with coverage thresholds satisfied
(17 suites / 261 tests skipped). After final AmiAmi concurrent-error accounting
and review-prompt/UI refinements, all 138 affected focused tests passed.
`git diff --check` passed. This does not replace the opt-in disposable MongoDB,
Gateway or Windows host integration checks that were skipped.

## Configurable Checks

| Variable | Purpose |
| --- | --- |
| `STARTUP_MIN_DISK_MB` | Minimum free disk (MB) required for the drive hosting the repo (default `200`). |
| `STARTUP_REQUIRED_ENV_VARS` | Comma-separated list of env vars that must be present. Defaults to `MONGOOSE_URL,SESSION_SECRET,OPENAI_API_KEY`. |
| `STARTUP_SKIP_MONGO_CHECK` | Set to `true` to skip the Mongo connectivity probe (useful for offline dev). |
| `STARTUP_SLACK_WEBHOOK_URL` | Incoming webhook used for Slack/Teams alerts. |
| `STARTUP_ALERT_EMAIL` | Comma-separated recipients for Mailgun alerts. Requires `MAILGUN_API_KEY` + `MAILGUN_DOMAIN`. |
| `STARTUP_ALERT_FROM` | Optional friendly from name for Mailgun emails. |
| `DATABASE_CONNECT_TIMEOUT_MS` | Per-attempt MongoDB selection/connect deadline (default `10000`). |
| `DATABASE_RETRY_INITIAL_MS` | Initial retry delay before jitter (default `2000`). |
| `DATABASE_RETRY_MAX_MS` | Maximum retry delay before jitter (default `30000`). |
| `DATABASE_OUTAGE_ALERT_AFTER_MS` | Delay before the emergency Pushover notification (default `30000`). |
| `DATABASE_OUTAGE_NOTIFICATION_RETRY_MS` | Delay between failed emergency Pushover API submissions (default `300000`). |
| `DATABASE_OUTAGE_NOTIFICATION_MAX_ATTEMPTS` | Maximum emergency and recovery notification submissions (default `3`). |
| `DATABASE_INCIDENT_FLUSH_RETRY_MS` | Retry delay when a recovered local incident cannot yet be imported (default `60000`). |
| `DATABASE_INCIDENT_RETENTION_DAYS` | TTL for recovered incident documents (default `90`). |

## Alert Payload

Alerts include severity (`warning` or `critical`), a short message, and the JSON summary (sections array + counts). Slack uses the incoming webhook, while Mailgun sends a plaintext email; both transports are optional and run independently.

## Utilities & Tests

- `utils/startupChecks.js` centralises env validation, disk space probes (`check-disk-space`), Mongo connectivity checks, and alert helpers. The exported functions can be reused inside other maintenance scripts if needed.
- `tests/startupChecks.test.js` covers the edge cases (missing env, insufficient disk space, mocked Mongo failures, Slack alert wiring) using Jest + dependency injection.

## Troubleshooting Tips

- **Disk failures**: look for log entries tagged `startup:disk`. Increase `STARTUP_MIN_DISK_MB` or free space in the drive captured in the metadata.
- **Mongo failures**: logs appear under `startup:mongo` and `startup:preflight`. Ensure `MONGOOSE_URL` points to a reachable cluster and that the server is running.
- **Windows/Docker boot**: Docker Desktop's "Start Docker Desktop when you sign in" setting is disabled by default, so a reboot can leave its engine unavailable until sign-in unless host startup is configured. Enable that setting where an interactive sign-in is acceptable, or prefer a service-managed Docker Engine; configure the MongoDB container with an appropriate `always` or `unless-stopped` restart policy. Verify after a Windows Update reboot that MongoDB becomes reachable without manual intervention. The application recovery loop is a safety net, not a replacement for fixing host auto-start.
- **Dropbox skipped**: the section status becomes `skipped` when `tokens.json` or required env vars are missing, allowing local development without OAuth tokens.
- **Usage sync retries**: OpenAI usage harvesting now retries up to 3 times with exponential backoff. Failures downgrade the section to a warning instead of crashing the script.

For a quick snapshot of the last run, tail the latest `logs/app-YYYY-MM-DD.log` and search for `startup:summary` to see all sections, durations, and outstanding issues.

## Security Contract: Database Availability Lifecycle

```text
Feature: Database availability lifecycle and incident spool
Security zone: fully-public for GET /apphealth; no user-facing route for incident data
Interactive principals: anonymous health probes only
Machine principals: none
Data classification: private operational metadata; Pushover credentials and MongoDB URI are secret and never persisted/logged
Capabilities: none; health exposes only ready/unavailable
Object scope: none
Admin override: no
Browser mutations and CSRF control: none
Public/secret abuse controls: GET-only constant-work health response; all other traffic fails fast while unavailable
Request and upload limits: no request body is consumed by the health handler
Output/rendering contexts: bounded JSON with generic state
Private file/media storage and delivery: pending incident is outside public/ and mode 0600
Outbound hosts/services: configured MongoDB origin and fixed Pushover API origin
Cache policy: no-store for health and maintenance responses
Security-relevant logs (without personal data): state transition, opaque incident ID, attempt count, duration, redacted error class/code
Retention/deletion behavior: local pending spool is removed only after idempotent MongoDB upsert; recovered incidents expire after 90 days by default
Required negative security tests: unavailable/ready HTTP states, generic response, secret redaction, alert deduplication, failed-import spool preservation
Legacy dependency or migration plan: replaces database.js fire-and-forget connect; local application JSONL logs remain canonical
```
