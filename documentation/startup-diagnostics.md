# Startup Diagnostics & Recovery

`setup.js` now runs a structured diagnostics pipeline every time you execute `npm start` (or `node setup`). The goal is to harden startup by surfacing actionable errors early, adding retries around flaky services, and emitting machine-readable summaries for agents/alerts.

## Flow Overview

1. **Preflight checks** (env vars, disk space, Mongo connectivity) run via `utils/startupChecks.runPreflightChecks`. Failures stop the script and emit a critical alert.
2. **Section runners** execute each maintenance task with timing, contextual logging, and error classification (`ok`, `warning`, `failed`, `skipped`):
   - directory + cache provisioning
   - tmp/data cleanup and PDF job pruning
   - PNG → JPG conversions (skips gracefully if the folder is absent)
   - log rotation
   - Mongo maintenance (test-data purge, OpenAI usage sync with retries, Sora cleanup)
   - Dropbox backup/setup (only when OAuth tokens + env vars exist)
3. **Summary output** aggregates section statuses and is logged under `startup:summary`, making it easy to trace regressions without sifting through the full log stream.
4. **Alerting** (Slack + Mailgun) fires for preflight failures, critical sections that abort the script, or any remaining warnings at the end.

## Configurable Checks

| Variable | Purpose |
| --- | --- |
| `STARTUP_MIN_DISK_MB` | Minimum free disk (MB) required for the drive hosting the repo (default `200`). |
| `STARTUP_REQUIRED_ENV_VARS` | Comma-separated list of env vars that must be present. Defaults to `MONGOOSE_URL,SESSION_SECRET,OPENAI_API_KEY`. |
| `STARTUP_SKIP_MONGO_CHECK` | Set to `true` to skip the Mongo connectivity probe (useful for offline dev). |
| `STARTUP_SLACK_WEBHOOK_URL` | Incoming webhook used for Slack/Teams alerts. |
| `STARTUP_ALERT_EMAIL` | Comma-separated recipients for Mailgun alerts. Requires `MAILGUN_API_KEY` + `MAILGUN_DOMAIN`. |
| `STARTUP_ALERT_FROM` | Optional friendly from name for Mailgun emails. |

## Alert Payload

Alerts include severity (`warning` or `critical`), a short message, and the JSON summary (sections array + counts). Slack uses the incoming webhook, while Mailgun sends a plaintext email; both transports are optional and run independently.

## Utilities & Tests

- `utils/startupChecks.js` centralises env validation, disk space probes (`check-disk-space`), Mongo connectivity checks, and alert helpers. The exported functions can be reused inside other maintenance scripts if needed.
- `tests/startupChecks.test.js` covers the edge cases (missing env, insufficient disk space, mocked Mongo failures, Slack alert wiring) using Jest + dependency injection.

## Troubleshooting Tips

- **Disk failures**: look for log entries tagged `startup:disk`. Increase `STARTUP_MIN_DISK_MB` or free space in the drive captured in the metadata.
- **Mongo failures**: logs appear under `startup:mongo` and `startup:preflight`. Ensure `MONGOOSE_URL` points to a reachable cluster and that the server is running.
- **Dropbox skipped**: the section status becomes `skipped` when `tokens.json` or required env vars are missing, allowing local development without OAuth tokens.
- **Usage sync retries**: OpenAI usage harvesting now retries up to 3 times with exponential backoff. Failures downgrade the section to a warning instead of crashing the script.

For a quick snapshot of the last run, tail the latest `logs/app-YYYY-MM-DD.log` and search for `startup:summary` to see all sections, durations, and outstanding issues.
