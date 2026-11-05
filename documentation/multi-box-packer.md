# Multi-box Packer

Independent packing tool at `/binpacking-multi`, alongside Smallest Box Finder.

## Security contract

- Zone: logged-in. Interactive principals: admin, family, user with `packing.container.read` and `packing.search.run`; the existing packing role bundles grant both. API key management requires `packing.api.manage` (admin by default).
- Machine principals: existing independently revocable, expiring, hashed `packing` service credentials, with catalog/read and search/run scopes and a fixed owner. Owner capabilities are revalidated on every request. No global API key or session fallback.
- Data: private. Catalog: explicitly shared, admin-managed through Smallest Box Finder. Jobs: owner scope, no admin override; browser and machine callers for the same owner can retrieve that owner's jobs.
- Browser mutation: POST jobs, shared session CSRF and capability middleware. No GET mutations to upstream computation.
- Limits: strict allowlist input, 256 KiB JSON, 500 expanded items, 50 shared box sizes, 5 submissions/owner/minute, 30 submissions/application process/minute; at most four concurrent upstream requests/process. Provider also bounds pending jobs (100), workers (2), execution (30 seconds/attempt), and retained jobs (1,000).
- Rendering: escaped Pug and DOM textContent; local preview assets. No analytics. Private/no-store responses and no-referrer.
- Storage: MongoDB stores owner/job IDs and the catalog snapshot used for weight estimates, never public files. Provider stores input/results. Local mapping expires eight days after admission; provider results expire seven days after completion. Expired/foreign/missing jobs return the same 404. Local mapping retention intentionally bounds access even if the provider stalls.
- Outbound: only configured `MULTI_BOX_PACKING_URL` origin (default LAN service), fixed `/api/jobs` paths, no redirects, 15-second timeout, 8 MiB response limit. No caller-selected destinations or forwarded credentials.
- Logs: operational failures and failed computations through utils/logger; stable category and sanitized status/code, no item data, credentials, provider messages, or bodies.
- Negative tests: anonymous, missing capability, CSRF, foreign job, malformed UUID/input, size/count limits, upstream errors, capacity, inert rendering. Existing credential tests cover expiry/revocation/scopes/owner authorization.
- Legacy dependencies: reuse shared catalog, authorization, CSRF, service credentials, and packing capability bundles. Existing algorithms and catalog writes stay in Smallest Box Finder.

## Behavior and deployment

Configure `MULTI_BOX_PACKING_URL` to the private parcel service origin (default `http://192.168.0.20:8094`). No credentials are sent to the LAN worker. The configured URL must be an HTTP(S) origin without credentials, path, query, or fragment. Keep the worker LAN-only. Do not cache either tool route or its API at the edge; machine callers need a narrow Cloudflare Access exception if Access otherwise requires a browser session. Application bearer checks remain mandatory.

The tool uses shared catalog boxes with nonzero Max kg. Millimeters convert to centimeters; catalog maximum load remains the hard content-weight limit. Box `max_value` is set to 1e12, and individual item values are capped at 2e9 so even 500 items cannot exceed that box value limit. Item dimensions and all preferences are entered in cm; weights in kg. Box sizes have unlimited supply. Users may select a subset of the eligible catalog IDs. An omitted selection means all eligible boxes.

Weight estimates use the catalog snapshot at submission: empty space = full interior volume minus post-shrink content volume (including soft items). Cushion kg = empty cm³ × 8.22 / 1,000,000. Total shipment kg = box tare + item kg + cushion kg. Reserved diagonal envelopes and fragile padding are empty space, not extra content. The worker enforces item weight only; a warning flags when item plus estimated cushion exceeds catalog Max kg. Estimates do not re-optimize the returned plan.

The browser polls every five seconds until completed/failed. A completed job may contain unplaced items; review their reasons. Soft items appear in manifests and utilization without fabricated placements. Rigid previews use item centers, local dimensions, and row-major rotation matrices, including diagonal free rotation. This heuristic does not guarantee an optimum or model support, insertion paths, or stacking strength.

API: `GET /api/binpacking-multi/containers`, `POST /api/binpacking-multi/jobs`, `GET /api/binpacking-multi/jobs/{jobId}`. Use `Authorization: Bearer <packing key>` from Smallest Box Finder's API access panel. Request fields are `items`, optional `options`, and optional `boxIds` (no arbitrary boxes). See `/yaml/binpacking-multi.v1.yaml`. POST responds 202 with a local status URL and Retry-After: 5; GET responds 200, with result only when completed. Do not automatically retry failed POSTs: a worker submission may have succeeded before a connection/storage failure. There is no public idempotency contract.

MongoDB registers a new `PackingJob` model with an expiry index; no catalog migration is required. Removing the new mounts/navigation reverses the feature without changing existing catalog or API credentials. Retain owner mappings while jobs are needed; TTL cleanup removes them automatically.

Example external submission (use your site origin and packing key):

```sh
curl "$SITE_URL/api/binpacking-multi/jobs" \
  -H "Authorization: Bearer $PACKING_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"items":[{"id":"Poster tube","width":44,"height":3,"depth":3,"weight":0.18,"rotation":"free"}],"options":{"approach":"boxes","margin":1}}'
```

Poll the returned `statusUrl` on the same site with the same bearer header every five seconds. Check `status`, then `result.unplaced`; each `result.boxes[]` includes its expanded item manifest and `weightEstimate` fields. `estimatedShipmentWeight` includes items, tare and estimated cushion; `exceedsMaxLoadWeight` compares items plus cushion to the catalog's content limit.
