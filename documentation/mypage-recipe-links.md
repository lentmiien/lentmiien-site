# My account recipe links and status fixes

The cooking card resolves only today's first 12 schedule entries, preserving Asia/Tokyo
dates, ordering and duplicates. Cookbook IDs take precedence over converted legacy
aliases (stored as strings), then owned legacy recipe notes. Recipe metadata is read
with `user_id` equal to the validated principal's name. Missing or foreign recipes
have an unavailable, unlinked row; the household schedule does not grant ownership.
No whole-library read, conversion, migration or provider operation is performed.

## Security contract: legacy cookbook reading

- Feature: `GET /cooking/cookbook/legacy/:id`, a read-only compatibility view.
- Zone: logged-in. Interactive principals: admin, family, user and explicitly granted
  custom roles. Machine principals: none. Data: private recipe notes.
- Capabilities: existing `cooking` mount permission plus `cooking.recipe.read`.
  Admin, family and user bundles grant the latter; custom roles require an explicit
  assignment. This does not grant the existing cooking permission.
- Scope: owner only, using the existing `user_id === req.user.name` convention;
  no admin override. Converted owned entries redirect to normal cookbook detail.
- Browser mutations/CSRF: none; GET/HEAD never save or convert. Other methods have
  no compatibility handler. Existing cookbook mutation routes are unchanged.
- Limits: one 24-hex identifier; at most two scoped lookups, each with a 2-second
  database deadline. Markdown rendering is capped at 100,000 characters; larger
  notes receive a generic error and an operational warning.
- Output: escaped Pug title and shared sanitized Markdown rendering, followed by
  a recipe-specific allowlist that removes automatic media requests. Legacy data
  is clearly labelled; no edit, rating or conversion controls appear in this view.
- Media: no new storage/delivery; this compatibility view does not render images.
- Outbound services: none. Cache: private/no-store, no analytics, no referrer.
- Logs: stable cookbook warnings/errors without note contents, IDs or raw errors.
- Retention/deletion: unchanged; read-only use of legacy records.
- Negative tests: anonymous, missing capability, foreign/missing/non-recipe records,
  admin ownership, malformed IDs, oversized content, HTML/URL injection, private
  headers, database failure privacy and absence of writes.
- Legacy dependency: existing Markdown renderer and owner fields; no wider cookbook
  refactor or authorization relaxation.

Codex card rows link to their queried turn IDs, including queued turns. Runpod excludes
normalized `TERMINATED` status before sorting/limiting; all other states, including
`EXITED`, remain. Freshness uses only the visible pods. Provider/lifecycle/billing data
is unchanged.

Release requires no configuration, schema, migration or Cloudflare changes. Publish
the committed code through the normal deployment process when separately authorized;
this change does not deploy it. Rolling back the code restores the previous links/filter.

## Validation

- Focused dashboard adapter, client, route and legacy-view tests: 5 suites, 92 tests passed.
- Full `npm test -- --runInBand`: 323 suites and 3,801 tests passed; 4 suites and
  66 tests skipped. Configured coverage thresholds passed.
- Local Chromium smoke checks with synthetic fixtures at desktop (1440px) and mobile
  (390px): cooking and distinct running/queued turn links, unavailable non-link,
  terminated exclusion, stopped-pod preservation, real legacy view and no horizontal
  overflow. Screenshots were visually reviewed. Canonical cookbook and turn destination
  pages were fixture stubs; their live services were not exercised.
- Tests ran on available Node 24.12.0; the repository pins 24.20.0. No dependency changes.
- No configured live database reads, provider requests, application startup or deployment.
