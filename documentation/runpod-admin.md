# Runpod API v2 admin monitor

## Scope

`/admin/runpod` implements step 1 of the Runpod integration. It is deliberately
read-only and uses only the REST API v2 production origin:

```text
https://api.runpod.io/v2
```

The page loads these v2 resources:

- `GET /v2/catalog/gpus?include=AVAILABILITY&product=POD&cloud=SECURE`
- `GET /v2/catalog/cpus?include=AVAILABILITY&product=POD`
- `GET /v2/catalog/datacenters`
- `GET /v2/catalog/templates?source=official`
- `GET /v2/billing?bucketSize=<allowlisted>&lastN=<1..366>`

The implementation contains no Runpod create, update, start, stop, or delete
request. API v1 and the legacy GraphQL API are not used.

Runpod announced REST API v2 as a public beta, so response changes remain
possible: <https://www.runpod.io/blog/runpods-rest-api-v2-is-here-one-api-for-your-entire-gpu-stack>

Current reference: <https://docs.runpod.io/api-reference-v2/overview>

## Security contract

```text
Feature: Runpod REST API v2 catalog and billing admin monitor
Security zone: logged-in
Interactive principals: admin by default; individually granted authenticated users
Machine principals: none (RUNPOD_API_KEY is an outbound provider credential)
Data classification: public catalog data, sensitive account billing data, secret API key
Capabilities: runpod.catalog.read and runpod.billing.read (both required for this combined page)
Object scope: none; the provider returns account-wide data and the page requires both account-wide read capabilities
Admin override: no; admin receives the capabilities through the explicit admin capability bundle
Browser mutations and CSRF control: none; GET only, with no local or provider state changes
Public/secret abuse controls: not public; authenticated capability guard plus 30 requests/minute page limit
Request and upload limits: no body/uploads; allowlisted query fields; 1..366 billing buckets; bounded catalog item counts; five concurrent provider reads; 10-second request timeout; 4 MiB response cap; redirects rejected
Output/rendering contexts: normalized bounded values rendered through escaped Pug interpolation; no provider HTML or inline JSON
Private file/media storage and delivery: none
Outbound hosts/services: fixed HTTPS origin https://api.runpod.io only; fixed v2 paths only
Cache policy: browser responses are private/no-store; provider results are retained in process memory for 30 seconds by default
Security-relevant logs (without personal data): stable configuration/provider/authorization failure messages, failed section names, error codes, and HTTP status only; no headers, keys, billing amounts, resource IDs, or provider bodies
Retention/deletion behavior: no database or file persistence; short in-memory entries expire after RUNPOD_API_CACHE_TTL_MS and disappear on process exit
Required negative security tests: unauthenticated mount, admin/family/user capability matrix, explicit per-user grants, missing capability, malformed/unknown filters, provider timeout/error/oversize/malformed JSON, private cache header, escaped provider output, and no v1 or mutation routes
Legacy dependency or migration plan: none; this is a separate v2-only route and service
```

## Configuration and connection test

Set a dedicated credential in `.env`:

```text
RUNPOD_API_KEY=
RUNPOD_API_TIMEOUT_MS=10000
RUNPOD_API_CACHE_TTL_MS=30000
```

For step 1, create a read-only or narrowly scoped Runpod key when the provider
account supports that distinction. The application never returns or logs the
key.

Test the connection without starting Express, MongoDB, schedulers, workers, or
the `prestart` pipeline:

```bash
npm run test:runpod-api-v2
```

The script prints the reported API/OpenAPI versions, catalog counts, and billing
record count. It does not print the credential, billing amounts, resource IDs,
or raw provider payloads, and it makes no state-changing request.

## Deployment and rollback

- Do not edge-cache `/admin/runpod`; the application sends
  `Cache-Control: private, no-store, max-age=0`.
- Keep ordinary login protections in front of the route. Cloudflare controls are
  defense in depth, not authorization.
- Rotation requires replacing `RUNPOD_API_KEY` and restarting the web process.
- Rollback is code-only: remove the route mount/navigation and service files,
  then remove the environment key. There is no stored integration data or
  migration to reverse.

## Step 2 boundary

Step 2 must be designed as a separate high-impact capability set (create,
start, stop, delete, and instance administration). It must use non-GET methods,
the shared browser CSRF mechanism, bounded cost and concurrency controls,
actionable audit logging, and explicit confirmation/recent-auth policy before
it is connected to this monitor.
