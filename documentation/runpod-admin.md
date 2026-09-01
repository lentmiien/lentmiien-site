# Runpod REST API v2 admin integration

## Scope

`/admin/runpod` is an administrator-only dashboard for monitoring and managing
Runpod Pods. All provider requests use the production REST API v2 origin:

```text
https://api.runpod.io/v2
```

The catalog and billing monitor uses:

- `GET /v2/catalog/gpus?include=AVAILABILITY&product=POD&cloud=<SECURE|COMMUNITY>`
- `GET /v2/catalog/cpus?include=AVAILABILITY&product=POD`
- `GET /v2/catalog/datacenters`
- `GET /v2/catalog/templates?source=official`
- `GET /v2/billing?bucketSize=<allowlisted>&lastN=<1..366>`
- `GET /v2/billing` with an explicit UTC monthly range for the durable account ledger
- `GET /v2/billing/pods` with the same range for exact per-Pod compute and disk charges

Pod management uses:

- `GET` and `POST /v2/pods`
- `GET` and `DELETE /v2/pods/{id}`
- `POST /v2/pods/{id}/action` with `start` or `stop`
- `GET` and `POST /v2/templates`
- `PATCH /v2/templates/{id}`

API v1 and the legacy GraphQL API are not used. Runpod REST API v2 is currently
public beta, so response fields may evolve. Current reference:
<https://docs.runpod.io/api-reference-v2/overview>.

## Ollama workflow

1. An administrator creates or updates the Ollama workload template. The
   container definition is stored as a private template in Runpod and the setup
   recipe is stored locally.
2. The Pod creator filters current GPU stock by VRAM, availability, cloud, and
   price. The server re-fetches the catalog and validates every choice instead
   of trusting browser estimates.
3. Runpod creates one Pod from the provider template. The local record receives
   an automatic stop deadline immediately.
4. Background setup waits for `RUNNING`, checks the fixed Runpod HTTPS proxy,
   calls Ollama `POST /api/pull` with `stream: false`, and verifies the model in
   `GET /api/tags`.
5. The dashboard exposes the public Ollama URL only after setup succeeds. The
   default test model is `qwen2.5:0.5b`.

The default template uses `ollama/ollama:latest`, exposes `11434/http`, sets
`OLLAMA_HOST=0.0.0.0:11434`, and persists models under `/root/.ollama`. Pin the
image to a digest in the UI when reproducible deployments are required.

Runpod's proxy URL is public and Ollama has no application-level authentication.
Do not place private prompts or models on the test endpoint. Stop releases GPU
compute, but retained storage may still incur charges; delete permanently
terminates the Pod and removes its attached Pod disk.

## Local persistence

MongoDB creates five collections:

- `runpod_workload_templates`: local setup recipes linked to private Runpod
  template IDs.
- `runpod_pods`: provider IDs, running/stopped/archived lifecycle state, hardware,
  confirmed rates, setup state, public URL, auto-stop deadline, observed running
  and stopped durations, and provider-billed/estimated cost aggregates.
- `runpod_operation_events`: bounded create/setup/start/stop/delete/sync/template
  audit events without API keys, provider response bodies, or environment secrets.
- `runpod_billing_periods`: one durable account-wide UTC month from November
  2025 onward, including explicit zero rows for closed months omitted by Runpod
  and a provisional zero for an omitted current month.
- `runpod_pod_billing_periods`: exact monthly v2 compute and disk charges keyed
  by provider Pod ID and linked to the retained local Pod record.

Provider deletion archives the local Pod record instead of deleting its audit
history. A manual sync imports untracked provider Pods and archives local records
that no longer exist in the account.

The once-per-minute provider observer accrues durations between observations.
These times are operational estimates because v2 exposes current Pod state, not
a historical state-transition ledger. Provider billing is authoritative for
dollars and may lag recent usage. Billing records that predate local lifecycle
tracking create view-only `billing_history` Pod archives with exact available
costs and an explicit “time not recorded” state; no runtime is fabricated.
Observed estimates snapshot the documented Pod storage rates of $0.10/GB/month
for running container/volume disk and $0.20/GB/month for stopped volume disk,
using 730 hours/month; the provider ledger remains authoritative if prices or
billing rules change.

## Cost and failure controls

Defaults are deliberately conservative and can be tightened with environment
variables:

- At most two active provider Pods.
- At most four GPUs in a UI-created Pod.
- A hard server ceiling of `$10.00` per hour; the UI defaults its explicit
  confirmation to `$1.00`.
- A mandatory 60-minute auto-stop deadline and a maximum selectable runtime of
  24 hours.
- Three Pod creation attempts per hour and 30 Runpod control requests per minute.
- Ten-minute provisioning and model-pull deadlines.

The server validates fresh provider availability and price immediately before
creation. If Runpod returns a total rate above the administrator's confirmation
or the server ceiling, the newly created Pod is deleted before local persistence.
Setup failure records a safe error code and attempts to stop the Pod. A scheduler
observes provider state and checks expired deadlines once per minute while the application is running; a second scheduler refreshes account and per-Pod billing every six hours. An
operator should still keep provider billing alerts enabled as defense in depth.

## Security contract

```text
Feature: Runpod REST API v2 monitor and Pod manager
Security zone: logged-in, administrator only
Interactive principals: validated admin sessions
Machine principals: internal `runpod-state-observer`, `runpod-auto-stop`, and `runpod-billing-scheduler` labels; no inbound machine route (`RUNPOD_API_KEY` is an outbound provider credential)
Data classification: public catalogs; sensitive account billing/resource metadata; secret provider key
Capabilities: runpod.catalog.read, runpod.billing.read, runpod.billing.sync, runpod.pod.read, runpod.pod.create, runpod.pod.start, runpod.pod.stop, runpod.pod.delete, runpod.pod.setup, runpod.pod.sync, runpod.template.manage
Object scope: account-wide admin feature; browser actions use local MongoDB IDs and resolve provider IDs server-side
Admin override: no implicit bypass; admin receives the explicit capability bundle and each mutation checks its semantic capability
Browser mutations and CSRF control: POST only; shared session token, timing-safe comparison, and Origin validation; delete also requires the exact Pod name
Public/secret abuse controls: authentication plus admin guard, semantic capabilities, read/mutation/create rate limits, active-Pod ceiling, GPU ceiling, fresh price check, confirmed hourly maximum, and mandatory auto-stop
Request and upload limits: URL-encoded forms only, at most 16 KiB and 20 scalar fields; no uploads; provider requests capped at 64 KiB; provider responses capped at 4 MiB
Output/rendering contexts: bounded normalized values rendered with escaped Pug interpolation; no provider HTML, raw response bodies, environment values, or inline JSON
Private file/media storage and delivery: none
Outbound hosts/services: fixed HTTPS api.runpod.io v2 paths and exact <pod>-<port>.proxy.runpod.net URLs; redirects rejected; Ollama paths restricted to /api/tags and /api/pull
Cache policy: browser responses are private/no-store; catalog results use a short in-memory cache
Security-relevant logs: stable action, category, safe error code, and HTTP status metadata only; no key, billing amount, resource ID, principal data, or provider body
Retention/deletion behavior: provider deletion archives local lifecycle and per-Pod billing metadata; account months, Pod billing periods, and audit events are retained; no credentials are persisted
Required negative tests: non-admin/capability denial, invalid CSRF and Origin, oversized/non-form body, malformed local ID, unavailable hardware, active-Pod/GPU/cost limits, public-endpoint acknowledgement, exact delete confirmation, provider timeout/error/oversize/redirect, proxy-host validation, cleanup after failed creation/setup, and auto-stop overlap
Legacy dependency or migration plan: new v2-only models/routes; MongoDB creates the new collections and indexes; rollback can remove code after all provider Pods have been explicitly deleted
```

The application has no shared recent-authentication or MFA gate yet. The feature
therefore uses the existing admin session plus semantic capabilities, CSRF, rate
limits, cost bounds, and exact-name deletion confirmation.

## Configuration and standalone checks

The key now needs the provider privileges required for Pod and account-template
management. Use the narrowest Runpod credential that supports those operations,
store it only in `.env`, and rotate it if exposed.

The read-only connectivity check does not start Express, MongoDB, schedulers,
workers, or the `prestart` pipeline:

```bash
npm run test:runpod-api-v2
```

The destructive lifecycle check is a no-op without `--execute`. With the flag it
creates exactly one preferred single-GPU Secure Cloud Pod below `$1/hour`, sets
up Ollama and `qwen2.5:0.5b`, verifies stop/start persistence, and deletes the Pod
in a `finally` cleanup path:

```bash
npm run test:runpod-pod-lifecycle-v2 -- --execute
```

To pause after Ollama becomes ready for a manual browser check:

```bash
npm run test:runpod-pod-lifecycle-v2 -- --execute --pause-after-ready
```

The billing backfill also defaults to a no-op. With `--execute`, it connects
directly to MongoDB without starting the application, requests only v2 account
and per-Pod billing, and upserts November 2025 through the current month:

```bash
npm run sync:runpod-billing-v2 -- --execute
```

Its console summary contains only counts and month keys, not billing amounts,
provider Pod IDs, credentials, or connection strings.

If cleanup prints an `URGENT` error, immediately inspect the Runpod console and
delete the named test Pod before doing anything else.

## Deployment and rollback

- Do not edge-cache `/admin/runpod`; responses use
  `Cache-Control: private, no-store, max-age=0`.
- Ensure the application process and MongoDB remain available for background
  setup and the automatic stop guard.
- If the browser-facing origin differs from the origin Express derives through
  its trusted proxy, list it in `CSRF_ALLOWED_ORIGINS`.
- Before rollback, stop and delete every provider Pod visible on the dashboard.
  Removing application code does not stop external Runpod billing.
- After provider cleanup, remove the route, scheduler, models, and environment
  key. Local archive/audit collections may be retained or dropped according to
  the operator's data-retention policy.
