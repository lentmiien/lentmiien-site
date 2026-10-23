# Smallest-box packing

`/binpacking-smallest` searches the shared box catalog in ascending internal volume (ties use the box ID). It allows 3D rotation, reserves the requested cushion margin at every wall, rejects boxes too small for any individual item or combined volume/weight (including estimated cushion), then tries the packing worker with a one-container limit until three solutions are found or candidates are exhausted. A result must contain every item, with valid dimensions, positions and no overlaps. Provider errors before a valid solution fail the request; errors or deadlines during alternative search retain completed solutions and set `meta.alternativesSearchComplete: false`. A heuristic failure does not prove that a mathematical arrangement is impossible.

All logged-in admin, family and user accounts can read/search the same boxes and see Smallest Box Finder in the Tools navbar. Admins (or users granted `packing.container.write`) edit up to **50 boxes** in the compact, collapsed editor below the results. Dimensions are internal mm; weights are kg. Maximum load is contents weight; zero permits only weightless contents with no estimated cushion weight. Saving an empty list clears the shared definitions. Items and results are not stored. Concurrent edits use a revision check: a stale save returns 409 and retains the newer catalog.

## Cushioning and alternative solutions

Search input `safetyMarginMm` defaults to **10 mm per side**. The worker gets width, depth and height minus twice the margin. Nonpositive usable dimensions are excluded. Set `0` to disable the margin. This protects space at the box walls; it does not enforce separation between items. Returned box dimensions remain the full internal dimensions, and returned item coordinates are offset by the margin on all three axes.

Results keep the original `success`, `container`, `data`, and `meta` fields for the smallest successful box. `alternatives` contains zero to two further independent solutions in ascending full box volume, with ties broken by ID. Each solution holds all items in exactly one box. `estimatedCushionWeight` and `estimatedShipmentWeight` are in kg, on both the primary and alternatives. The UI lets users choose a solution to inspect its weights, placements and 3D preview. `meta.attempts` counts all attempted boxes, including alternative searches. The same 60-second worker budget covers the entire search.

Cushion density is **8.22 kg/m³ = 8.22 g/liter = 8.22e-9 kg/mm³**, estimated from the six supplied measured shipments. Treating all weight beyond the original box+items estimate as cushion:

| Box | Empty volume (liters) | Extra weight (kg) | Implied density (kg/m³) |
| --- | ---: | ---: | ---: |
| B3 | 21.6604 | 0.168 | 7.7561 |
| C54 | 74.0253 | 0.518 | 6.9976 |
| X3 | 63.6428 | 0.761 | 11.9574 |
| L2 | 18.8275 | 0.144 | 7.6484 |
| X4 | 138.4365 | 0.971 | 7.0140 |
| A | 3.2745 | 0.067 | 20.4611 |

Pooled estimate: `2.629 kg / 0.31986695978656 m³ = 8.219042... kg/m³`, rounded to 8.22. This weights each example by empty volume; it is an estimate, not an upper bound. Differences in materials, compression, tape, and measured inputs can affect actual weight.

For each solution, `emptyVolume = full internal box volume - sum(item volume * qty)`. This includes both the reserved wall margin and gaps in the packing; rigid item rotation does not change total occupied volume. Cushion weight is `emptyVolume * 8.22e-9`; shipment weight is box weight + item weights × quantities + cushion weight. No premature rounding is applied. The full contents estimate must fit `maxLoadWeight`; the worker receives the remaining load allowance after cushion weight. `meta` exposes `emptyVolume` in mm³, `usableDimensions` in mm, `safetyMarginMm`, and `cushionDensityKgPerM3`.

## Tags

Each box has up to 20 tags (1–40 letters, numbers, hyphens or underscores), normalized to lowercase. The editor accepts comma-separated tags. Search controls are generated from the saved tags. API clients may send:

```json
"tagFilter": { "require": ["fold-box"], "requireNot": ["tube", "large-box"] }
```

A `requireNot` match always excludes a box, even if a `require` tag also matches. A `require` match includes it unless excluded. Boxes with no matching filter tags remain included, as requested; **require is not a strict whitelist**. Therefore positive tags alone do not remove any boxes. Empty/omitted filters include all boxes. Tag filtering runs before geometry/weight filtering and packing. Tags are not sent to the packing worker.

## Preserving existing boxes

On database readiness, the application initializes the singleton in `packing_shared_container_catalogs`. If there is exactly one nonempty legacy catalog owned by an admin, all its boxes are copied, with empty tags. The original `packing_container_catalogs` document is retained unchanged as a backup. Once the shared catalog exists, initialization never overwrites it, even if its list is empty. Concurrent initialization uses the singleton `_id` and `$setOnInsert`.

Reads can use the same legacy snapshot without writing if startup initialization has not completed; saving also retries initialization. If multiple admins have nonempty legacy catalogs, initialization fails closed with an actionable log. Set optional `PACKING_CATALOG_SOURCE_OWNER_ID` to the intended admin's immutable user ID and restart; it must identify an admin with a nonempty catalog. No source ID is needed for the normal single-admin case. Non-admin legacy catalogs are not shared. Rollback to the old implementation keeps the original catalog, but later shared edits are not copied back into it.

## API

Client integration guide: [Smallest Box Finder API manual](smallest-box-api.md).

`GET /api/binpacking-smallest/containers` returns `{ containers, revision, tags }` using the same bearer key. `tags` is the sorted, unique union of box tags. This read-only endpoint uses the shared catalog reader, exposes no owner or migration metadata, and never initializes or modifies the catalog. It accepts no query parameters and shares the API IP rate limit, without consuming search quota.

`POST /api/binpacking-smallest` accepts JSON and uses the shared database catalog. In the page's **API access** section, an admin can create a named API key with a lifetime of 1–365 days and revoke keys. Copy a new key immediately; only its hash is stored. Up to ten active keys per account. The old global API key and browser cookies are not accepted by this endpoint.

```sh
curl "$SITE_URL/api/binpacking-smallest" \
  -H "Authorization: Bearer $PACKING_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"algorithm":"laff","items":[{"id":"widget","w":100,"d":80,"h":50,"weight":0.2,"qty":3}],"tagFilter":{"requireNot":["tube"]}}'
```

`algorithm` defaults to `laff`; alternatives are `plain` and `bruteforce`. The response keeps `{ success, container, data, meta }` on success and adds `estimatedCushionWeight`, `estimatedShipmentWeight`, and `alternatives`: `container` is the selected saved box (including tags), `data.pallets` contains exactly one packing solution, and `meta` includes attempt and filter counts. No fit returns HTTP 200 with `success: false`, `message`, and `meta`. Invalid input is 400, invalid/expired/revoked keys 401, work/rate limits 429, and unavailable database/worker or interrupted search before a solution 503. See `public/yaml/binpacking-smallest.v1.yaml` for the wire contract.

## Security contract

- Zone: logged-in/private. Interactive principals: admin, family, user; machine principals: independently named, revocable service credentials.
- Capabilities: `packing.container.read` and `packing.search.run` bundled for all three roles. `packing.container.write` and `packing.api.manage` default to admin only, with explicit grants supported. Unknown roles fail closed unless explicitly granted.
- Object scope: one explicitly admin-managed shared catalog. No client owner/catalog IDs. Credentials remain owner-scoped for list/issue/revoke; no administrator override for another owner's keys.
- Machine scope: keys have only packing read/run capabilities and a fixed issuer account. Each request checks hash, namespace, scopes, expiry, revocation, current issuer existence and read/run/API-management capabilities. Rechecked before returning a search result or API catalog read. Keys cannot edit boxes or issue keys. Generic reusable primitive: `services/serviceCredentialService.js`, `models/service_credential.js`.
- Browser mutations: non-GET, shared session CSRF and Origin validation. No credential issuance on GET. Machine auth is mounted before legacy body parsing and `/api` authentication, with a terminal 404; it uses bearer headers only and no browser CSRF.
- Limits: 128 KiB catalog JSON; 64 KiB search JSON/CSV; 50 boxes, 100 item types, 200 items (7 for bruteforce), bounded strings/dimensions/weights; 20 tags per box and filter list; finite margin from 0 to 500000 mm per side (default 10). At most three complete solutions per response. Search at most 50 calls, 15 seconds/call, 60 seconds overall. One active search per issuer and two per process, shared across browser/API; 5 searches/minute per issuer. API pre-auth 60 requests/minute/IP. Catalog writes 30/minute/account; key issuance 10/hour/account, ten active slots enforced by a compound unique index. Per-process limits multiply in multi-process deployments.
- Data/rendering: private/no-store and no-referrer; no analytics; escaped Pug and DOM text/property assignments. No inline catalog JSON. API keys displayed once, no browser storage, cleared on pagehide/hide. No private media.
- Outbound: configured `BIN_PACKING_API_URL` only, no redirects, bounded response size/time. The worker receives item/box measurements, without tags or credentials.
- Logs: stable operational/migration failures with safe codes; interrupted alternative searches logged as warnings without upstream text; credential issue/revoke audit contains opaque issuer/key IDs only. Never log keys, request items, box definitions, or upstream bodies.
- Retention: shared catalog persists until edited; legacy backup retained; search input/results transient. Expired credentials removed by TTL; revoked/expired slots may be reclaimed on issuance. Revoke then issue for rotation.
- Negative verification: migration preserves all 30 boxes, repeats/concurrency/empty catalogs do not overwrite shared data; ambiguous source rejected; tag conflicts/no-match/defaults; authorization/CSRF, owner-scoped keys, expired/revoked/wrong-scope tokens, strict inputs, read-only API catalog/authentication/error responses, shared admission limits and concurrent-save conflicts. Packing tests cover default/zero/invalid margins, reduced-space bounds, cushion load limits, ordered alternatives, cancellation and partial success after worker failure/deadline. Browser tests cover safe alternative selection and weight display.
- Deployment: no new dependency. Optional source-owner variable documented in `env_sample`. Collection/index initialization uses the configured database lifecycle. Cloudflare must not cache private routes; the app enforces authorization without it. No credentials or live user data are needed for automated tests.

Focused checks:

```sh
npm test -- tests/unit/smallestBoxService.test.js tests/unit/smallestBoxRoutes.test.js tests/unit/smallestBoxClient.test.js tests/unit/smallestBoxCatalog.test.js tests/unit/serviceCredentials.test.js tests/unit/accountSurfacePolicy.test.js --coverage=false
npm run lint:openapi -- binpacking-smallest.v1.yaml
```
