# Saved AmiAmi item details

Each row on `/admin/amiami-items` links to `/admin/amiami-items/:id`.
The read-only page shows every stored field, grouped into record metadata,
listing data, and fetched details. Nested values use formatted JSON; raw API
data is expandable. Nulls, empty values, false flags, zero prices, and full
timestamp precision are preserved. Saved markup and URLs are plain text.

## Security contract

- Feature: saved AmiAmi catalog entry viewer.
- Security zone: logged-in.
- Interactive principals: admin by default; family/user only with an explicit
  `amiami.items.read` grant. Machine principals: none.
- Data classification: private administrative catalog, including fetch diagnostics.
- Capabilities: `amiami.items.read`; admin bundle grants it, family/user bundles
  are empty. The shared capability evaluator handles explicit role/user grants.
- Object scope: admin-managed catalog. The read capability explicitly grants
  access to all catalog records; these records have no personal owner.
- Admin override: none beyond the declared catalog-read capability.
- Browser mutations and CSRF: none; GET/HEAD only, no fetch/import work triggered.
- Public/secret abuse controls: no public access; authentication and capability
  checks run before database work.
- Request/work limits: exactly one 24-character hexadecimal MongoDB ID, one
  document lookup with a five-second database execution limit. Query parameters
  do not influence the lookup. MongoDB's document size limit bounds stored data.
- Output/rendering: escaped Pug text and formatted JSON in text nodes; no saved
  markup execution, dynamic URL links, or automatic image requests. No analytics.
- Private media/storage: none added. Outbound hosts/services: none.
- Cache policy: private, no-store, max-age=0, including denied/error responses.
- Logs: shared logger reports lookup/render failures without stored data or raw
  database error messages; authorization failures use the shared middleware.
- Retention/deletion: unchanged; this viewer creates, modifies, and deletes nothing.
- Negative tests: anonymous/incomplete principals, ungranted family/user,
  authorization lookup failure, malformed/missing IDs, database failure,
  stored script/URL payloads, private cache headers, and unsupported mutations.
- Legacy dependency: reads the existing AmiAmi model without migration. The
  legacy list keeps its existing admin gate; the new detail router is mounted
  after the import router and before the legacy admin router so explicit read
  grants are honored without changing other administrative routes.

## Deployment and verification

No new dependencies, environment variables, secrets, database migrations, or
Cloudflare changes are required. Do not override the private/no-store policy
with edge caching. Deploy/restart normally; rollback removes the detail route
and table link without changing stored records.

Focused checks: `npm test -- tests/unit/amiamiItemsDetail.test.js --coverage=false`.
Use synthetic records for UI verification; no scraper or production database
startup is needed.
