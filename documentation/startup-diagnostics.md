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
